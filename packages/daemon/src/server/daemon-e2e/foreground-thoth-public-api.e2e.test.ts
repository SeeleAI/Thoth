import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DaemonClient } from "../test-utils/index.js";
import { createTestThothDaemon, type TestThothDaemon } from "../test-utils/thoth-daemon.js";
import {
  ACTIVE_DECISION_ROOT_PLACEHOLDER,
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
  ProviderQuestionProjection,
  ProviderQuestionResolution,
  HarnessThread,
  AgentSessionConfig,
  AgentStreamEvent,
} from "@thoth/drivers/agent-runtime";
import type { ThothToolCatalog } from "@thoth/drivers/agent-runtime";
import type {
  ThothCardAnswerPayload,
  ThothClarifyCardModel,
  ThothIntentContractCardModel,
} from "@thoth/protocol/thoth/rpc-schemas";
import { defineHarnessCapabilities } from "@thoth/drivers/harness";
import { experimental_createMCPClient } from "ai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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

interface ScriptedTurnReceipt {
  sessionId: string;
  turnId: string;
  runtimeScope: string | null;
  providerRunMode: "default" | "plan";
  prompt: string;
}

function inspectPersistedDecisionTree(input: {
  thothHome: string;
  workspaceId: string;
  sessionId: string;
}): {
  nodeColumnNames: string[];
  storedNodeFieldNames: string[];
  forbiddenNodeFieldNames: string[];
  rootNodeCount: number;
  persistedNodeCount: number;
} {
  const database = new DatabaseSync(
    join(input.thothHome, "workspaces", input.workspaceId, "authority.sqlite"),
    { readOnly: true },
  );
  try {
    const nodeColumnNames = database
      .prepare("PRAGMA table_info(decision_tree_nodes)")
      .all()
      .map((row) => String((row as { name: unknown }).name))
      .sort();
    const rows = database
      .prepare("SELECT * FROM decision_tree_nodes WHERE session_id = ? ORDER BY node_id")
      .all(input.sessionId) as Array<Record<string, unknown>>;
    const forbiddenNodeFieldNames = nodeColumnNames.filter((field) =>
      /(chain|thought|reasoning|token|provider|thread|model|lease|cursor|receipt|hash|prompt)/iu.test(
        field,
      ),
    );
    const rootNodeCount = Number(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM decision_tree_nodes WHERE session_id = ? AND parent_id IS NULL",
          )
          .get(input.sessionId) as { count: number }
      ).count,
    );
    return {
      nodeColumnNames,
      storedNodeFieldNames: [...new Set(rows.flatMap((row) => Object.keys(row)))].sort(),
      forbiddenNodeFieldNames,
      rootNodeCount,
      persistedNodeCount: rows.length,
    };
  } finally {
    database.close();
  }
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
  private readonly pendingProviderQuestions = new Map<
    string,
    { projection: ProviderQuestionProjection; resolve: () => void }
  >();
  readonly providerQuestionResponses: ProviderQuestionResolution[] = [];
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

  get modelId(): string | null {
    return this.config.model ?? null;
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
    const promptText = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
    this.receivedPrompts.push(promptText);
    this.actor.recordTurnReceipt({
      sessionId: this.id,
      turnId,
      runtimeScope: options?.runtimeBundleActivation?.scope ?? null,
      providerRunMode: this.providerRunMode,
      prompt: promptText,
    });
    queueMicrotask(
      () =>
        void this.runActor(
          prompt,
          turnId,
          options?.messageId,
          options?.runtimeBundleActivation?.scope ?? null,
        ),
    );
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
    return this.actor.nativePlan
      ? ({ kind: "native" } as const)
      : ({
          kind: "unsupported",
          reason: "The scripted transport exposes no native Plan mode.",
        } as const);
  }

  async applyProviderRunMode(mode: "default" | "plan") {
    if (mode === "plan" && !this.actor.nativePlan) {
      return {
        capability: {
          kind: "unsupported" as const,
          reason: "The scripted transport exposes no native Plan mode.",
        },
        nativeModeId: null,
      };
    }
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

  async respondToProviderQuestion(
    interactionId: string,
    resolution: ProviderQuestionResolution,
  ): Promise<void> {
    const pending = this.pendingProviderQuestions.get(interactionId);
    if (!pending) throw new Error(`Unknown scripted Provider question ${interactionId}`);
    if (
      resolution.type === "answer" &&
      (resolution.answers.length !== 1 ||
        resolution.answers[0]?.questionId !== pending.projection.questions[0]?.id ||
        resolution.answers[0].values.length !== 1)
    ) {
      throw Object.assign(new Error("Invalid scripted Provider question response"), {
        code: "PROVIDER_QUESTION_INVALID_RESPONSE",
      });
    }
    this.pendingProviderQuestions.delete(interactionId);
    this.providerQuestionResponses.push(resolution);
    this.emit({
      type: "provider_question_resolved",
      provider: this.provider,
      interactionId,
      status: resolution.type === "answer" ? "answered" : "dismissed",
      turnId: this.activeTurnId ?? undefined,
    });
    pending.resolve();
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
    if (this.actor.simulateQuestionHandlerLossOnClose && this.pendingProviderQuestions.size > 0) {
      this.pendingProviderQuestions.clear();
      this.subscribers.clear();
      return;
    }
    for (const pending of this.pendingProviderQuestions.values()) pending.resolve();
    this.pendingProviderQuestions.clear();
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
    runtimeScope?: string | null,
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
      if (this.providerRunMode === "plan") {
        if (JSON.stringify(prompt).includes("PLAN_WITH_QUESTION")) {
          const interactionId = `${turnId}-question`;
          const projection: ProviderQuestionProjection = {
            interactionId,
            agentId:
              typeof this.config.title === "string" && this.config.title.startsWith("agent:")
                ? this.config.title.slice("agent:".length)
                : "",
            providerThreadId: this.id,
            providerTurnId: turnId,
            providerItemId: interactionId,
            revision: 0,
            questions: [
              {
                id: "target",
                header: "Target",
                prompt: "Choose the implementation target",
                options: [
                  { value: "local", label: "Local" },
                  { value: "ci", label: "CI" },
                ],
                selectionMode: "single",
                allowOther: false,
                secret: false,
              },
            ],
            expiresAt: null,
          };
          const agentId = this.actor.agentIdForSession(this.id);
          projection.agentId = agentId;
          await new Promise<void>((resolvePromise) => {
            this.pendingProviderQuestions.set(interactionId, {
              projection,
              resolve: resolvePromise,
            });
            this.emit({
              type: "provider_question_requested",
              provider: this.provider,
              question: projection,
              turnId,
              providerTurnId: turnId,
            });
          });
        }
        const plan = [
          "Inspect the current Workspace state.",
          "Choose one meaningful Work Unit against the stable Task Anchor.",
          "Implement it in this same Provider thread and submit a semantic checkpoint.",
        ].join("\n");
        this.emit({
          type: "timeline",
          provider: this.provider,
          turnId,
          providerTurnId: turnId,
          item: { type: "assistant_message", text: plan },
        });
        const bytes = Buffer.byteLength(plan, "utf8");
        const completedPlanEvent = {
          type: "provider_plan_completed",
          provider: this.provider,
          plan: {
            providerThreadId: this.id,
            providerTurnId: turnId,
            itemId: `${turnId}-plan`,
            text: plan,
            originalBytes: JSON.stringify(prompt).includes("PLAN_BYTE_MISMATCH")
              ? bytes + 1
              : bytes,
            retainedBytes: bytes,
          },
          turnId,
          providerTurnId: turnId,
        } as const;
        this.emit(completedPlanEvent);
        if (JSON.stringify(prompt).includes("PLAN_DUPLICATE")) {
          this.emit(completedPlanEvent);
        }
      } else if (runtimeScope === "clarify_challenger") {
        await this.callTool(
          "thoth_clarify_judge_contract",
          {
            decision: "stable",
            reason: "The Decision Tree covers the material fixture boundary.",
            missingNodes: [],
          },
          turnId,
        );
      } else if (runtimeScope === "loop_execute") {
        const humanDecision = this.actor.takeHumanDecisionInput();
        if (humanDecision) {
          await this.callTool("thoth_loop_request_human_decision", humanDecision, turnId);
          return;
        }
        if (!this.actor.takeSemanticOmission()) {
          const input = this.actor.script.checkpoints[this.actor.takeCheckpointIndex()];
          if (!input) throw new Error("unexpected Executor checkpoint");
          await this.callTool("thoth_loop_checkpoint", input, turnId);
        }
      } else if (runtimeScope === "loop_review") {
        const index = this.actor.takeReviewIndex();
        const review = this.actor.materializeReview(index, prompt);
        if (!review) throw new Error("unexpected Review attempt");
        await this.callTool("thoth_loop_review_decision", review, turnId);
      } else if (
        runtimeScope === "clarify" &&
        JSON.stringify(prompt).includes("Follow the installed thoth.clarify skill")
      ) {
        this.actor.prepareClarifyRun(prompt);
        const round = this.actor.takeClarifyInput();
        if (round) {
          await this.callTool("thoth_clarify_update_map", round.map, turnId);
          await this.callTool("thoth_clarify_ask", round.ask, turnId);
          return;
        }
        const contract = this.actor.takeContractInput();
        if (contract) await this.callTool("thoth_clarify_propose_contract", contract, turnId);
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
  private checkpointIndex = 0;
  private reviewIndex = 0;
  private contractTaken = false;
  private clarifyFlow: "initial" | "handoff" = "initial";
  private decisionRootNodeId: string | null = null;
  private humanDecisionTaken = false;
  private semanticOmissionsRemaining: number;
  private readonly toolCallsByTransport = new Map<HarnessToolAttachment, number>();
  private readonly agentIdsBySession = new Map<string, string>();
  readonly toolReceipts: string[] = [];
  readonly turnReceipts: ScriptedTurnReceipt[] = [];
  readonly simulateQuestionHandlerLossOnClose: boolean;
  readonly nativePlan: boolean;

  constructor(
    readonly script: ThothRealProviderFlowScript,
    options: {
      provider?: string;
      transport?: HarnessToolAttachment;
      simulateQuestionHandlerLossOnClose?: boolean;
      nativePlan?: boolean;
      semanticOmissions?: number;
    } = {},
  ) {
    this.provider = options.provider ?? "codex";
    this.transport = options.transport ?? "native";
    this.simulateQuestionHandlerLossOnClose = options.simulateQuestionHandlerLossOnClose ?? false;
    this.nativePlan = options.nativePlan ?? true;
    this.semanticOmissionsRemaining = options.semanticOmissions ?? 0;
    this.capabilities = {
      ...capabilities,
      supportsMcpServers: this.transport !== "native",
    };
    this.harnessCapabilities = defineHarnessCapabilities({
      toolAttachment: [this.transport],
      runtimeBundleActivation: "native_skill",
      plan: this.nativePlan
        ? { kind: "native" }
        : { kind: "unsupported", reason: "The scripted transport exposes no native Plan mode." },
    });
  }

  private readonly transport: HarnessToolAttachment;

  prepareClarifyRun(prompt: AgentPromptInput): void {
    const text = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
    const root = text.match(/"id"\s*:\s*"(decision-root-[^"]+)"/u)?.[1] ?? null;
    if (root) this.decisionRootNodeId = root;
    if (!root) return;
    this.clarifyFlow =
      text.includes("Background Task @") && this.script.handoffClarify ? "handoff" : "initial";
    const flow =
      this.clarifyFlow === "handoff" ? (this.script.handoffClarify ?? []) : this.script.clarify;
    this.clarifyIndex = flow.findIndex((round) => {
      const humanNodes = round.map.nodes.filter((node) => node.owner === "human");
      const statuses = humanNodes.map((node) => {
        const nodeStart = text.indexOf(`"id": ${JSON.stringify(node.id)}`);
        if (nodeStart < 0) return null;
        const statusStart = text.indexOf('"status": "', nodeStart);
        const nextNodeStart = text.indexOf('"id": "', nodeStart + 1);
        if (statusStart < 0 || (nextNodeStart >= 0 && nextNodeStart < statusStart)) return null;
        const valueStart = statusStart + '"status": "'.length;
        return text.slice(valueStart, text.indexOf('"', valueStart));
      });
      return (
        statuses.every((status) => status === null) ||
        statuses.some(
          (status) => status !== null && !["resolved", "delegated", "pruned"].includes(status),
        )
      );
    });
    if (this.clarifyIndex < 0) this.clarifyIndex = flow.length;
    this.contractTaken = false;
  }

  takeClarifyInput(): ThothRealProviderFlowScript["clarify"][number] | null {
    const flow =
      this.clarifyFlow === "handoff" ? (this.script.handoffClarify ?? []) : this.script.clarify;
    const input = flow[this.clarifyIndex];
    if (!input) return null;
    this.clarifyIndex += 1;
    if (!this.decisionRootNodeId) throw new Error("Scripted Clarify run has no Decision Tree root");
    return {
      ...input,
      map: {
        ...input.map,
        nodes: input.map.nodes.map((node) => ({
          ...node,
          parentId:
            node.parentId === ACTIVE_DECISION_ROOT_PLACEHOLDER
              ? this.decisionRootNodeId
              : node.parentId,
        })),
      },
    };
  }

  takeContractInput(): ThothRealProviderFlowScript["contract"] {
    if (this.contractTaken) return null;
    this.contractTaken = true;
    return this.clarifyFlow === "handoff"
      ? (this.script.handoffContract ?? null)
      : this.script.contract;
  }

  takeHumanDecisionInput(): ThothRealProviderFlowScript["humanDecision"] | null {
    if (this.humanDecisionTaken || !this.script.humanDecision) return null;
    this.humanDecisionTaken = true;
    return this.script.humanDecision;
  }

  takeSemanticOmission(): boolean {
    if (this.semanticOmissionsRemaining <= 0) return false;
    this.semanticOmissionsRemaining -= 1;
    return true;
  }

  takeCheckpointIndex(): number {
    return this.checkpointIndex++;
  }

  takeReviewIndex(): number {
    return this.reviewIndex++;
  }

  recordToolTransport(transport: HarnessToolAttachment): void {
    this.toolCallsByTransport.set(transport, (this.toolCallsByTransport.get(transport) ?? 0) + 1);
  }

  agentIdForSession(sessionId: string): string {
    const agentId = this.agentIdsBySession.get(sessionId);
    if (!agentId) throw new Error(`Scripted session ${sessionId} has no Agent binding`);
    return agentId;
  }

  recordToolReceipt(receipt: string): void {
    this.toolReceipts.push(receipt);
  }

  recordTurnReceipt(receipt: ScriptedTurnReceipt): void {
    this.turnReceipts.push(receipt);
  }

  toolCallsFor(transport: HarnessToolAttachment): number {
    return this.toolCallsByTransport.get(transport) ?? 0;
  }

  get checkpointCalls(): number {
    return this.checkpointIndex;
  }

  get reviewCalls(): number {
    return this.reviewIndex;
  }

  materializeReview(index: number, prompt: AgentPromptInput) {
    const review = this.script.reviews[index];
    if (!review) return null;
    const text = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
    const evidenceRefs = [...text.matchAll(/"ref"\s*:\s*"([^"]+)"/gu)].map((match) => match[1]!);
    if (review.decision !== "complete") return { ...review, evidenceRefs };
    const claimsBlock = /"acceptanceClaims"\s*:\s*\[([\s\S]*?)\]/u.exec(text)?.[1] ?? "";
    const claimIds = [...claimsBlock.matchAll(/"id"\s*:\s*"([^"]+)"/gu)].map((match) => match[1]!);
    const latestEvidence = evidenceRefs.at(-1);
    if (claimIds.length === 0 || !latestEvidence) {
      throw new Error("Review fixture could not resolve live Acceptance Claim and evidence refs");
    }
    return {
      ...review,
      evidenceRefs,
      acceptanceEvidence: Object.fromEntries(
        claimIds.map((claimId) => [claimId, [latestEvidence]]),
      ),
    };
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
    if (launchContext?.agentId) {
      this.agentIdsBySession.set(session.id, launchContext.agentId);
    }
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
    planCapability: { kind: "native" } | { kind: "unsupported"; reason: string };
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
      planCapability: this.nativePlan
        ? { kind: "native" }
        : { kind: "unsupported", reason: "The scripted transport exposes no native Plan mode." },
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
  kind: "clarify_card" | "intent_contract_card",
): Promise<ThothClarifyCardModel | ThothIntentContractCardModel> {
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
}) {
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
  return result;
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
      questionCardId: clarify.id,
      answers: clarify.card.questions.map((question) => ({
        nodeId: question.nodeId,
        choiceIds: [question.choices[0]!.id],
        choiceNotes: {},
      })),
      delegatedNodeIds: [],
      rawAnswer: "Use every first fixed option.",
    },
  });
  return clarify;
}

