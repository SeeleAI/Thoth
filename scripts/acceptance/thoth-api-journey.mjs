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

  async approveCardChain(agentId, executionMode) {
    let task = null;
    for (let round = 0; round < 20 && !task; round += 1) {
      const pending = await this.waitFor(async () => {
        const result = await this.client.getAgentThothState(agentId);
        if (result.error) throw new Error(result.error);
        const card = result.state.pendingCard;
        return card?.card.submitted === false ? card : null;
      }, "Clarify or Task Card");

      if (pending.kind === "task_card") {
        task = pending.card;
        break;
      }
      invariant(pending.kind === "clarify_card", `Unexpected Card kind: ${pending.kind}`);
      const questions = "questions" in pending.card.card ? pending.card.card.questions : [];
      await this.answerCard(agentId, pending.card.id, {
        intent: "submit_choices",
        question_card_id: pending.card.id,
        title: pending.card.title,
        answers: questions.map((question) => ({
          question_id: question.id,
          choice_ids: [question.choices[0].id],
          choice_notes: {},
        })),
        raw_answer: "Use every first acceptance option.",
      });
    }
    invariant(task, "Clarify did not converge to a Task Card within 20 rounds");

    const intent = executionMode === "loop" ? "accept_loop" : "accept_quick";
    await this.answerCard(agentId, task.id, {
      intent,
      card_id: task.id,
      title: task.title,
      raw_answer: `Accept ${executionMode} task.`,
    });

    const goals = await this.waitFor(async () => {
      const result = await this.client.getAgentThothState(agentId);
      if (result.error) throw new Error(result.error);
      const pending = result.state.pendingCard;
      return pending?.kind === "goal_card" && pending.card.submitted === false
        ? pending.card
        : null;
    }, "Goals Card");
    await this.answerCard(agentId, goals.id, {
      intent,
      card_id: goals.id,
      title: goals.title,
      raw_answer: `Accept ${executionMode} goals.`,
    });
  }

  async sessionId(agentId) {
    const snapshot = await this.client.fetchAgent({ agentId });
    return snapshot?.agent.runtimeInfo?.sessionId ?? null;
  }

  async waitForLoopDone(workspaceId) {
    const task = await this.waitFor(async () => {
      const result = await this.client.listTasks(workspaceId);
      if (result.error) throw new Error(result.error);
      return result.tasks.find((candidate) => candidate.status === "completed") ?? null;
    }, "background Loop to become done");
    const detail = await this.client.getTask({ taskId: task.id, workspaceId });
    invariant(detail.error === null, `Task inspect failed: ${detail.error}`);
    invariant(
      detail.task?.status === "completed",
      `Background task ended as ${detail.task?.status}`,
    );
    return detail.task;
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
    await this.approveCardChain(agent.id, "quick");
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
    await this.approveCardChain(agent.id, "loop");
    await this.waitForLifecycle(agent.id, "background_handoff");
    await this.waitForAgentIdle(agent.id);

    const finalSessionId = await this.sessionId(agent.id);
    invariant(
      finalSessionId === sessionId,
      `Hot switching replaced the visible provider session: ${sessionId} -> ${finalSessionId}`,
    );
    const task = await this.waitForLoopDone(workspaceId);
    invariant(
      task.budget.usedFailedReviews === 1,
      `Expected one failed Review, received ${task.budget.usedFailedReviews}`,
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
