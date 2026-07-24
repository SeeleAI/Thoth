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
  HarnessAdapter,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionResult,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  HarnessThread,
  AgentSessionConfig,
  AgentStreamEvent,
} from "@thoth/drivers/agent-runtime";
import type { ThothToolCatalog } from "@thoth/drivers/agent-runtime";
import type {
  ThothCardAnswerPayload,
  ThothClarifyCardModel,
  ThothGoalsCardModel,
  ThothTaskCardModel,
} from "@thoth/protocol/thoth/rpc-schemas";
import { defineHarnessCapabilities } from "@thoth/drivers/harness";
import { experimental_createMCPClient } from "ai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readThothRuntimeToolsConfig } from "../agent/thoth-runtime-tools-config.js";
import type { HarnessToolAttachment } from "@thoth/drivers/harness";

const capabilities: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

interface ScriptedMcpClient {
  callTool(input: { name: string; args: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

async function createScriptedMcpClient(config: AgentSessionConfig): Promise<ScriptedMcpClient> {
  const server = config.mcpServers?.thoth;
  if (!server || (server.type !== "http" && server.type !== "sse")) {
    throw new Error("scripted Harness provider did not receive the Thoth MCP binding");
  }
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: server.headers ? { headers: server.headers } : undefined,
  });
  const client = await experimental_createMCPClient({ transport });
  return {
    callTool: Reflect.get(client, "callTool").bind(client) as ScriptedMcpClient["callTool"],
    close: () => client.close(),
  };
}

class ScriptedThothSession implements HarnessThread {
  readonly provider: string;
  readonly capabilities = capabilities;
  readonly id: string;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private activeTurnId: string | null = null;
  private turnOrdinal = 0;
  private toolOrdinal = 0;
  private closed = false;
  private mcpClient: Promise<ScriptedMcpClient> | null = null;
  private providerRunMode: "default" | "plan" = "default";
  private readonly pendingPermissions = new Map<string, AgentPermissionRequest>();
  readonly receivedPrompts: string[] = [];

  constructor(
    id: string,
    provider: string,
    private readonly transport: HarnessToolAttachment,
    private readonly config: AgentSessionConfig,
    private readonly tools: ThothToolCatalog | undefined,
    private readonly actor: ScriptedThothClient,
  ) {
    this.id = id;
    this.provider = provider;
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
    options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.activeTurnId) {
      throw new Error("scripted session already has an active turn");
    }
    const turnId = `${this.id}-turn-${++this.turnOrdinal}`;
    this.activeTurnId = turnId;
    this.receivedPrompts.push(typeof prompt === "string" ? prompt : JSON.stringify(prompt));
    queueMicrotask(() => void this.runActor(prompt, turnId, options?.messageId));
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return { provider: this.provider, sessionId: this.id, model: `scripted-${this.provider}` };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return [
      { id: "auto", label: "Auto" },
      { id: "plan", label: "Plan" },
    ];
  }

  async getCurrentMode(): Promise<string | null> {
    return this.providerRunMode === "plan" ? "plan" : "auto";
  }

  async setMode(modeId: string): Promise<void> {
    this.providerRunMode = modeId === "plan" ? "plan" : "default";
  }

  async getProviderRunModeCapability() {
    return { kind: "native" } as const;
  }

  async applyProviderRunMode(mode: "default" | "plan") {
    this.providerRunMode = mode;
    return {
      capability: { kind: "native" } as const,
      nativeModeId: mode === "plan" ? "plan" : "auto",
    };
  }

  getPendingPermissions() {
    return [...this.pendingPermissions.values()];
  }

  async respondToPermission(
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    const request = this.pendingPermissions.get(requestId);
    if (!request) throw new Error(`Unknown scripted provider permission ${requestId}`);
    this.pendingPermissions.delete(requestId);
    this.emit({
      type: "permission_resolved",
      provider: this.provider,
      requestId,
      resolution: response,
    });
    if (response.behavior === "deny") return;
    if (request.kind === "plan") {
      await this.applyProviderRunMode("default");
      const plan = typeof request.metadata?.planText === "string" ? request.metadata.planText : "";
      return {
        followUpPrompt: ["Implement the approved native plan now.", plan]
          .filter(Boolean)
          .join("\n\n"),
      };
    }
  }