async function approveIntentContract(input: {
  client: DaemonClient;
  agentId: string;
  mode: "quick" | "loop";
}): Promise<void> {
  const intent = input.mode === "loop" ? "accept_loop" : "accept_quick";
  const contract = (await waitForPendingCard(
    input.client,
    input.agentId,
    "intent_contract_card",
  )) as ThothIntentContractCardModel;
  await answerPendingCard({
    client: input.client,
    agentId: input.agentId,
    cardId: contract.id,
    answer: {
      intent,
      cardId: contract.id,
      rawAnswer: `Accept the fixed ${input.mode} Intent Contract.`,
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

async function waitForCompletedTask(
  client: DaemonClient,
  workspaceId: string,
  timeoutMs = 30_000,
  maxExecutions = 12,
) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: unknown = null;
  while (Date.now() < deadline) {
    const payload = await client.listTasks(workspaceId);
    const task = payload.tasks[0];
    if (task?.status === "completed") return task;
    if (task) {
      lastDetail = await client.getTask({ taskId: task.id, workspaceId });
      if (lastDetail.executions.length > maxExecutions) {
        throw new Error(
          `Deterministic Task exceeded ${maxExecutions} Executions: ${JSON.stringify(
            lastDetail.executions.map((execution) => ({
              id: execution.id,
              phase: execution.phase,
              status: execution.status,
              cycleId: execution.cycleId,
              startedAt: execution.startedAt,
              summary: execution.summary,
            })),
          )}`,
        );
      }
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

async function waitForTaskAwaitingUser(
  client: DaemonClient,
  workspaceId: string,
  timeoutMs = 30_000,
) {
  return await waitFor(async () => {
    const listed = await client.listTasks(workspaceId);
    const task = listed.tasks[0];
    if (!task) return null;
    const detail = await client.getTask({ workspaceId, taskId: task.id });
    for (const execution of detail.executions) {
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
      if (resolved.error && !resolved.conflict) throw new Error(resolved.error);
    }
    return detail.task?.status === "awaiting_user" && detail.task.pendingDecision ? detail : null;
  }, timeoutMs);
}

describe("public foreground Thoth router", () => {
  let daemon: TestThothDaemon | null = null;
  let client: DaemonClient | null = null;
  const workspaces: string[] = [];
  const loopBehaviorEvidence: Record<string, unknown> = {};

  afterAll(() => {
    const receiptPath = process.env.THOTH_LOOP_BEHAVIOR_RECEIPT_PATH;
    if (!receiptPath) return;
    mkdirSync(dirname(receiptPath), { recursive: true });
    writeFileSync(
      receiptPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          journey: "public-api-target-anchored-loop",
          ...loopBehaviorEvidence,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  });

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
    await approveIntentContract({ client, agentId: agent.id, mode: "quick" });
    await waitForThothLifecycle(client, agent.id, "done");
    await waitForAgentIdle(client, agent.id);
    expect(visibleSession.turnCount).toBe(5);
    expect(await timelineContains(client, agent.id, script.finalMarker)).toBe(true);
    expect(await timelineContains(client, agent.id, "LATE_TEXT_AFTER_AUTHORITY_CARD")).toBe(false);
    const quickTasks = await client.listTasks(agent.workspaceId!);
    expect(quickTasks.tasks).toHaveLength(1);
    expect(quickTasks.tasks[0]).toMatchObject({
      mode: "quick",
      status: "completed",
      completionAuthority: "executor_unreviewed",
    });
    const quickDetail = await client.getTask({
      workspaceId: agent.workspaceId!,
      taskId: quickTasks.tasks[0]!.id,
    });
    expect(quickDetail.executions).toHaveLength(1);
    expect(quickDetail.executions[0]).toMatchObject({
      phase: "quick_exec",
      status: "succeeded",
      attachment: { bundleId: "thoth.clarify", status: "attached" },
    });
    expect(quickDetail.evidence).toEqual([
      expect.objectContaining({
        executionId: quickDetail.executions[0]!.id,
        kind: "quick_execution_result",
      }),
    ]);

    await client.sendAgentMessage(agent.id, "RAW_LAST", { thoth: { enabled: false } });
    await waitForThothLifecycle(client, agent.id, "done");
    await waitForAgentIdle(client, agent.id);
    expect(visibleSession.turnCount).toBe(6);
    expect(provider.sessions[0]).toBe(visibleSession);

    const clarifyTurns = provider.turnReceipts.filter(
      (receipt) => receipt.runtimeScope === "clarify",
    );
    const challengerTurns = provider.turnReceipts.filter(
      (receipt) => receipt.runtimeScope === "clarify_challenger",
    );
    const judgeToolCalls = provider.toolReceipts.filter((receipt) =>
      receipt.endsWith(":thoth_clarify_judge_contract:start"),
    );
    expect(clarifyTurns.length).toBeGreaterThanOrEqual(3);
    expect(new Set(clarifyTurns.map((receipt) => receipt.sessionId))).toEqual(
      new Set([visibleSession.id]),
    );
    expect(challengerTurns).toHaveLength(1);
    expect(challengerTurns[0]?.sessionId).not.toBe(visibleSession.id);
    expect(judgeToolCalls).toHaveLength(1);
    const clarifyAuthority = await client.getAgentDecisionSession({ agentId: agent.id });
    expect(clarifyAuthority.error).toBeNull();
    expect(clarifyAuthority.snapshot?.session.challengerUsed).toBe(true);

    const behaviorReceipt = {
      schemaVersion: 1,
      journey: "foreground-public-api-clarify-session-and-challenger",
      provider: provider.provider,
      visibleAgentId: agent.id,
      visibleProviderSessionId: visibleSession.id,
      visibleClarifyTurnIds: clarifyTurns.map((receipt) => receipt.turnId),
      visibleClarifySessionIds: [...new Set(clarifyTurns.map((receipt) => receipt.sessionId))],
      challengerProviderSessionId: challengerTurns[0]!.sessionId,
      challengerTurnIds: challengerTurns.map((receipt) => receipt.turnId),
      challengerLaunchCount: challengerTurns.length,
      judgeContractToolCallCount: judgeToolCalls.length,
      challengerUsed: clarifyAuthority.snapshot?.session.challengerUsed === true,
      visibleSessionReusedAfterClarify: provider.sessions[0] === visibleSession,
    };
    const receiptPath = process.env.THOTH_CLARIFY_BEHAVIOR_RECEIPT_PATH;
    if (receiptPath) {
      mkdirSync(dirname(receiptPath), { recursive: true });
      writeFileSync(receiptPath, `${JSON.stringify(behaviorReceipt, null, 2)}\n`, "utf8");
    }
  }, 45_000);

  it("Clarify public authority proves propagation, delegation scope, and Intent Contract confirmation", async () => {
    const propagationScript = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.clarifyPropagation;
    const propagationProvider = new ScriptedThothClient(propagationScript);
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: propagationProvider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();
    const propagationCwd = mkdtempSync(join(tmpdir(), "thoth-clarify-propagation-"));
    workspaces.push(propagationCwd);
    const propagationAgent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd: propagationCwd,
      initialPrompt: "CLARIFY_PROPAGATION",
      thoth: { enabled: true, executionMode: "quick", clarifyStrength: "balanced" },
    });

    const parentCard = (await waitForPendingCard(
      client,
      propagationAgent.id,
      "clarify_card",
    )) as ThothClarifyCardModel;
    expect(parentCard.card.allowSingleNodeRecommendation).toBe(true);
    const initialTree = await client.getAgentDecisionSession({ agentId: propagationAgent.id });
    const initialSession = initialTree.snapshot?.session;
    const initialRoot = initialTree.snapshot?.nodes.find(
      (node) => node.id === initialSession?.rootNodeId,
    );
    expect(initialSession).toMatchObject({ lifecycle: "awaiting_human" });
    expect(initialRoot).toMatchObject({
      parentId: null,
      owner: "human",
      materiality: "structural",
      status: "resolved",
    });
    expect(initialTree.snapshot?.nodes.filter((node) => node.parentId === null)).toEqual([
      expect.objectContaining({ id: initialSession?.rootNodeId }),
    ]);
    const singleNodeRecommendation = await answerPendingCard({
      client,
      agentId: propagationAgent.id,
      cardId: parentCard.id,
      answer: {
        intent: "recommend",
        questionCardId: parentCard.id,
        answers: [{ nodeId: "UT07-strategy", choiceIds: [], choiceNotes: {} }],
        delegatedNodeIds: ["UT07-strategy"],
        rawAnswer: "Use the Provider recommendation for this one decision.",
      },
    });
    expect(singleNodeRecommendation.decisionTreeDelta?.nodeUpserts).toEqual([
      expect.objectContaining({ id: "UT07-strategy", status: "delegated" }),
    ]);
    const repeatedCardState = await client.getAgentThothState(propagationAgent.id);
    const repeatedCardAnswer = await client.answerAgentThothCard({
      agentId: propagationAgent.id,
      cardId: parentCard.id,
      answer: {
        intent: "recommend",
        questionCardId: parentCard.id,
        answers: [{ nodeId: "UT07-strategy", choiceIds: [], choiceNotes: {} }],
        delegatedNodeIds: ["UT07-strategy"],
        rawAnswer: "This stale Card must not reopen a resolved decision.",
      },
      expectedRevision: repeatedCardState.state.revision,
      commandId: "e2e-stale-clarify-card-rejection",
    });
    expect(repeatedCardAnswer).toMatchObject({
      accepted: false,
      conflict: false,
      error: "This authority card is no longer pending for the Agent.",
    });

    const childCard = (await waitForPendingCard(
      client,
      propagationAgent.id,
      "clarify_card",
    )) as ThothClarifyCardModel;
    expect(childCard.card.questions.map((question) => question.nodeId)).toEqual([
      "UT07-renderer-mode",
    ]);
    const propagatedTree = await client.getAgentDecisionSession({ agentId: propagationAgent.id });
    const propagatedNodes = new Map(
      propagatedTree.snapshot?.nodes.map((node) => [node.id, node]) ?? [],
    );
    expect(propagatedTree.snapshot?.session.id).toBe(initialSession?.id);
    expect(propagatedTree.snapshot?.session.rootNodeId).toBe(initialSession?.rootNodeId);
    expect(propagatedNodes.get("UT07-strategy")).toMatchObject({ status: "delegated" });
    expect(propagatedNodes.get("UT07-renderer-mode")).toMatchObject({
      parentId: "UT07-strategy",
      owner: "human",
      status: "awaiting_human",
    });
    expect(propagatedNodes.get("UT07-live-preview")).toMatchObject({ status: "pruned" });

    await answerPendingCard({
      client,
      agentId: propagationAgent.id,
      cardId: childCard.id,
      answer: {
        intent: "submit_choices",
        questionCardId: childCard.id,
        answers: [
          {
            nodeId: "UT07-renderer-mode",
            choiceIds: ["UT07-renderer-mode-reference"],
            choiceNotes: {},
          },
        ],
        delegatedNodeIds: [],
        rawAnswer: "Use the reference renderer mode.",
      },
    });
    const contractCard = (await waitForPendingCard(
      client,
      propagationAgent.id,
      "intent_contract_card",
    )) as ThothIntentContractCardModel;
    const confirmationBefore = await client.getAgentDecisionSession({
      agentId: propagationAgent.id,
    });
    expect(confirmationBefore.snapshot?.session).toMatchObject({
      lifecycle: "ready_to_confirm",
      activity: { state: "ready_to_confirm" },
      intentContract: {
        status: "proposed",
        confirmedAt: null,
        escalationPolicy: { finalConfirmation: "automatic" },
      },
    });
    expect(confirmationBefore.snapshot?.cardReceipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cardId: contractCard.id,
          kind: "intent_contract_card",
          status: "pending",
        }),
      ]),
    );
    const confirmation = await answerPendingCard({
      client,
      agentId: propagationAgent.id,
      cardId: contractCard.id,
      answer: {
        intent: "accept_quick",
        cardId: contractCard.id,
        rawAnswer: "Confirm the Intent Contract and run the foreground task.",
      },
    });
    expect(confirmation.card).toMatchObject({
      card: { id: contractCard.id, submitted: true },
      status: "answered",
    });
    const confirmationAfter = await waitFor(async () => {
      const result = await client.getAgentDecisionSession({ agentId: propagationAgent.id });
      return result.snapshot?.session.lifecycle === "frozen" ? result : null;
    });
    expect(confirmationAfter.snapshot?.session).toMatchObject({
      lifecycle: "frozen",
      activity: { state: "frozen" },
      intentContract: {
        status: "confirmed",
        taskId: expect.any(String),
        confirmedAt: expect.any(String),
      },
    });
    const frozenSessionId = confirmationAfter.snapshot!.session.id;
    const frozenNodeDigest = JSON.stringify(
      confirmationAfter.snapshot!.nodes.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        status: node.status,
        resolutionRef: node.resolutionRef,
        revision: node.revision,
      })),
    );
    const frozenPriority = await client.prioritizeAgentDecisionNode({
      agentId: propagationAgent.id,
      sessionId: frozenSessionId,
      nodeId: "UT07-strategy",
      expectedRevision: confirmationAfter.snapshot!.revision,
      commandId: "e2e-frozen-tree-priority-rejection",
    });
    expect(frozenPriority).toMatchObject({
      delta: null,
      conflict: false,
      error: "Decision node UT07-strategy is not an open frontier",
    });
    const frozenAfterRejectedMutation = await client.getAgentDecisionSession({
      agentId: propagationAgent.id,
      sessionId: frozenSessionId,
    });
    expect(frozenAfterRejectedMutation.snapshot?.session.lifecycle).toBe("frozen");
    expect(
      JSON.stringify(
        frozenAfterRejectedMutation.snapshot?.nodes.map((node) => ({
          id: node.id,
          parentId: node.parentId,
          status: node.status,
          resolutionRef: node.resolutionRef,
          revision: node.revision,
        })),
      ),
    ).toBe(frozenNodeDigest);
    const persistedTree = inspectPersistedDecisionTree({
      thothHome: daemon.thothHome,
      workspaceId: propagationAgent.workspaceId!,
      sessionId: frozenSessionId,
    });
    expect(persistedTree.rootNodeCount).toBe(1);
    expect(persistedTree.persistedNodeCount).toBe(4);
    expect(persistedTree.forbiddenNodeFieldNames).toEqual([]);

    await waitForThothLifecycle(client, propagationAgent.id, "done");
    await waitForAgentIdle(client, propagationAgent.id);
    await client.sendAgentMessage(propagationAgent.id, "CLARIFY_PROPAGATION_SECOND_OBJECTIVE", {
      thoth: { enabled: true, executionMode: "quick", clarifyStrength: "balanced" },
    });
    await waitForPendingCard(client, propagationAgent.id, "clarify_card");
    const nextTree = await client.getAgentDecisionSession({ agentId: propagationAgent.id });
    expect(nextTree.snapshot?.session).toMatchObject({ lifecycle: "awaiting_human" });
    expect(nextTree.snapshot?.session.id).not.toBe(frozenSessionId);
    const sessions = await client.listAgentDecisionSessions(propagationAgent.id);
    expect(sessions.error).toBeNull();
    expect(sessions.activeSessionId).toBe(nextTree.snapshot?.session.id);
    expect(sessions.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: frozenSessionId, lifecycle: "frozen" }),
        expect.objectContaining({ id: nextTree.snapshot?.session.id, lifecycle: "awaiting_human" }),
      ]),
    );
    const frozenAfterNewObjective = await client.getAgentDecisionSession({
      agentId: propagationAgent.id,
      sessionId: frozenSessionId,
    });
    expect(frozenAfterNewObjective.snapshot?.session.lifecycle).toBe("frozen");
    expect(
      JSON.stringify(
        frozenAfterNewObjective.snapshot?.nodes.map((node) => ({
          id: node.id,
          parentId: node.parentId,
          status: node.status,
          resolutionRef: node.resolutionRef,
          revision: node.revision,
        })),
      ),
    ).toBe(frozenNodeDigest);

    await client.close();
    await daemon.close();
    client = null;
    daemon = null;

    const subtreeScript = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.clarifySubtreeDelegation;
    const subtreeProvider = new ScriptedThothClient(subtreeScript);
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: subtreeProvider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();
    const subtreeCwd = mkdtempSync(join(tmpdir(), "thoth-clarify-subtree-"));
    workspaces.push(subtreeCwd);
    const subtreeAgent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd: subtreeCwd,
      initialPrompt: "CLARIFY_SUBTREE_DELEGATION",
      thoth: { enabled: true, executionMode: "quick", clarifyStrength: "balanced" },
    });
    const subtreeCard = (await waitForPendingCard(
      client,
      subtreeAgent.id,
      "clarify_card",
    )) as ThothClarifyCardModel;
    const subtreeDelegation = await answerPendingCard({
      client,
      agentId: subtreeAgent.id,
      cardId: subtreeCard.id,
      answer: {
        intent: "delegate_subtree",
        questionCardId: subtreeCard.id,
        answers: [{ nodeId: "UT08-portability", choiceIds: [], choiceNotes: {} }],
        delegatedNodeIds: ["UT08-portability"],
        rawAnswer: "Delegate this complete decision subtree to the Provider.",
      },
    });
    expect(subtreeDelegation.decisionTreeDelta?.nodeUpserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "UT08-portability", status: "delegated" }),
        expect.objectContaining({ id: "UT08-adapter-layout", status: "delegated" }),
      ]),
    );
    const subtreeTree = await client.getAgentDecisionSession({ agentId: subtreeAgent.id });
    const subtreeNodes = new Map(subtreeTree.snapshot?.nodes.map((node) => [node.id, node]) ?? []);
    expect(subtreeNodes.get("UT08-portability")).toMatchObject({ status: "delegated" });
    expect(subtreeNodes.get("UT08-adapter-layout")).toMatchObject({ status: "delegated" });

    const receiptPath = process.env.THOTH_CLARIFY_BEHAVIOR_RECEIPT_PATH;
    if (receiptPath) {
      mkdirSync(dirname(receiptPath), { recursive: true });
      writeFileSync(
        receiptPath,
        `${JSON.stringify(
          {
            schemaVersion: 3,
            journey: "public-api-decision-tree-propagation-delegation-and-confirmation",
            decisionSessionContinuity: {
              initialSessionId: initialSession?.id,
              initialRootNodeId: initialSession?.rootNodeId,
              initialRootIsOnlyRoot:
                initialTree.snapshot?.nodes.filter((node) => node.parentId === null).length === 1,
              propagatedSessionId: propagatedTree.snapshot?.session.id,
              propagatedRootNodeId: propagatedTree.snapshot?.session.rootNodeId,
              frozenSessionId,
              rejectedFrozenMutation: frozenPriority.error,
              nextObjectiveSessionId: nextTree.snapshot?.session.id,
              nextObjectiveCreatedNewSession: nextTree.snapshot?.session.id !== frozenSessionId,
              frozenSessionRemainedImmutable:
                frozenAfterNewObjective.snapshot?.session.lifecycle === "frozen" &&
                JSON.stringify(
                  frozenAfterNewObjective.snapshot?.nodes.map((node) => ({
                    id: node.id,
                    parentId: node.parentId,
                    status: node.status,
                    resolutionRef: node.resolutionRef,
                    revision: node.revision,
                  })),
                ) === frozenNodeDigest,
            },
            persistedDecisionTree: persistedTree,
            frontierProtection: {
              staleCardRejected:
                repeatedCardAnswer.accepted === false &&
                repeatedCardAnswer.error ===
                  "This authority card is no longer pending for the Agent.",
              prunedSiblingCannotBecomeCurrent:
                propagatedNodes.get("UT07-live-preview")?.status === "pruned",
            },
            contractConfirmation: {
              intentCardPending: true,
              treeLifecycleBefore: confirmationBefore.snapshot?.session.lifecycle,
              activityBefore: confirmationBefore.snapshot?.session.activity.state,
              contractStatusBefore: confirmationBefore.snapshot?.session.intentContract?.status,
              confirmedAtBefore: confirmationBefore.snapshot?.session.intentContract?.confirmedAt,
              finalConfirmationPolicy:
                confirmationBefore.snapshot?.session.intentContract?.escalationPolicy
                  .finalConfirmation,
              automaticPolicyStillRequiredIntentCard: Boolean(
                confirmationBefore.snapshot?.session.intentContract?.escalationPolicy
                  .finalConfirmation === "automatic" &&
                confirmationBefore.snapshot?.cardReceipts.some(
                  (receipt) =>
                    receipt.cardId === contractCard.id &&
                    receipt.kind === "intent_contract_card" &&
                    receipt.status === "pending",
                ),
              ),
              humanAcceptanceAccepted: confirmation.accepted,
              submittedCard: confirmation.card?.card.submitted,
              treeLifecycleAfter: confirmationAfter.snapshot?.session.lifecycle,
              activityAfter: confirmationAfter.snapshot?.session.activity.state,
              contractStatusAfter: confirmationAfter.snapshot?.session.intentContract?.status,
              confirmedAtRecorded:
                confirmationAfter.snapshot?.session.intentContract?.confirmedAt !== null,
              taskRegistered: confirmationAfter.snapshot?.session.intentContract?.taskId !== null,
            },
            singleNodeRecommendation: {
              intent: "recommend",
              targetNodeId: "UT07-strategy",
              deltaNodeIds: singleNodeRecommendation.decisionTreeDelta?.nodeUpserts.map(
                (node) => node.id,
              ),
              targetStatus: propagatedNodes.get("UT07-strategy")?.status,
              newlyMaterialChildId: "UT07-renderer-mode",
              newlyMaterialChildParentId: propagatedNodes.get("UT07-renderer-mode")?.parentId,
              newlyMaterialChildStatus: propagatedNodes.get("UT07-renderer-mode")?.status,
              prunedSiblingId: "UT07-live-preview",
              prunedSiblingStatus: propagatedNodes.get("UT07-live-preview")?.status,
            },
            subtreeDelegation: {
              intent: "delegate_subtree",
              targetNodeId: "UT08-portability",
              descendantNodeId: "UT08-adapter-layout",
              deltaNodeIds: subtreeDelegation.decisionTreeDelta?.nodeUpserts.map((node) => node.id),
              targetStatus: subtreeNodes.get("UT08-portability")?.status,
              descendantStatus: subtreeNodes.get("UT08-adapter-layout")?.status,
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
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

  it("UT-02d keeps one thread across Thoth history, native question, completed Plan and Implement", async () => {
    const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyRecovery;
    const provider = new ScriptedThothClient(script);
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-plan-question-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "RAW_BEFORE_THOTH",
      thoth: { enabled: false },
      providerRunMode: "default",
    });
    await waitForAgentIdle(client, agent.id);
    const visibleSession = provider.sessions[0]!;
    const nativeThreadId = visibleSession.id;

    await client.sendAgentMessage(agent.id, "THOTH_BEFORE_PLAN", {
      thoth: {
        enabled: true,
        executionMode: "quick",
        clarifyStrength: "light",
      },
      providerRunMode: "default",
    });
    await waitForPendingCard(client, agent.id, "clarify_card");
    await client.cancelAgent(agent.id);

    await client.sendAgentMessage(agent.id, "PLAN_WITH_QUESTION", {
      thoth: { enabled: false },
      providerRunMode: "plan",
    });
    const question = await waitFor(async () => {
      const snapshot = await client!.fetchAgent({ agentId: agent.id });
      return snapshot?.agent.pendingProviderQuestions?.[0] ?? null;
    });
    expect(question).toMatchObject({
      agentId: agent.id,
      providerThreadId: nativeThreadId,
      questions: [{ id: "target", selectionMode: "single" }],
    });
    const whilePending = await client.fetchAgent({ agentId: agent.id });
    expect(whilePending?.agent.pendingPermissions.some((item) => item.kind === "plan")).toBe(false);

    const wrongAgent = await client.respondProviderQuestionAndWait({
      agentId: "wrong-agent",
      interactionId: question.interactionId,
      expectedRevision: question.revision,
      commandId: "ut02d-question-wrong-agent",
      resolution: {
        type: "answer",
        answers: [{ questionId: "target", values: ["local"] }],
      },
    });
    expect(wrongAgent).toMatchObject({
      accepted: false,
      errorCode: "PROVIDER_QUESTION_NOT_FOUND",
    });
    const staleRevision = await client.respondProviderQuestionAndWait({
      agentId: agent.id,
      interactionId: question.interactionId,
      expectedRevision: question.revision + 1,
      commandId: "ut02d-question-stale-revision",
      resolution: {
        type: "answer",
        answers: [{ questionId: "target", values: ["local"] }],
      },
    });
    expect(staleRevision).toMatchObject({
      accepted: false,
      conflict: true,
      errorCode: "PROVIDER_QUESTION_STALE",
    });
    const invalidAnswer = await client.respondProviderQuestionAndWait({
      agentId: agent.id,
      interactionId: question.interactionId,
      expectedRevision: question.revision,
      commandId: "ut02d-question-invalid-answer",
      resolution: { type: "answer", answers: [] },
    });
    expect(invalidAnswer).toMatchObject({
      accepted: false,
      conflict: false,
      errorCode: "PROVIDER_QUESTION_INVALID_RESPONSE",
    });
    expect(
      (await client.fetchAgent({ agentId: agent.id }))?.agent.pendingProviderQuestions,
    ).toHaveLength(1);

    const questionResult = await client.respondProviderQuestionAndWait({
      agentId: agent.id,
      interactionId: question.interactionId,
      expectedRevision: question.revision,
      commandId: "ut02d-question-answer",
      resolution: {
        type: "answer",
        answers: [{ questionId: "target", values: ["local"] }],
      },
    });
    expect(questionResult).toMatchObject({ accepted: true, conflict: false, error: null });
    const duplicateQuestionResult = await client.respondProviderQuestionAndWait({
      agentId: agent.id,
      interactionId: question.interactionId,
      expectedRevision: question.revision,
      commandId: "ut02d-question-answer",
      resolution: {
        type: "answer",
        answers: [{ questionId: "target", values: ["local"] }],
      },
    });
    expect(duplicateQuestionResult).toMatchObject({
      accepted: true,
      conflict: false,
      revision: question.revision + 1,
    });
    const reusedCommand = await client.respondProviderQuestionAndWait({
      agentId: agent.id,
      interactionId: "another-question",
      expectedRevision: 0,
      commandId: "ut02d-question-answer",
      resolution: { type: "dismiss" },
    });
    expect(reusedCommand).toMatchObject({
      accepted: false,
      conflict: true,
      errorCode: "PROVIDER_QUESTION_STALE",
    });

    const awaitingImplementation = await waitForThothLifecycle(
      client,
      agent.id,
      "awaiting_implementation",
    );
    expect(awaitingImplementation.turn).toMatchObject({
      kind: "raw",
      providerRunMode: "plan",
    });
    const planPermission = await waitFor(async () => {
      const snapshot = await client!.fetchAgent({ agentId: agent.id });
      return snapshot?.agent.pendingPermissions.find((item) => item.kind === "plan") ?? null;
    });
    expect(planPermission.metadata).toMatchObject({
      owner: "thoth-daemon",
      authority: "provider-plan",
    });
    await client.respondToPermissionAndWait(
      agent.id,
      planPermission.id,
      { behavior: "allow", selectedActionId: "implement" },
      15_000,
    );
    await waitForThothLifecycle(client, agent.id, "done");
    await waitForAgentIdle(client, agent.id);

    await client.sendAgentMessage(agent.id, "RAW_AFTER_PLAN", {
      thoth: { enabled: false },
      providerRunMode: "default",
    });
    await waitForThothLifecycle(client, agent.id, "done");
    await waitForAgentIdle(client, agent.id);
    expect(provider.sessions).toHaveLength(1);
    expect(provider.sessions[0]).toBe(visibleSession);
    expect(visibleSession.id).toBe(nativeThreadId);
    expect(visibleSession.providerQuestionResponses).toEqual([
      {
        type: "answer",
        answers: [{ questionId: "target", values: ["local"] }],
      },
    ]);
  }, 30_000);

  it("UT-02e expires a native question whose live handler is lost across daemon restart", async () => {
    const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyRecovery;
    const provider = new ScriptedThothClient(script, {
      simulateQuestionHandlerLossOnClose: true,
    });
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

    const cwd = mkdtempSync(join(tmpdir(), "thoth-provider-question-restart-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "RAW_BEFORE_QUESTION_RESTART",
      thoth: { enabled: false },
      providerRunMode: "default",
    });
    await waitForAgentIdle(client, agent.id);
    await client.sendAgentMessage(agent.id, "PLAN_WITH_QUESTION", {
      thoth: { enabled: false },
      providerRunMode: "plan",
    });
    const question = await waitFor(async () => {
      const snapshot = await client!.fetchAgent({ agentId: agent.id });
      return snapshot?.agent.pendingProviderQuestions?.[0] ?? null;
    });
    expect(question.providerThreadId).toBe(provider.sessions[0]?.id);
    const beforeRestart = await client.getAgentThothState(agent.id);
    expect(beforeRestart.state.turn?.id).toBeTruthy();
    expect(agent.workspaceId).toBeTruthy();

    await client.close();
    await daemon.close();
    // The fixture daemon shuts down gracefully, while the recovery branch being
    // exercised represents an abrupt process loss. Restore only the two lifecycle
    // columns that graceful close advances; keep the durable question interaction
    // exactly as written by the production authority path.
    const authorityDb = new DatabaseSync(
      join(daemon.thothHome, "workspaces", agent.workspaceId!, "authority.sqlite"),
    );
    authorityDb
      .prepare("UPDATE turns SET status = 'running', error = NULL WHERE turn_id = ?")
      .run(beforeRestart.state.turn!.id);
    authorityDb
      .prepare("UPDATE agents SET thoth_lifecycle = 'running', error = NULL WHERE agent_id = ?")
      .run(agent.id);
    authorityDb.close();
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

    const interrupted = await waitForThothLifecycle(client, agent.id, "interrupted");
    expect(interrupted.turn?.error).toContain("live Provider question handler was lost");
    expect(
      (await client.fetchAgent({ agentId: agent.id }))?.agent.pendingProviderQuestions,
    ).toEqual([]);

    await client.sendAgentMessage(agent.id, "PLAN_WITH_QUESTION", {
      thoth: { enabled: false },
      providerRunMode: "plan",
    });
    const retriedQuestion = await waitFor(async () => {
      const snapshot = await client!.fetchAgent({ agentId: agent.id });
      return snapshot?.agent.pendingProviderQuestions?.[0] ?? null;
    });
    expect(retriedQuestion.interactionId).not.toBe(question.interactionId);
    const dismissed = await client.respondProviderQuestionAndWait({
      agentId: agent.id,
      interactionId: retriedQuestion.interactionId,
      expectedRevision: retriedQuestion.revision,
      commandId: "ut02e-dismiss-retried-question",
      resolution: { type: "dismiss" },
    });
    expect(dismissed).toMatchObject({ accepted: true, conflict: false });
    await waitForThothLifecycle(client, agent.id, "awaiting_implementation");
    const planPermission = await waitFor(async () => {
      const snapshot = await client!.fetchAgent({ agentId: agent.id });
      return snapshot?.agent.pendingPermissions.find((item) => item.kind === "plan") ?? null;
    });
    await client.respondToPermissionAndWait(agent.id, planPermission.id, { behavior: "deny" });
    await waitForThothLifecycle(client, agent.id, "done");
  }, 60_000);

  it.each([
    {
      prompt: "PLAN_BYTE_MISMATCH",
      error: "Completed native Plan byte receipt does not match its retained text.",
    },
    {
      prompt: "PLAN_DUPLICATE",
      error: "PROVIDER_PLAN_DUPLICATE",
    },
  ])("rejects invalid completed Plan authority for $prompt", async ({ prompt, error }) => {
    const provider = new ScriptedThothClient(THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickDirect);
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-invalid-plan-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "RAW_BEFORE_INVALID_PLAN",
      thoth: { enabled: false },
      providerRunMode: "default",
    });
    await waitForAgentIdle(client, agent.id);
    await client.sendAgentMessage(agent.id, prompt, {
      thoth: { enabled: false },
      providerRunMode: "plan",
    });
    const interrupted = await waitForThothLifecycle(client, agent.id, "interrupted");
    expect(interrupted.turn?.error).toContain(error);
    const snapshot = await client.fetchAgent({ agentId: agent.id });
    expect(
      snapshot?.agent.pendingPermissions.some((permission) => permission.kind === "plan"),
    ).toBe(false);
  });

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
    await answerClarifyWithFirstChoices(client, agent.id);
    await approveIntentContract({ client, agentId: agent.id, mode: "quick" });
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
    await approveIntentContract({ client, agentId: agent.id, mode: "quick" });
    await waitForThothLifecycle(client, agent.id, "done");
    await waitForAgentIdle(client, agent.id);
    expect(await timelineContains(client, agent.id, script.finalMarker)).toBe(true);
    expect(provider.sessions.length).toBeGreaterThan(1);
  }, 60_000);

  it("UT-04 completes one target-anchored Work Unit after fresh independent Review", async () => {
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
    await approveIntentContract({ client, agentId: agent.id, mode: "loop" });
    const handoff = await waitForThothLifecycle(client, agent.id, "background_handoff");
    expect(handoff.backgroundTaskId).toBeTruthy();

    expect(agent.workspaceId).toBeTruthy();
    const taskResult = await waitForCompletedTask(client, agent.workspaceId!);
    const detail = await client.getTask({
      taskId: taskResult.id,
      workspaceId: agent.workspaceId!,
    });
    expect(detail.error).toBeNull();
    expect(detail.task?.intentContract.objective).toBe(
      "Verify one target-anchored foreground or background authority flow.",
    );
    expect(detail.task?.workUnits).toHaveLength(1);
    expect(detail.task?.workUnits[0]).toMatchObject({ status: "completed" });
    expect(detail.task?.latestReview).toMatchObject({ decision: "complete" });
    expect(detail.task?.budget).toMatchObject({
      maxNonCompleteReviews: 1,
      usedNonCompleteReviews: 0,
    });
    expect(detail.executions.map((execution) => execution.phase)).toEqual(["execute", "review"]);
    expect(provider.checkpointCalls).toBe(1);
    expect(provider.reviewCalls).toBe(1);
    const executeTurn = provider.turnReceipts.find(
      (receipt) => receipt.runtimeScope === "loop_execute",
    )!;
    const reviewTurn = provider.turnReceipts.find(
      (receipt) => receipt.runtimeScope === "loop_review",
    )!;
    const executeSession = provider.sessions.find(
      (session) => session.id === executeTurn.sessionId,
    )!;
    const reviewSession = provider.sessions.find((session) => session.id === reviewTurn.sessionId)!;
    expect(executeTurn.providerRunMode).toBe("plan");
    expect(executeTurn.prompt).toContain("Task Anchor:");
    expect(executeTurn.prompt).toContain("Current Working Set:");
    for (const field of [
      "activeGap",
      "currentHypothesis",
      "latestReview",
      "evidenceIndex",
      "rejectedRoutes",
      "blockers",
    ]) {
      expect(executeTurn.prompt).toContain(`\"${field}\"`);
    }
    expect(executeTurn.prompt).not.toContain("fullTranscript");
    expect(executeTurn.prompt).not.toContain("Blackboard");
    expect(reviewTurn.prompt).toContain("Inspect Workspace reality yourself");
    expect(reviewTurn.prompt).toContain("Evidence Index");
    expect(reviewTurn.prompt).toContain("must not modify the Workspace");
    expect(reviewTurn.prompt).toContain("do not request its private transcript");
    expect(reviewSession.id).not.toBe(executeSession.id);
    expect(reviewSession.modelId).toBe(executeSession.modelId);
    loopBehaviorEvidence.nativePlan = {
      capability: "native",
      executeSessionId: executeSession.id,
      reviewSessionId: reviewSession.id,
      executeAndReviewUseSameModel: reviewSession.modelId === executeSession.modelId,
      freshReviewThread: reviewSession.id !== executeSession.id,
      executeRunMode: executeTurn.providerRunMode,
      reviewRunMode: reviewTurn.providerRunMode,
      executePrompt: executeTurn.prompt,
      reviewPrompt: reviewTurn.prompt,
      workUnitCount: detail.task?.workUnits.length,
      reviewDecision: detail.task?.latestReview?.decision,
    };
    const finalAgent = await client.fetchAgent({ agentId: agent.id });
    expect(finalAgent?.agent.status).toBe("idle");
  }, 45_000);

  it("UT-04b uses normal Agent deliberation when native Plan is unsupported", async () => {
    const provider = new ScriptedThothClient(THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopLinearPass, {
      nativePlan: false,
    });
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-loop-agent-deliberation-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "Run Loop without native Plan capability.",
      thoth: {
        enabled: true,
        executionMode: "loop",
        clarifyStrength: "light",
        loopStrength: "one_plan_one_do",
      },
    });
    await answerClarifyWithFirstChoices(client, agent.id);
    await approveIntentContract({ client, agentId: agent.id, mode: "loop" });
    await waitForThothLifecycle(client, agent.id, "background_handoff");
    const completed = await waitForCompletedTask(client, agent.workspaceId!);
    const detail = await client.getTask({ workspaceId: agent.workspaceId!, taskId: completed.id });
    const executeTurns = provider.turnReceipts.filter(
      (receipt) => receipt.runtimeScope === "loop_execute",
    );
    expect(executeTurns).toHaveLength(1);
    expect(executeTurns[0]?.providerRunMode).toBe("default");
    expect(executeTurns[0]?.prompt).toContain("The Provider has no native Plan capability");
    expect(detail.task?.latestReview?.decision).toBe("complete");
    loopBehaviorEvidence.agentManagedDeliberation = {
      capability: "unsupported",
      executeRunModes: executeTurns.map((receipt) => receipt.providerRunMode),
      executePrompt: executeTurns[0]?.prompt,
      completed: detail.task?.status === "completed",
      provider: provider.provider,
    };
  }, 45_000);

  it("UT-04c repairs one terminal without checkpoint on the same Executor lineage", async () => {
    const provider = new ScriptedThothClient(THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopLinearPass, {
      nativePlan: false,
      semanticOmissions: 1,
    });
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-loop-repair-success-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "Run Loop after one missing checkpoint terminal.",
      thoth: {
        enabled: true,
        executionMode: "loop",
        clarifyStrength: "light",
        loopStrength: "one_plan_one_do",
      },
    });
    await answerClarifyWithFirstChoices(client, agent.id);
    await approveIntentContract({ client, agentId: agent.id, mode: "loop" });
    await waitForThothLifecycle(client, agent.id, "background_handoff");
    const completed = await waitForCompletedTask(client, agent.workspaceId!);
    const detail = await client.getTask({ workspaceId: agent.workspaceId!, taskId: completed.id });
    const executeTurns = provider.turnReceipts.filter(
      (receipt) => receipt.runtimeScope === "loop_execute",
    );
    const executeSessionIds = new Set(executeTurns.map((receipt) => receipt.sessionId));
    const repairTurns = executeTurns.filter((receipt) =>
      receipt.prompt.includes("ended without the required semantic checkpoint"),
    );
    expect(executeTurns).toHaveLength(2);
    expect(executeSessionIds.size).toBe(1);
    expect(repairTurns).toHaveLength(1);
    expect(detail.task?.status).toBe("completed");
    loopBehaviorEvidence.singleRepairSuccess = {
      executorTurnCount: executeTurns.length,
      executorSessionIds: [...executeSessionIds],
      repairTurnCount: repairTurns.length,
      repairPrompt: repairTurns[0]?.prompt,
      completed: detail.task?.status === "completed",
    };
  }, 45_000);

  it("UT-04d interrupts after a second terminal without checkpoint instead of repairing again", async () => {
    const provider = new ScriptedThothClient(THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopLinearPass, {
      nativePlan: false,
      semanticOmissions: 2,
    });
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-loop-repair-limit-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "Run Loop after two missing checkpoint terminals.",
      thoth: {
        enabled: true,
        executionMode: "loop",
        clarifyStrength: "light",
        loopStrength: "light",
      },
    });
    await answerClarifyWithFirstChoices(client, agent.id);
    await approveIntentContract({ client, agentId: agent.id, mode: "loop" });
    await waitForThothLifecycle(client, agent.id, "background_handoff");
    const completed = await waitForCompletedTask(client, agent.workspaceId!);
    const detail = await client.getTask({ workspaceId: agent.workspaceId!, taskId: completed.id });
    const failedExecute = detail.executions.find(
      (execution) =>
        execution.phase === "execute" &&
        execution.summary?.includes("completed twice without the required semantic Loop tool call"),
    );
    expect(failedExecute).toBeTruthy();
    const executeTurnsBySession = new Map<string, ScriptedTurnReceipt[]>();
    for (const receipt of provider.turnReceipts.filter(
      (candidate) => candidate.runtimeScope === "loop_execute",
    )) {
      const turns = executeTurnsBySession.get(receipt.sessionId) ?? [];
      turns.push(receipt);
      executeTurnsBySession.set(receipt.sessionId, turns);
    }
    const firstExecutorTurns =
      [...executeTurnsBySession.values()].find((turns) =>
        turns.some((receipt) =>
          receipt.prompt.includes("ended without the required semantic checkpoint"),
        ),
      ) ?? [];
    const firstExecutorRepairTurns = firstExecutorTurns.filter((receipt) =>
      receipt.prompt.includes("ended without the required semantic checkpoint"),
    );
    expect(firstExecutorTurns).toHaveLength(2);
    expect(firstExecutorRepairTurns).toHaveLength(1);
    expect(detail.task?.status).toBe("completed");
    loopBehaviorEvidence.repairLimit = {
      failedExecutionId: failedExecute?.id,
      failedExecutionSummary: failedExecute?.summary,
      firstExecutorTurnCount: firstExecutorTurns.length,
      firstExecutorRepairTurnCount: firstExecutorRepairTurns.length,
      freshlyReorientedAfterFailure:
        detail.executions.filter((execution) => execution.phase === "execute").length > 1,
      eventuallyCompleted: detail.task?.status === "completed",
    };
  }, 45_000);

  it("UT-04e stops automatic reorientation after two failed Executor attempts and resumes explicitly", async () => {
    const provider = new ScriptedThothClient(THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopLinearPass, {
      nativePlan: false,
      semanticOmissions: 4,
    });
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-loop-no-progress-fence-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "Fence repeated Executor attempts that make no semantic progress.",
      thoth: {
        enabled: true,
        executionMode: "loop",
        clarifyStrength: "light",
        loopStrength: "light",
      },
    });
    await answerClarifyWithFirstChoices(client, agent.id);
    await approveIntentContract({ client, agentId: agent.id, mode: "loop" });
    await waitForThothLifecycle(client, agent.id, "background_handoff");

    const interrupted = await waitFor(async () => {
      const listed = await client!.listTasks(agent.workspaceId!);
      const task = listed.tasks[0];
      if (!task) return null;
      const detail = await client!.getTask({ workspaceId: agent.workspaceId!, taskId: task.id });
      return detail.task?.status === "interrupted" ? detail : null;
    }, 30_000);
    const failedExecutors = interrupted.executions.filter(
      (execution) => execution.phase === "execute",
    );
    expect(failedExecutors).toHaveLength(2);
    expect(failedExecutors.every((execution) => execution.status === "failed")).toBe(true);
    expect(interrupted.task?.workingSet.noProgressCount).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 100));
    const stable = await client.getTask({
      workspaceId: agent.workspaceId!,
      taskId: interrupted.task!.id,
    });
    expect(stable.executions.filter((execution) => execution.phase === "execute")).toHaveLength(2);

    const resumed = await client.commandTask({
      workspaceId: agent.workspaceId!,
      taskId: interrupted.task!.id,
      command: "resume",
      expectedRevision: interrupted.task!.revision,
      commandId: "resume-after-no-progress-fence",
    });
    expect(resumed).toMatchObject({ conflict: false, error: null });
    const completed = await waitForCompletedTask(client, agent.workspaceId!, 30_000, 6);
    const completedDetail = await client.getTask({
      workspaceId: agent.workspaceId!,
      taskId: completed.id,
    });
    expect(completedDetail.task).toMatchObject({
      status: "completed",
      workingSet: { noProgressCount: 0 },
    });
    loopBehaviorEvidence.repeatedNoProgressFence = {
      failedExecutorCount: failedExecutors.length,
      noProgressCount: interrupted.task?.workingSet.noProgressCount,
      stableUntilResume: stable.executions.length === interrupted.executions.length,
      completedAfterResume: completedDetail.task?.status === "completed",
    };
  }, 45_000);

  it("UT-05 reorients the Working Set and completes before the Light budget", async () => {
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
    await approveIntentContract({ client, agentId: agent.id, mode: "loop" });
    await waitForThothLifecycle(client, agent.id, "background_handoff");

    expect(agent.workspaceId).toBeTruthy();
    const taskResult = await waitForCompletedTask(client, agent.workspaceId!);
    const detail = await client.getTask({
      taskId: taskResult.id,
      workspaceId: agent.workspaceId!,
    });
    expect(detail.error).toBeNull();
    expect(detail.task?.budget).toMatchObject({
      maxNonCompleteReviews: 5,
      usedNonCompleteReviews: 1,
    });
    expect(detail.task?.workUnits).toHaveLength(2);
    expect(detail.task?.workUnits.map((workUnit) => workUnit.status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(detail.task?.latestReview).toMatchObject({ decision: "complete" });
    expect(detail.executions.map((execution) => execution.phase)).toEqual([
      "execute",
      "review",
      "execute",
      "review",
    ]);
    expect(provider.checkpointCalls).toBe(2);
    expect(provider.reviewCalls).toBe(2);
    loopBehaviorEvidence.lightBudget = {
      maxNonCompleteReviews: detail.task?.budget.maxNonCompleteReviews,
      usedNonCompleteReviews: detail.task?.budget.usedNonCompleteReviews,
      nonCompleteReviewDecisions: detail.task?.latestReview?.decision === "complete" ? 1 : null,
      completedOnlyAfterCompleteReview: detail.task?.status === "completed",
    };
    const finalAgent = await client.fetchAgent({ agentId: agent.id });
    expect(finalAgent?.agent.status).toBe("idle");
  }, 45_000);

  it("UT-06 returns a Human-owned Loop decision to Clarify and revises the same Task", async () => {
    const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopHumanDecisionHandoff;
    const provider = new ScriptedThothClient(script);
    daemon = await createTestThothDaemon({ harnessAdapters: { codex: provider } });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      reconnect: { enabled: false },
    });
    await client.connect();

    const cwd = mkdtempSync(join(tmpdir(), "thoth-public-loop-human-handoff-"));
    workspaces.push(cwd);
    const agent = await client.createAgent({
      provider: "codex",
      model: "scripted-codex",
      modeId: "auto",
      cwd,
      initialPrompt: "Run the deterministic Human-owned Loop handoff.",
      thoth: {
        enabled: true,
        executionMode: "loop",
        clarifyStrength: "light",
        loopStrength: "light",
      },
    });
    await answerClarifyWithFirstChoices(client, agent.id);
    await approveIntentContract({ client, agentId: agent.id, mode: "loop" });
    const initialHandoff = await waitForThothLifecycle(client, agent.id, "background_handoff");
    const taskId = initialHandoff.backgroundTaskId!;
    expect(taskId).toBeTruthy();
    expect(agent.workspaceId).toBeTruthy();

    const awaitingHuman = await waitForTaskAwaitingUser(client, agent.workspaceId!);
    expect(awaitingHuman.task).toMatchObject({
      id: taskId,
      status: "awaiting_user",
      currentExecutionId: null,
      pendingDecision: { kind: "contract_change" },
    });
    expect(awaitingHuman.executions).toHaveLength(1);
    expect(awaitingHuman.executions[0]).toMatchObject({
      phase: "execute",
      status: "succeeded",
      pendingApproval: null,
    });
    expect((await client.listTasks(agent.workspaceId!)).tasks).toHaveLength(1);

    await answerClarifyWithFirstChoices(client, agent.id);
    await approveIntentContract({ client, agentId: agent.id, mode: "loop" });
    const revisedHandoff = await waitForThothLifecycle(client, agent.id, "background_handoff");
    expect(revisedHandoff.backgroundTaskId).toBe(taskId);

    const completed = await waitForCompletedTask(client, agent.workspaceId!, 30_000, 4);
    expect(completed.id).toBe(taskId);
    const detail = await client.getTask({ workspaceId: agent.workspaceId!, taskId });
    expect(detail.task).toMatchObject({
      id: taskId,
      status: "completed",
      intentContract: { title: "Fixed target UT06_REVISED", status: "confirmed" },
      latestReview: { decision: "complete" },
    });
    expect((await client.listTasks(agent.workspaceId!)).tasks.map((task) => task.id)).toEqual([
      taskId,
    ]);
    expect(detail.executions.map((execution) => execution.phase)).toEqual([
      "execute",
      "execute",
      "review",
    ]);
    expect(
      detail.decisions.filter((decision) => decision.taskId === taskId).length,
    ).toBeGreaterThan(0);
    expect(provider.checkpointCalls).toBe(1);
    expect(provider.reviewCalls).toBe(1);
  }, 60_000);

  it.each([
    { providerId: "codex", transport: "native" as const, nativePlan: true },
    { providerId: "claude", transport: "mcp" as const, nativePlan: true },
    { providerId: "opencode", transport: "mcp" as const, nativePlan: true },
    { providerId: "pi", transport: "mcp" as const, nativePlan: false },
    { providerId: "acp-fixture", transport: "mcp" as const, nativePlan: true },
  ])(
    "Harness lifecycle conformance: $providerId over $transport",
    async ({ providerId, transport, nativePlan }) => {
      const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopRetryAndBudget;
      const provider = new ScriptedThothClient(script, {
        provider: providerId,
        transport,
        nativePlan,
      });
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
      await approveIntentContract({ client, agentId: agent.id, mode: "loop" });
      await waitForThothLifecycle(client, agent.id, "background_handoff");

      const task = await waitForCompletedTask(client, agent.workspaceId!, 45_000);
      const detail = await client.getTask({
        taskId: task.id,
        workspaceId: agent.workspaceId!,
      });
      expect(detail.error).toBeNull();
      expect(detail.task?.budget).toMatchObject({
        usedNonCompleteReviews: 1,
        maxNonCompleteReviews: 5,
      });
      expect(detail.task?.workUnits).toHaveLength(2);
      expect(detail.task?.latestReview).toMatchObject({ decision: "complete" });
      expect(detail.executions).toHaveLength(4);
      expect(
        detail.executions.every((execution) => execution.attachment?.status === "attached"),
      ).toBe(true);
      expect(provider.checkpointCalls).toBe(2);
      expect(provider.reviewCalls).toBe(2);
      expect(
        detail.executions
          .filter((execution) => execution.phase === "execute")
          .every((execution) =>
            nativePlan
              ? execution.runModeReceipt?.requestedMode === "plan" &&
                execution.runModeReceipt.status === "applied"
              : execution.runModeReceipt?.requestedMode === "default" &&
                execution.runModeReceipt.status === "applied",
          ),
      ).toBe(true);
      expect(provider.toolCallsFor(transport)).toBeGreaterThan(0);
    },
    60_000,
  );
});
