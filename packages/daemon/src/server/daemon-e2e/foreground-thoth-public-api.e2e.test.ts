import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DaemonClient } from "../test-utils/index.js";
import { createTestThothDaemon, type TestThothDaemon } from "../test-utils/thoth-daemon.js";
import {
  THOTH_REAL_PROVIDER_FLOW_SCRIPTS,
  type ThothRealProviderFlowScript,
} from "../../test-fixtures/thoth-real-provider-flow-script.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "../agent/agent-sdk-types.js";
import type { ThothToolCatalog } from "../agent/tools/types.js";
import type {
  ThothCardAnswerPayload,
  ThothClarifyCardModel,
  ThothGoalsCardModel,
  ThothTaskCardModel,
} from "@thoth/protocol/thoth/rpc-schemas";
import { resetForegroundAuthorityStoresForTest } from "../agent/foreground-authority-runtime.js";

const capabilities: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: false,
  supportsNativeThothTools: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

class ScriptedThothSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = capabilities;
  readonly id: string;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private activeTurnId: string | null = null;
  private turnOrdinal = 0;
  private toolOrdinal = 0;
  private closed = false;

  constructor(
    id: string,
    private readonly tools: ThothToolCatalog | undefined,
    private readonly actor: ScriptedThothClient,
  ) {
    this.id = id;
  }

  get dynamicToolCount(): number {
    return this.tools?.tools.size ?? 0;
  }

  get turnCount(): number {
    return this.turnOrdinal;
  }

  async run(_prompt: AgentPromptInput): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(
    prompt: AgentPromptInput,
    _options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.activeTurnId) {
      throw new Error("scripted session already has an active turn");
    }
    const turnId = `${this.id}-turn-${++this.turnOrdinal}`;
    this.activeTurnId = turnId;
    queueMicrotask(() => void this.runActor(prompt, turnId));
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return { provider: "codex", sessionId: this.id, model: "scripted-codex" };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return [{ id: "auto", label: "Auto" }];
  }

  async getCurrentMode(): Promise<string | null> {
    return "auto";
  }

  async setMode(): Promise<void> {}
  getPendingPermissions() {
    return [];
  }
  async respondToPermission(): Promise<void> {}

  describePersistence(): AgentPersistenceHandle {
    return { provider: "codex", sessionId: this.id, metadata: { conversationId: this.id } };
  }

  async interrupt(): Promise<void> {
    const turnId = this.activeTurnId;
    if (!turnId) return;
    this.emit({
      type: "timeline",
      provider: "codex",
      turnId,
      providerTurnId: turnId,
      item: { type: "reasoning", text: `LATE_REASONING_AFTER_AUTHORITY_CARD:${turnId}` },
    });
    this.emit({
      type: "timeline",
      provider: "codex",
      turnId,
      providerTurnId: turnId,
      item: { type: "assistant_message", text: `LATE_TEXT_AFTER_AUTHORITY_CARD:${turnId}` },
    });
    this.activeTurnId = null;
    this.emit({
      type: "turn_canceled",
      provider: "codex",
      reason: "scripted interrupt",
      turnId,
      providerTurnId: turnId,
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.interrupt();
    this.subscribers.clear();
  }

  private emit(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  private async callTool(name: string, input: unknown, turnId: string): Promise<void> {
    if (!this.tools?.getTool(name)) {
      throw new Error(`scripted session is missing ${name}`);
    }
    await this.tools.executeTool(name, input, {
      providerToolCall: {
        provider: "codex",
        threadId: this.id,
        turnId,
        callId: `${turnId}-${++this.toolOrdinal}-${name}`,
        toolName: name,
        isActiveProviderTurn: this.activeTurnId === turnId,
      },
    });
  }

  private async runActor(prompt: AgentPromptInput, turnId: string): Promise<void> {
    this.emit({ type: "thread_started", provider: "codex", sessionId: this.id });
    this.emit({
      type: "turn_started",
      provider: "codex",
      turnId,
      providerTurnId: turnId,
    });
    try {
      const names = new Set(this.tools ? [...this.tools.tools.keys()] : []);
      if (names.has("thoth_submit_clarify_convergence_audit")) {
        await this.callTool(
          "thoth_submit_clarify_convergence_audit",
          {
            outcome: "proceed",
            summary: "The fixed task is grounded by the scripted authority answers.",
            missing_material_frontier: [],
            rejected_question_patterns: [],
            task_memory_refs: ["public create/send fixture"],
          },
          turnId,
        );
      } else if (names.has("thoth_loop_submit_planexec_result")) {
        const input = this.actor.script.planExec[this.actor.takePlanExecIndex()];
        if (!input) throw new Error("unexpected PlanExec attempt");
        await this.callTool("thoth_loop_submit_planexec_result", input, turnId);
      } else if (names.has("thoth_loop_submit_review_verdict")) {
        const index = this.actor.takeReviewIndex();
        const independent = this.actor.script.reviewIndependent[index];
        const verdict = this.actor.script.review[index];
        if (!independent || !verdict) throw new Error("unexpected Review attempt");
        await this.callTool("thoth_loop_submit_review_independent_assessment", independent, turnId);
        await this.callTool("thoth_loop_submit_review_verdict", verdict, turnId);
      } else if (
        names.has("thoth_submit_clarify_card") &&
        JSON.stringify(prompt).includes("Follow the installed thoth.clarify skill")
      ) {
        for (;;) {
          const clarify = this.actor.takeClarifyInput();
          if (!clarify) break;
          await this.callTool("thoth_submit_clarify_card", clarify, turnId);
          if (this.activeTurnId !== turnId) return;
        }
        const task = this.actor.takeTaskInput();
        if (task) {
          await this.callTool("thoth_submit_task_card", task, turnId);
          if (this.activeTurnId !== turnId) return;
        }
        const goals = this.actor.takeGoalsInput();
        if (goals) {
          await this.callTool("thoth_submit_goals_card", goals, turnId);
          if (this.activeTurnId !== turnId) return;
        }
      } else {
        this.emit({
          type: "timeline",
          provider: "codex",
          turnId,
          item: { type: "assistant_message", text: this.actor.script.finalMarker },
        });
      }
      if (this.closed || this.activeTurnId !== turnId) return;
      this.activeTurnId = null;
      this.emit({
        type: "turn_completed",
        provider: "codex",
        turnId,
        providerTurnId: turnId,
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    } catch (error) {
      if (this.closed || this.activeTurnId !== turnId) return;
      this.activeTurnId = null;
      this.emit({
        type: "turn_failed",
        provider: "codex",
        turnId,
        providerTurnId: turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

class ScriptedThothClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = capabilities;
  readonly sessions: ScriptedThothSession[] = [];
  private nextSession = 0;
  private clarifyIndex = 0;
  private planExecIndex = 0;
  private reviewIndex = 0;
  private taskTaken = false;
  private goalsTaken = false;

  constructor(readonly script: ThothRealProviderFlowScript) {}

  takeClarifyInput(): ThothRealProviderFlowScript["clarify"][number] | null {
    const input = this.script.clarify[this.clarifyIndex];
    if (!input) return null;
    this.clarifyIndex += 1;
    return input;
  }

  takeTaskInput(): ThothRealProviderFlowScript["task"] {
    if (this.taskTaken) return null;
    this.taskTaken = true;
    return this.script.task;
  }

  takeGoalsInput(): ThothRealProviderFlowScript["goals"] {
    if (this.goalsTaken) return null;
    this.goalsTaken = true;
    return this.script.goals;
  }

  takePlanExecIndex(): number {
    return this.planExecIndex++;
  }

  takeReviewIndex(): number {
    return this.reviewIndex++;
  }

  get planExecCalls(): number {
    return this.planExecIndex;
  }

  get reviewCalls(): number {
    return this.reviewIndex;
  }

  async createSession(
    _config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const session = new ScriptedThothSession(
      `scripted-session-${++this.nextSession}`,
      launchContext?.thothTools,
      this,
    );
    this.sessions.push(session);
    return session;
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    config?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return await this.createSession(
      { provider: "codex", cwd: config?.cwd ?? process.cwd(), ...config },
      launchContext,
    );
  }

  async fetchCatalog(): Promise<{ models: AgentModelDefinition[]; modes: AgentMode[] }> {
    return {
      models: [
        { provider: "codex", id: "scripted-codex", label: "Scripted Codex", isDefault: true },
      ],
      modes: [{ id: "auto", label: "Auto" }],
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

let cardCommandSequence = 0;

async function waitForPendingCard(
  client: DaemonClient,
  agentId: string,
  kind: "clarify_card" | "task_card" | "goal_card",
): Promise<ThothClarifyCardModel | ThothTaskCardModel | ThothGoalsCardModel> {
  return await waitFor(async () => {
    const payload = await client.getAgentThothState(agentId);
    if (payload.error) {
      throw new Error(payload.error);
    }
    const pending = payload.state.pendingCard;
    return pending?.kind === kind && pending.card.submitted === false ? pending.card : null;
  });
}

async function answerPendingCard(input: {
  client: DaemonClient;
  agentId: string;
  cardId: string;
  answer: ThothCardAnswerPayload;
}): Promise<void> {
  const state = await input.client.getAgentThothState(input.agentId);
  if (state.error) {
    throw new Error(state.error);
  }
  const result = await input.client.answerAgentThothCard({
    agentId: input.agentId,
    cardId: input.cardId,
    answer: input.answer,
    expectedRevision: state.state.revision,
    commandId: `e2e-card-${++cardCommandSequence}`,
  });
  if (result.error || result.conflict || !result.accepted) {
    throw new Error(result.error ?? "Agent-scoped card answer was rejected");
  }
}

async function waitForAgentIdle(client: DaemonClient, agentId: string): Promise<void> {
  await waitFor(async () => {
    const snapshot = await client.fetchAgent({ agentId });
    return snapshot?.agent.status === "idle" ? true : null;
  });
}

async function waitForThothLifecycle(
  client: DaemonClient,
  agentId: string,
  lifecycle:
    | "idle"
    | "running"
    | "awaiting_card"
    | "quick_exec"
    | "background_handoff"
    | "interrupted"
    | "done"
    | "canceled"
    | "unsupported",
) {
  return await waitFor(async () => {
    const payload = await client.getAgentThothState(agentId);
    if (payload.error) throw new Error(payload.error);
    return payload.state.lifecycle === lifecycle ? payload.state : null;
  });
}

async function answerClarifyWithFirstChoices(
  client: DaemonClient,
  agentId: string,
): Promise<ThothClarifyCardModel> {
  const clarify = (await waitForPendingCard(
    client,
    agentId,
    "clarify_card",
  )) as ThothClarifyCardModel;
  await answerPendingCard({
    client,
    agentId,
    cardId: clarify.id,
    answer: {
      intent: "submit_choices",
      question_card_id: clarify.id,
      title: clarify.title,
      answers:
        "questions" in clarify.card
          ? clarify.card.questions.map((question) => ({
              question_id: question.id,
              choice_ids: [question.choices[0]!.id],
              choice_notes: {},
            }))
          : [],
      raw_answer: "Use every first fixed option.",
    },
  });
  return clarify;
}

async function approveTaskAndGoals(input: {
  client: DaemonClient;
  agentId: string;
  mode: "quick" | "loop";
}): Promise<void> {
  const intent = input.mode === "loop" ? "accept_loop" : "accept_quick";
  const task = (await waitForPendingCard(
    input.client,
    input.agentId,
    "task_card",
  )) as ThothTaskCardModel;
  await answerPendingCard({
    client: input.client,
    agentId: input.agentId,
    cardId: task.id,
    answer: {
      intent,
      card_id: task.id,
      title: task.title,
      raw_answer: `Accept the fixed ${input.mode} task.`,
    },
  });

  const goals = (await waitForPendingCard(
    input.client,
    input.agentId,
    "goal_card",
  )) as ThothGoalsCardModel;
  await answerPendingCard({
    client: input.client,
    agentId: input.agentId,
    cardId: goals.id,
    answer: {
      intent,
      card_id: goals.id,
      title: goals.title,
      raw_answer:
        input.mode === "loop"
          ? "Register the fixed background flow."
          : "Execute every fixed goal in the foreground.",
    },
  });
}

async function timelineContains(
  client: DaemonClient,
  agentId: string,
  marker: string,
): Promise<boolean> {
  const timeline = await client.fetchAgentTimeline(agentId, { limit: 200 });
  return timeline.entries.some(
    (entry) => entry.item.type === "assistant_message" && entry.item.text.includes(marker),
  );
}

describe("public foreground Thoth router", () => {
  let daemon: TestThothDaemon | null = null;
  let client: DaemonClient | null = null;
  const workspaces: string[] = [];

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    await daemon?.close().catch(() => undefined);
    client = null;
    daemon = null;
    for (const workspace of workspaces.splice(0)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("UT-01 runs a raw direct turn through Create Agent without opening Thoth authority", async () => {
    const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickDirect;
    const provider = new ScriptedThothClient(script);
    daemon = await createTestThothDaemon({ agentClients: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-direct-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "Run the deterministic direct flow.",
      thoth: { enabled: false },
    });

    await waitForAgentIdle(client, agent.id);
    const authority = await waitForThothLifecycle(client, agent.id, "done");
    expect(authority.turn).toMatchObject({ kind: "raw" });
    expect(authority.pendingCard).toBeNull();
    expect(provider.sessions).toHaveLength(1);
    expect(provider.sessions[0]?.dynamicToolCount).toBeGreaterThan(0);
    expect(await timelineContains(client, agent.id, script.finalMarker)).toBe(true);
    const background = await client.listBackgroundTasks({ workspacePath: cwd });
    expect(background.tasks.every((task) => task.status === "empty")).toBe(true);
  }, 30_000);

  it("UT-02 hot-switches raw -> Quick Clarify -> raw on one visible provider session", async () => {
    const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyForeground;
    const provider = new ScriptedThothClient(script);
    daemon = await createTestThothDaemon({ agentClients: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-hot-switch-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "RAW_FIRST",
      thoth: { enabled: false },
    });
    const visibleSession = provider.sessions[0]!;
    expect(visibleSession.dynamicToolCount).toBeGreaterThan(0);
    await waitForAgentIdle(client, agent.id);
    expect(visibleSession.turnCount).toBe(1);

    await client.sendAgentMessage(agent.id, "QUICK_CLARIFY", {
      thoth: {
        enabled: true,
        executionMode: "quick",
        clarifyStrength: "light",
      },
    });
    await answerClarifyWithFirstChoices(client, agent.id);
    await answerClarifyWithFirstChoices(client, agent.id);
    await approveTaskAndGoals({ client, agentId: agent.id, mode: "quick" });
    await waitForThothLifecycle(client, agent.id, "done");
    await waitForAgentIdle(client, agent.id);
    expect(visibleSession.turnCount).toBe(6);
    expect(await timelineContains(client, agent.id, script.finalMarker)).toBe(true);
    expect(await timelineContains(client, agent.id, "LATE_TEXT_AFTER_AUTHORITY_CARD")).toBe(false);

    await client.sendAgentMessage(agent.id, "RAW_LAST", { thoth: { enabled: false } });
    await waitForThothLifecycle(client, agent.id, "done");
    await waitForAgentIdle(client, agent.id);
    expect(visibleSession.turnCount).toBe(7);
    expect(provider.sessions[0]).toBe(visibleSession);
  }, 45_000);

  it("UT-03 preserves an open Card across daemon restart, then cancels and resumes on the same Agent", async () => {
    const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyRecovery;
    const provider = new ScriptedThothClient(script);
    daemon = await createTestThothDaemon({
      agentClients: { codex: provider },
      cleanup: false,
    });
    const thothHomeRoot = dirname(daemon.thothHome);
    const firstStaticDir = daemon.staticDir;
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-recovery-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "Run the deterministic recovery flow.",
      thoth: {
        enabled: true,
        executionMode: "quick",
        clarifyStrength: "light",
      },
    });
    const firstCard = (await waitForPendingCard(
      client,
      agent.id,
      "clarify_card",
    )) as ThothClarifyCardModel;
    await client.close();
    await daemon.close();
    client = null;
    daemon = null;
    rmSync(firstStaticDir, { recursive: true, force: true });
    resetForegroundAuthorityStoresForTest();

    daemon = await createTestThothDaemon({
      agentClients: { codex: provider },
      thothHomeRoot,
    });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const restored = (await waitForPendingCard(
      client,
      agent.id,
      "clarify_card",
    )) as ThothClarifyCardModel;
    expect(restored.id).toBe(firstCard.id);
    await client.cancelAgent(agent.id);
    const canceled = await waitForThothLifecycle(client, agent.id, "canceled");
    expect(canceled.pendingCard).toBeNull();

    await client.sendAgentMessage(agent.id, "Continue the fixed recovery flow.", {
      thoth: {
        enabled: true,
        executionMode: "quick",
        clarifyStrength: "light",
      },
    });
    await answerClarifyWithFirstChoices(client, agent.id);
    await approveTaskAndGoals({ client, agentId: agent.id, mode: "quick" });
    await waitForThothLifecycle(client, agent.id, "done");
    await waitForAgentIdle(client, agent.id);
    expect(await timelineContains(client, agent.id, script.finalMarker)).toBe(true);
    expect(provider.sessions.length).toBeGreaterThan(1);
  }, 60_000);

  it("UT-04 registers Loop Single and completes two linear goals after independent Reviews", async () => {
    const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopLinearPass;
    const provider = new ScriptedThothClient(script);
    daemon = await createTestThothDaemon({ agentClients: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-loop-pass-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "Run the deterministic all-pass Loop flow.",
      thoth: {
        enabled: true,
        executionMode: "loop",
        clarifyStrength: "light",
        loopStrength: "one_plan_one_do",
      },
    });
    await answerClarifyWithFirstChoices(client, agent.id);
    await approveTaskAndGoals({ client, agentId: agent.id, mode: "loop" });
    const handoff = await waitForThothLifecycle(client, agent.id, "background_handoff");
    expect(handoff.backgroundTaskId).toBeTruthy();

    const taskResult = await waitFor(async () => {
      const payload = await client!.listBackgroundTasks({ workspacePath: cwd });
      const background = payload.tasks[0];
      return background?.status === "done" ? background : null;
    }, 30_000);
    const detail = await client.inspectBackgroundTask({
      taskId: taskResult.id,
      workspacePath: cwd,
    });
    expect(detail.error).toBeNull();
    expect(detail.task?.goals.map((goal) => goal.status)).toEqual(["passed", "passed"]);
    expect(detail.task?.budget).toMatchObject({ maxFailedReviews: 1, usedFailedReviews: 0 });
    expect(provider.planExecCalls).toBe(2);
    expect(provider.reviewCalls).toBe(2);
    const finalAgent = await client.fetchAgent({ agentId: agent.id });
    expect(finalAgent?.agent.status).toBe("idle");
  }, 45_000);

  it("UT-05 retries the failed goal automatically and completes before the Light budget", async () => {
    const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopRetryAndBudget;
    const provider = new ScriptedThothClient(script);
    daemon = await createTestThothDaemon({ agentClients: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-loop-retry-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "Run the deterministic retry Loop flow.",
      thoth: {
        enabled: true,
        executionMode: "loop",
        clarifyStrength: "light",
        loopStrength: "light",
      },
    });
    await answerClarifyWithFirstChoices(client, agent.id);
    await approveTaskAndGoals({ client, agentId: agent.id, mode: "loop" });
    await waitForThothLifecycle(client, agent.id, "background_handoff");

    const taskResult = await waitFor(async () => {
      const payload = await client!.listBackgroundTasks({ workspacePath: cwd });
      const background = payload.tasks[0];
      return background?.status === "done" ? background : null;
    }, 30_000);
    const detail = await client.inspectBackgroundTask({
      taskId: taskResult.id,
      workspacePath: cwd,
    });
    expect(detail.error).toBeNull();
    expect(detail.task?.budget).toMatchObject({ maxFailedReviews: 5, usedFailedReviews: 1 });
    expect(detail.task?.goals[0]?.round).toBe(2);
    expect(detail.task?.goals.map((goal) => goal.status)).toEqual(["passed", "passed"]);
    expect(provider.planExecCalls).toBe(3);
    expect(provider.reviewCalls).toBe(3);
    const finalAgent = await client.fetchAgent({ agentId: agent.id });
    expect(finalAgent?.agent.status).toBe("idle");
  }, 45_000);
});