  describePersistence(): AgentPersistenceHandle {
    return { provider: this.provider, sessionId: this.id, metadata: { threadId: this.id } };
  }

  async interrupt(): Promise<void> {
    const turnId = this.activeTurnId;
    if (!turnId) return;
    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId,
      providerTurnId: turnId,
      item: { type: "reasoning", text: `LATE_REASONING_AFTER_AUTHORITY_CARD:${turnId}` },
    });
    this.emit({
      type: "timeline",
      provider: this.provider,
      turnId,
      providerTurnId: turnId,
      item: { type: "assistant_message", text: `LATE_TEXT_AFTER_AUTHORITY_CARD:${turnId}` },
    });
    this.activeTurnId = null;
    this.emit({
      type: "turn_canceled",
      provider: this.provider,
      reason: "scripted interrupt",
      turnId,
      providerTurnId: turnId,
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.interrupt();
    await (await this.mcpClient)?.close().catch(() => undefined);
    this.subscribers.clear();
  }

  private emit(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  private async callTool(name: string, input: unknown, turnId: string): Promise<void> {
    this.actor.recordToolTransport(this.transport);
    this.actor.recordToolReceipt(`${turnId}:${name}:start`);
    if (this.transport !== "native") {
      this.mcpClient ??= createScriptedMcpClient(this.config);
      const result = await (
        await this.mcpClient
      ).callTool({
        name,
        args: input as Record<string, unknown>,
      });
      if (
        result &&
        typeof result === "object" &&
        "isError" in result &&
        (result as { isError?: unknown }).isError === true
      ) {
        this.actor.recordToolReceipt(`${turnId}:${name}:error:${JSON.stringify(result)}`);
        throw new Error(`MCP tool ${name} failed: ${JSON.stringify(result)}`);
      }
      this.actor.recordToolReceipt(`${turnId}:${name}:ok`);
      return;
    }
    if (!this.tools?.getTool(name)) throw new Error(`scripted session is missing ${name}`);
    await this.tools.executeTool(name, input, {
      providerToolCall: {
        provider: this.provider,
        threadId: this.id,
        turnId,
        callId: `${turnId}-${++this.toolOrdinal}-${name}`,
        toolName: name,
        isActiveProviderTurn: this.activeTurnId === turnId,
      },
    });
    this.actor.recordToolReceipt(`${turnId}:${name}:ok`);
  }

  private async runActor(
    prompt: AgentPromptInput,
    turnId: string,
    canonicalMessageId?: string,
  ): Promise<void> {
    this.emit({ type: "thread_started", provider: this.provider, sessionId: this.id });
    this.emit({
      type: "turn_started",
      provider: this.provider,
      turnId,
      providerTurnId: turnId,
    });
    if (canonicalMessageId) {
      this.emit({
        type: "timeline",
        provider: this.provider,
        turnId,
        providerTurnId: turnId,
        item: {
          type: "user_message",
          text: typeof prompt === "string" ? prompt : JSON.stringify(prompt),
          messageId: canonicalMessageId,
        },
      });
    }
    try {
      const scope = readThothRuntimeToolsConfig(this.config)?.scope ?? null;
      if (this.providerRunMode === "plan") {
        const plan = [
          "Inspect the current Workspace state.",
          "Implement the approved Goal in this same provider thread.",
          "Run the Goal acceptance checks and submit the semantic PlanExec result.",
        ].join("\n");
        this.emit({
          type: "timeline",
          provider: this.provider,
          turnId,
          providerTurnId: turnId,
          item: { type: "assistant_message", text: plan },
        });
        const request: AgentPermissionRequest = {
          id: `${turnId}-implement`,
          provider: this.provider,
          name: "ScriptedNativePlanApproval",
          kind: "plan",
          title: "Plan",
          description: "Review the provider-native Plan before implementation.",
          input: { plan },
          actions: [
            { id: "reject", label: "Reject", behavior: "deny", variant: "secondary" },
            {
              id: "implement",
              label: "Implement",
              behavior: "allow",
              variant: "primary",
              intent: "implement",
            },
          ],
          metadata: { source: "scripted_native_plan", planText: plan },
        };
        this.pendingPermissions.set(request.id, request);
        this.emit({
          type: "permission_requested",
          provider: this.provider,
          request,
          turnId,
          providerTurnId: turnId,
        });
      } else if (scope === "clarify_audit") {
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
      } else if (scope === "loop_planexec") {
        const input = this.actor.script.planExec[this.actor.takePlanExecIndex()];
        if (!input) throw new Error("unexpected PlanExec attempt");
        await this.callTool("thoth_loop_submit_planexec_result", input, turnId);
      } else if (scope === "loop_review") {
        const index = this.actor.takeReviewIndex();
        const independent = this.actor.script.reviewIndependent[index];
        const verdict = this.actor.script.review[index];
        if (!independent || !verdict) throw new Error("unexpected Review attempt");
        await this.callTool("thoth_loop_submit_review_independent_assessment", independent, turnId);
        await this.callTool("thoth_loop_submit_review_verdict", verdict, turnId);
      } else if (
        scope === "clarify" &&
        JSON.stringify(prompt).includes("Follow the installed thoth.clarify skill")
      ) {
        for (;;) {
          const clarify = this.actor.takeClarifyInput();
          if (!clarify) break;
          await this.callTool("thoth_submit_clarify_card", clarify, turnId);
          return;
        }
        const task = this.actor.takeTaskInput();
        if (task) {
          await this.callTool("thoth_submit_task_card", task, turnId);
          return;
        }
        const goals = this.actor.takeGoalsInput();
        if (goals) {
          await this.callTool("thoth_submit_goals_card", goals, turnId);
          return;
        }
      } else {
        this.emit({
          type: "timeline",
          provider: this.provider,
          turnId,
          item: { type: "assistant_message", text: this.actor.script.finalMarker },
        });
      }
      if (this.closed || this.activeTurnId !== turnId) return;
      this.activeTurnId = null;
      this.emit({
        type: "turn_completed",
        provider: this.provider,
        turnId,
        providerTurnId: turnId,
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    } catch (error) {
      if (this.closed || this.activeTurnId !== turnId) return;
      this.activeTurnId = null;
      this.emit({
        type: "turn_failed",
        provider: this.provider,
        turnId,
        providerTurnId: turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

class ScriptedThothClient implements HarnessAdapter {
  readonly provider: string;
  readonly capabilities: AgentCapabilityFlags;
  readonly harnessCapabilities;
  readonly sessions: ScriptedThothSession[] = [];
  private nextSession = 0;
  private clarifyIndex = 0;
  private planExecIndex = 0;
  private reviewIndex = 0;
  private taskTaken = false;
  private goalsTaken = false;
  private readonly toolCallsByTransport = new Map<HarnessToolAttachment, number>();
  readonly toolReceipts: string[] = [];

  constructor(
    readonly script: ThothRealProviderFlowScript,
    options: { provider?: string; transport?: HarnessToolAttachment } = {},
  ) {
    this.provider = options.provider ?? "codex";
    this.transport = options.transport ?? "native";
    this.capabilities = {
      ...capabilities,
      supportsMcpServers: this.transport !== "native",
    };
    this.harnessCapabilities = defineHarnessCapabilities({
      toolAttachment: [this.transport],
      plan: { kind: "native" },
    });
  }

  private readonly transport: HarnessToolAttachment;

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

  recordToolTransport(transport: HarnessToolAttachment): void {
    this.toolCallsByTransport.set(transport, (this.toolCallsByTransport.get(transport) ?? 0) + 1);
  }

  recordToolReceipt(receipt: string): void {
    this.toolReceipts.push(receipt);
  }

  toolCallsFor(transport: HarnessToolAttachment): number {
    return this.toolCallsByTransport.get(transport) ?? 0;
  }

  get planExecCalls(): number {
    return this.planExecIndex;
  }

  get reviewCalls(): number {
    return this.reviewIndex;
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<HarnessThread> {
    const session = new ScriptedThothSession(
      `scripted-${this.provider}-session-${++this.nextSession}`,
      this.provider,
      this.transport,
      config,
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
  ): Promise<HarnessThread> {
    return await this.createSession(
      { provider: this.provider, cwd: config?.cwd ?? process.cwd(), ...config },
      launchContext,
    );
  }

  async fetchCatalog(): Promise<{
    models: AgentModelDefinition[];
    modes: AgentMode[];
    planCapability: { kind: "native" };
  }> {
    return {
      models: [
        {
          provider: this.provider,
          id: `scripted-${this.provider}`,
          label: `Scripted ${this.provider}`,
          isDefault: true,
        },
      ],
      modes: [
        { id: "auto", label: "Auto" },
        { id: "plan", label: "Plan" },
      ],
      planCapability: { kind: "native" },
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
let approvalCommandSequence = 0;

async function waitForPendingCard(
  client: DaemonClient,
  agentId: string,
  kind: "clarify_card" | "task_card" | "goal_card",
): Promise<ThothClarifyCardModel | ThothTaskCardModel | ThothGoalsCardModel> {
  const deadline = Date.now() + 15_000;
  let last: unknown = null;
  while (Date.now() < deadline) {
    const payload = await client.getAgentThothState(agentId);
    if (payload.error) {
      throw new Error(payload.error);
    }
    last = payload.state;
    const pending = payload.state.pendingCard;
    if (pending?.kind === kind && pending.card.submitted === false) return pending.card;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const agent = await client.fetchAgent({ agentId });
  throw new Error(
    `Timed out waiting for ${kind}: state=${JSON.stringify(last)} agent=${JSON.stringify(agent)}`,
  );
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
    | "awaiting_implementation"
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

async function waitForCompletedTask(client: DaemonClient, workspaceId: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: unknown = null;
  while (Date.now() < deadline) {
    const payload = await client.listTasks(workspaceId);
    const task = payload.tasks[0];
    if (task?.status === "completed") return task;
    if (task) {
      lastDetail = await client.getTask({ taskId: task.id, workspaceId });
      for (const execution of lastDetail.executions) {
        const approval = execution.pendingApproval;
        if (!approval) continue;
        const resolved = await client.resolveExecutionApproval({
          workspaceId,
          taskId: task.id,
          executionId: execution.id,
          approvalId: approval.id,
          decision: approval.kind === "implement" ? "implement" : "allow",
          expectedRevision: approval.revision,
          commandId: `e2e-execution-approval-${++approvalCommandSequence}`,
        });
        if (resolved.error && !resolved.conflict) {
          throw new Error(resolved.error);
        }
      }
      if (task.status === "interrupted") {
        const timelines = await Promise.all(
          lastDetail.executions.map(async (execution) => ({
            executionId: execution.id,
            timeline: await client.getExecutionTimeline({
              workspaceId,
              taskId: task.id,
              executionId: execution.id,
              limit: 100,
            }),
          })),
        );
        throw new Error(
          `Task interrupted before completion: detail=${JSON.stringify(lastDetail)} timelines=${JSON.stringify(timelines)}`,
        );
      }
    } else {
      lastDetail = payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for completed Task: ${JSON.stringify(lastDetail)}`);
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
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: provider } });
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
    expect(agent.workspaceId).toBeTruthy();
    const tasks = await client.listTasks(agent.workspaceId!);
    expect(tasks.error).toBeNull();
    expect(tasks.tasks).toEqual([]);
  }, 30_000);

  it("UT-02 hot-switches raw -> Quick Clarify -> raw on one visible provider session", async () => {
    const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyForeground;
    const provider = new ScriptedThothClient(script);
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: provider } });
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

  it("UT-02c durably queues suspended-card input and serializes Interrupt before later turns", async () => {
    const provider = new ScriptedThothClient(THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyRecovery);
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-turn-queue-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "OPEN_CARD",
      thoth: {
        enabled: true,
        executionMode: "quick",
        clarifyStrength: "light",
      },
    });
    await waitForPendingCard(client, agent.id, "clarify_card");
    const session = provider.sessions[0]!;

    const first = await client.sendAgentMessage(agent.id, "QUEUE_FIRST", {
      messageId: "canonical-queue-first",
      thoth: { enabled: false },
      deliveryMode: "queue",
    });
    const second = await client.sendAgentMessage(agent.id, "INTERRUPT_SECOND", {
      messageId: "canonical-interrupt-second",
      thoth: { enabled: false },
      deliveryMode: "queue",
    });
    expect(first.turnAck).toMatchObject({ disposition: "queued", queuePosition: 1 });
    expect(second.turnAck).toMatchObject({ disposition: "queued", queuePosition: 2 });
    expect(session.turnCount).toBe(1);

    const queued = await client.getAgentThothState(agent.id);
    expect(queued.state.queuedTurns?.map((turn) => turn.messageId)).toEqual([
      "canonical-queue-first",
      "canonical-interrupt-second",
    ]);
    const interrupt = await client.commandAgentTurnQueue({
      agentId: agent.id,
      queuedTurnId: queued.state.queuedTurns![1]!.id,
      command: "interrupt",
      expectedRevision: queued.state.revision,
      commandId: "queue-command-interrupt-second",
    });
    expect(interrupt).toMatchObject({ accepted: true, conflict: false });
    expect(interrupt.queuedTurns.map((turn) => turn.messageId)).toEqual([
      "canonical-interrupt-second",
      "canonical-queue-first",
    ]);

    try {
      await waitFor(async () => {
        const state = await client!.getAgentThothState(agent.id);
        return session.turnCount === 3 && state.state.queuedTurns?.length === 0 ? true : null;
      });
    } catch (error) {
      const state = await client.getAgentThothState(agent.id);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}: ${JSON.stringify({
          turnCount: session.turnCount,
          receivedPrompts: session.receivedPrompts,
          state: state.state,
        })}`,
      );
    }
    await waitForAgentIdle(client, agent.id);
    expect(session.receivedPrompts.slice(-2)).toEqual(["INTERRUPT_SECOND", "QUEUE_FIRST"]);

    const timeline = await client.fetchAgentTimeline(agent.id, { limit: 0 });
    const queuedMessageIds = timeline.entries.flatMap((entry) =>
      entry.item.type === "user_message" &&
      (entry.item.messageId === "canonical-queue-first" ||
        entry.item.messageId === "canonical-interrupt-second")
        ? [entry.item.messageId]
        : [],
    );
    expect(queuedMessageIds).toEqual(["canonical-interrupt-second", "canonical-queue-first"]);
    const replay = await client.sendAgentMessage(agent.id, "QUEUE_FIRST", {
      messageId: "canonical-queue-first",
      thoth: { enabled: false },
      deliveryMode: "interrupt",
    });
    expect(replay.turnAck).toMatchObject({ disposition: "started" });
    expect(session.turnCount).toBe(3);
    expect((await client.getAgentThothState(agent.id)).state.queuedTurns).toEqual([]);
  }, 30_000);

  it("UT-02b hot-switches default -> native Plan -> default on one provider thread", async () => {
    const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickDirect;
    const provider = new ScriptedThothClient(script);
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-plan-switch-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "DEFAULT_FIRST",
      thoth: { enabled: false },
      providerRunMode: "default",
    });
    await waitForAgentIdle(client, agent.id);
    const visibleSession = provider.sessions[0]!;

    await client.sendAgentMessage(agent.id, "PLAN_THIS_TURN", {
      thoth: { enabled: false },
      providerRunMode: "plan",
    });
    const awaitingImplementation = await waitForThothLifecycle(
      client,
      agent.id,
      "awaiting_implementation",
    );
    expect(awaitingImplementation.turn).toMatchObject({
      kind: "raw",
      providerRunMode: "plan",
      providerRunModeReceipt: { requestedMode: "plan", status: "applied" },
    });
    expect(awaitingImplementation.pendingCard).toBeNull();
    const planPermission = await waitFor(async () => {
      const snapshot = await client!.fetchAgent({ agentId: agent.id });
      return (
        snapshot?.agent.pendingPermissions.find((permission) => permission.kind === "plan") ?? null
      );
    });
    await client.respondToPermission(agent.id, planPermission.id, {
      behavior: "allow",
      selectedActionId: "implement",
    });
    await waitForThothLifecycle(client, agent.id, "done");
    await waitForAgentIdle(client, agent.id);

    await client.sendAgentMessage(agent.id, "DEFAULT_LAST", {
      thoth: { enabled: false },
      providerRunMode: "default",
    });
    const defaultTurn = await waitForThothLifecycle(client, agent.id, "done");
    await waitForAgentIdle(client, agent.id);
    expect(defaultTurn.turn).toMatchObject({
      kind: "raw",
      providerRunMode: "default",
      providerRunModeReceipt: { requestedMode: "default", status: "applied" },
    });
    expect(provider.sessions).toHaveLength(1);
    expect(provider.sessions[0]).toBe(visibleSession);
    expect(visibleSession.turnCount).toBe(4);
  }, 30_000);

  it("UT-03 preserves an open Card across daemon restart, then cancels and resumes on the same Agent", async () => {
    const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyRecovery;
    const provider = new ScriptedThothClient(script);
    daemon = await createTestThothDaemon({
      harnessAdapters: { codex: provider },
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
    const queuedBeforeRestart = await client.sendAgentMessage(agent.id, "PERSISTED_QUEUE", {
      messageId: "canonical-persisted-queue",
      thoth: { enabled: false },
      deliveryMode: "queue",
    });
    expect(queuedBeforeRestart.turnAck?.disposition).toBe("queued");
    await client.close();
    await daemon.close();
    client = null;
    daemon = null;
    rmSync(firstStaticDir, { recursive: true, force: true });
    daemon = await createTestThothDaemon({
      harnessAdapters: { codex: provider },
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
    const restoredState = await client.getAgentThothState(agent.id);
    expect(restoredState.state.queuedTurns?.map((turn) => turn.messageId)).toEqual([
      "canonical-persisted-queue",
    ]);
    const deleted = await client.commandAgentTurnQueue({
      agentId: agent.id,
      queuedTurnId: restoredState.state.queuedTurns![0]!.id,
      command: "delete",
      expectedRevision: restoredState.state.revision,
      commandId: "queue-command-delete-after-restart",
    });
    expect(deleted).toMatchObject({ accepted: true, queuedTurns: [] });
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

  it("UT-03b answers an open Card after daemon restart and continues on the same Agent", async () => {
    const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyRecovery;
    const provider = new ScriptedThothClient(script);
    daemon = await createTestThothDaemon({
      harnessAdapters: { codex: provider },
      cleanup: false,
    });
    const thothHomeRoot = dirname(daemon.thothHome);
    const firstStaticDir = daemon.staticDir;
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-answer-recovery-"));
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
    daemon = await createTestThothDaemon({
      harnessAdapters: { codex: provider },
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
    await answerClarifyWithFirstChoices(client, agent.id);
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
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: provider } });
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

    expect(agent.workspaceId).toBeTruthy();
    const taskResult = await waitForCompletedTask(client, agent.workspaceId!);
    const detail = await client.getTask({
      taskId: taskResult.id,
      workspaceId: agent.workspaceId!,
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
    const fixtureHomeRoot = process.env.THOTH_REFACTOR_RELEASE_FIXTURE_HOME?.trim();
    if (fixtureHomeRoot) {
      rmSync(fixtureHomeRoot, { recursive: true, force: true });
    }
    daemon = await createTestThothDaemon({
      harnessAdapters: { codex: provider },
      ...(fixtureHomeRoot ? { thothHomeRoot: fixtureHomeRoot, cleanup: false } : undefined),
    });
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

    expect(agent.workspaceId).toBeTruthy();
    const taskResult = await waitForCompletedTask(client, agent.workspaceId!);
    const detail = await client.getTask({
      taskId: taskResult.id,
      workspaceId: agent.workspaceId!,
    });
    expect(detail.error).toBeNull();
    expect(detail.task?.budget).toMatchObject({ maxFailedReviews: 5, usedFailedReviews: 1 });
    const firstGoalId = detail.task?.goals[0]?.id;
    expect(
      detail.executions.filter(
        (execution) => execution.goalId === firstGoalId && execution.phase === "planexec",
      ),
    ).toHaveLength(2);
    expect(detail.task?.goals.map((goal) => goal.status)).toEqual(["passed", "passed"]);
    expect(provider.planExecCalls).toBe(3);
    expect(provider.reviewCalls).toBe(3);
    const finalAgent = await client.fetchAgent({ agentId: agent.id });
    expect(finalAgent?.agent.status).toBe("idle");
  }, 45_000);

  it.each([
    { providerId: "codex", transport: "native" as const },
    { providerId: "claude", transport: "mcp" as const },
    { providerId: "opencode", transport: "mcp" as const },
    { providerId: "acp-fixture", transport: "mcp" as const },
  ])(
    "Harness lifecycle conformance: $providerId over $transport",
    async ({ providerId, transport }) => {
      const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopRetryAndBudget;
      const provider = new ScriptedThothClient(script, { provider: providerId, transport });
      daemon = await createTestThothDaemon({ harnessAdapters: { [providerId]: provider } });
      client = new DaemonClient({
        url: `ws://127.0.0.1:${daemon.port}/ws`,
        reconnect: { enabled: false },
      });
      await client.connect();

      const cwd = mkdtempSync(join(tmpdir(), `thoth-adapter-${providerId}-`));
      workspaces.push(cwd);
      const agent = await client.createAgent({
        provider: providerId,
        model: `scripted-${providerId}`,
        modeId: "auto",
        cwd,
        initialPrompt: "Run the shared HarnessAdapter conformance flow.",
        thoth: {
          enabled: true,
          executionMode: "loop",
          clarifyStrength: "light",
          loopStrength: "light",
        },
      });
      try {
        await answerClarifyWithFirstChoices(client, agent.id);
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} receipts=${JSON.stringify(provider.toolReceipts)}`,
        );
      }
      await approveTaskAndGoals({ client, agentId: agent.id, mode: "loop" });
      await waitForThothLifecycle(client, agent.id, "background_handoff");

      const task = await waitForCompletedTask(client, agent.workspaceId!, 45_000);
      const detail = await client.getTask({
        taskId: task.id,
        workspaceId: agent.workspaceId!,
      });
      expect(detail.error).toBeNull();
      expect(detail.task?.budget).toMatchObject({ usedFailedReviews: 1, maxFailedReviews: 5 });
      expect(detail.task?.goals.map((goal) => goal.status)).toEqual(["passed", "passed"]);
      expect(detail.executions).toHaveLength(6);
      expect(
        detail.executions.every((execution) => execution.attachment?.status === "attached"),
      ).toBe(true);
      expect(provider.planExecCalls).toBe(3);
      expect(provider.reviewCalls).toBe(3);
      expect(provider.toolCallsFor(transport)).toBeGreaterThan(0);
    },
    60_000,
  );
});
