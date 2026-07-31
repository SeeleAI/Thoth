let commandSequence = 0;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export class ThothApiJourney {
  constructor({ client, timeoutMs = 30_000, pollMs = 50, commandPrefix = "thoth-acceptance" }) {
    this.client = client;
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
    this.commandPrefix = commandPrefix;
    this.lastTaskDetail = null;
  }

  async waitFor(read, label, timeoutMs = this.timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = await read();
        if (value !== null && value !== undefined && value !== false) return value;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
    const suffix = lastError ? `: ${lastError.message ?? String(lastError)}` : "";
    throw new Error(`Timed out waiting for ${label}${suffix}`);
  }

  async waitForAgentIdle(agentId) {
    await this.waitFor(async () => {
      const snapshot = await this.client.fetchAgent({ agentId });
      return snapshot?.agent.status === "idle" ? snapshot : null;
    }, `agent ${agentId} to become idle`);
  }

  async waitForLifecycle(agentId, lifecycle) {
    return await this.waitFor(async () => {
      const result = await this.client.getAgentThothState(agentId);
      if (result.error) throw new Error(result.error);
      return result.state.lifecycle === lifecycle ? result.state : null;
    }, `agent ${agentId} lifecycle ${lifecycle}`);
  }

  async answerCard(agentId, cardId, answer) {
    const current = await this.client.getAgentThothState(agentId);
    invariant(!current.error, `Agent Thoth state failed: ${current.error}`);
    const result = await this.client.answerAgentThothCard({
      agentId,
      cardId,
      answer,
      expectedRevision: current.state.revision,
      commandId: `${this.commandPrefix}-${++commandSequence}`,
    });
    invariant(result.accepted, result.error ?? `Card ${cardId} was rejected`);
    invariant(!result.conflict, `Card ${cardId} conflicted with another authority revision`);
  }

  async approveIntentContract(agentId, executionMode) {
    let contract = null;
    for (let round = 0; round < 100 && !contract; round += 1) {
      const pending = await this.waitFor(async () => {
        const result = await this.client.getAgentThothState(agentId);
        if (result.error) throw new Error(result.error);
        const card = result.state.pendingCard;
        return card?.card.submitted === false ? card : null;
      }, "Clarify or Intent Contract Card");

      if (pending.kind === "intent_contract_card") {
        contract = pending.card;
        break;
      }
      invariant(pending.kind === "clarify_card", `Unexpected Card kind: ${pending.kind}`);
      const questions = "questions" in pending.card.card ? pending.card.card.questions : [];
      await this.answerCard(agentId, pending.card.id, {
        intent: "submit_choices",
        questionCardId: pending.card.id,
        answers: questions.map((question) => ({
          nodeId: question.nodeId,
          choiceIds: [question.choices[0].id],
          choiceNotes: {},
        })),
        delegatedNodeIds: [],
        rawAnswer: "Use every first acceptance option.",
      });
    }
    invariant(contract, "Clarify did not converge to an Intent Contract");

    const intent = executionMode === "loop" ? "accept_loop" : "accept_quick";
    await this.answerCard(agentId, contract.id, {
      intent,
      cardId: contract.id,
      rawAnswer: `Accept ${executionMode} Intent Contract.`,
    });
  }

  async sessionId(agentId) {
    const snapshot = await this.client.fetchAgent({ agentId });
    return snapshot?.agent.runtimeInfo?.sessionId ?? null;
  }

  async waitForLoopDone(workspaceId) {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const result = await this.client.listTasks(workspaceId);
      if (result.error) throw new Error(result.error);
      const candidate = result.tasks.find((item) => item.mode === "loop");
      if (!candidate) {
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
        continue;
      }
      const detail = await this.client.getTask({ taskId: candidate.id, workspaceId });
      if (detail.error) throw new Error(detail.error);
      this.lastTaskDetail = detail;
      invariant(
        detail.executions.length <= 8,
        `Background Loop exceeded eight Executions: ${JSON.stringify(detail)}`,
      );
      for (const execution of detail.executions) {
        const approval = execution.pendingApproval;
        if (!approval) continue;
        const resolved = await this.client.resolveExecutionApproval({
          workspaceId,
          taskId: candidate.id,
          executionId: execution.id,
          approvalId: approval.id,
          decision: approval.kind === "implement" ? "implement" : "allow",
          expectedRevision: approval.revision,
          commandId: `${this.commandPrefix}-approval-${++commandSequence}`,
        });
        if (resolved.error && !resolved.conflict) throw new Error(resolved.error);
      }
      if (detail.task?.status === "completed") return detail.task;
      invariant(
        !["blocked", "interrupted", "stopped"].includes(detail.task?.status ?? ""),
        `Background task ended as ${detail.task?.status}: ${JSON.stringify(detail)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
    throw new Error(
      `Timed out waiting for background Loop to become done. Last detail=${JSON.stringify(this.lastTaskDetail)}`,
    );
  }

  async runCore({
    workspaceId,
    agentConfig,
    prompts,
    beforeQuick = async () => undefined,
    beforeLoop = async () => undefined,
  }) {
    const agent = await this.client.createAgent({
      ...agentConfig,
      workspaceId,
      initialPrompt: prompts.rawFirst,
      thoth: { enabled: false },
    });
    await this.waitForAgentIdle(agent.id);
    const sessionId = await this.sessionId(agent.id);
    invariant(sessionId, "Visible provider session was not created");

    await beforeQuick();
    await this.client.sendAgentMessage(agent.id, prompts.quick, {
      thoth: { enabled: true, executionMode: "quick", clarifyStrength: "light" },
    });
    await this.approveIntentContract(agent.id, "quick");
    await this.waitForLifecycle(agent.id, "done");
    await this.waitForAgentIdle(agent.id);

    await this.client.sendAgentMessage(agent.id, prompts.rawLast, { thoth: { enabled: false } });
    await this.waitForLifecycle(agent.id, "done");
    await this.waitForAgentIdle(agent.id);

    await beforeLoop();
    await this.client.sendAgentMessage(agent.id, prompts.loop, {
      thoth: {
        enabled: true,
        executionMode: "loop",
        clarifyStrength: "light",
        loopStrength: "light",
      },
    });
    await this.approveIntentContract(agent.id, "loop");
    await this.waitForLifecycle(agent.id, "background_handoff");
    await this.waitForAgentIdle(agent.id);

    const finalSessionId = await this.sessionId(agent.id);
    invariant(
      finalSessionId === sessionId,
      `Hot switching replaced the visible provider session: ${sessionId} -> ${finalSessionId}`,
    );
    const task = await this.waitForLoopDone(workspaceId);
    invariant(
      task.budget.usedNonCompleteReviews === 1,
      `Expected one non-complete Review, received ${task.budget.usedNonCompleteReviews}`,
    );
    await this.client.sendAgentMessage(
      agent.id,
      "Read the attached Task context and report its current status.",
      {
        thoth: { enabled: false },
        contextRefs: [
          {
            kind: "task",
            workspaceId,
            taskId: task.id,
            revision: task.revision,
          },
        ],
      },
    );
    await this.waitForLifecycle(agent.id, "done");
    await this.waitForAgentIdle(agent.id);
    const contextSessionId = await this.sessionId(agent.id);
    invariant(
      contextSessionId === sessionId,
      `@Task context replaced the visible provider session: ${sessionId} -> ${contextSessionId}`,
    );
    return { agent, sessionId, task };
  }
}
