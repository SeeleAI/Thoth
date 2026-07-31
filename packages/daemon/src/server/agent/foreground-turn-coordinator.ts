import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { AgentAttachment, ThothTurnAck, ThothTurnSnapshot } from "@thoth/protocol/messages";
import type { ProviderRunMode, ProviderRunModeReceipt } from "@thoth/protocol/provider-control";
import type { AgentMessageDeliveryMode } from "@thoth/protocol/agent-turn-queue";
import type { TaskContextReference, TaskProjection } from "@thoth/protocol/task-authority";
import {
  createProviderTurnInteractionState,
  reduceProviderTurnInteraction,
  type ProviderTurnInteractionEvent,
} from "@thoth/core";
import type {
  AgentThothCardAnswerRequest,
  AgentThothCardAnswerResponse,
  AgentThothCardProjection,
  AgentThothState,
  ThothCardAnswerPayload,
  ThothClarifyCardModel,
  ThothIntentContractCardModel,
  ThothTurnControlSnapshot,
} from "@thoth/protocol/thoth/rpc-schemas";
import type { DecisionTreeSnapshot } from "@thoth/protocol/clarify-authority";
import type { ExecutionService } from "./execution-service.js";
import type { AgentRegistry } from "./agent-storage.js";
import type {
  AgentPromptInput,
  AgentRunOptions,
  AgentStreamEvent,
} from "@thoth/drivers/agent-runtime";
import { THOTH_RUNTIME_BUNDLE_CATALOG, loadRuntimeBundle } from "@thoth/drivers/harness";
import { ensureAgentLoaded } from "./agent-loading.js";
import { formatSystemNotificationPrompt } from "./agent-prompt.js";
import {
  type ForegroundAuthorityCard,
  type ForegroundCardAuthorityRecord,
  type ForegroundTurnAuthorityRecord,
  type WorkspaceForegroundAuthority,
} from "../workspace-authority/foreground-authority.js";
import type { ToolGateway } from "../workspace-authority/tool-gateway.js";
import type { WorkspaceTaskCoordinator } from "../workspace-authority/task-coordinator.js";
import type { TaskContextBroker } from "../workspace-authority/task-context-broker.js";
import { rejectClarifyChallenge, waitForClarifyChallenge } from "./clarify-audit-broker.js";

const USER_CANCELED_SUMMARY = "已中断当前请求，可继续输入。";
const BACKGROUND_HANDOFF_SUMMARY = "后台任务已注册；前台会话可以继续新的对话。";
const BACKGROUND_REORIENTATION_SUMMARY =
  "已确认后台任务的新意图合同；任务会从当前 Workspace 现实重新定向并继续。";
const CLARIFY_RUNTIME_BUNDLE = loadRuntimeBundle("thoth.clarify", THOTH_RUNTIME_BUNDLE_CATALOG);

interface StartForegroundTurnInput {
  agentId: string;
  workspaceId: string;
  workspacePath: string;
  text: string;
  messageId?: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: AgentAttachment[];
  thoth?: ThothTurnSnapshot;
  providerRunMode: ProviderRunMode;
  rawPrompt: AgentPromptInput;
  rawRunOptions?: AgentRunOptions;
  contextRefs?: TaskContextReference[];
  deliveryMode: AgentMessageDeliveryMode;
  taskClarifyHandoff?: {
    taskWorkspaceId: string;
    taskId: string;
    decisionRequestId: string;
  };
}

interface ForegroundTurnCoordinatorOptions {
  authorityStore: WorkspaceForegroundAuthority;
  executionService: ExecutionService;
  agentStorage: AgentRegistry;
  taskCoordinator: WorkspaceTaskCoordinator;
  taskContextBroker: TaskContextBroker;
  toolGateway: ToolGateway;
  logger: Logger;
}

interface ActiveQuickExecution {
  workspaceId: string;
  taskId: string;
  executionId: string;
  generation: string;
  summary: string;
  heartbeat: ReturnType<typeof setInterval>;
  unregisterRuntime: () => void;
}

interface ActiveQuickWait {
  token: string;
  workspaceId: string;
  taskId: string;
  turnId: string;
  generation: string;
  unsubscribe: () => void;
  retryTimer: ReturnType<typeof setTimeout>;
}

function toControls(
  snapshot: Extract<ThothTurnSnapshot, { enabled: true }>,
): ThothTurnControlSnapshot {
  return {
    mode: snapshot.executionMode,
    clarifyStrength: snapshot.clarifyStrength,
    loop: snapshot.executionMode === "loop" ? (snapshot.loopStrength ?? "one_plan_one_do") : null,
  };
}

function withPromptAttachments(input: {
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: AgentAttachment[];
}): AgentPromptInput {
  if ((input.images?.length ?? 0) === 0 && (input.attachments?.length ?? 0) === 0) {
    return input.text;
  }
  return [
    { type: "text" as const, text: input.text },
    ...(input.images ?? []).map((image) => ({ type: "image" as const, ...image })),
    ...(input.attachments ?? []),
  ];
}

function appendPromptContext(prompt: AgentPromptInput, context: string | null): AgentPromptInput {
  if (!context) {
    return prompt;
  }
  if (typeof prompt === "string") {
    return `${prompt}\n\n${context}`;
  }
  return [...prompt, { type: "text", text: context }];
}

function appendTextContext(text: string, context: string | null): string {
  return context ? `${text}\n\n${context}` : text;
}

function summarizeAnswer(answer: ThothCardAnswerPayload): string {
  if ("answers" in answer) {
    const choices = answer.answers.flatMap((entry) => entry.choiceIds);
    return answer.note?.trim() || choices.join("、") || answer.rawAnswer;
  }
  return answer.note?.trim() || answer.rawAnswer;
}

interface NormalizedClarifyQuestion {
  id: string;
  title: string;
  selectionMode: "single" | "multiple";
  choices: Array<{ id: string; label: string }>;
}

function getClarifyQuestions(card: ThothClarifyCardModel): NormalizedClarifyQuestion[] {
  return card.card.questions.map((question) => ({
    id: question.nodeId,
    title: question.question,
    selectionMode: question.selectionMode,
    choices: question.choices,
  }));
}

function validateClarifyAnswer(
  card: ThothClarifyCardModel,
  answer: ThothCardAnswerPayload,
): string | null {
  if (!("answers" in answer)) {
    return "Clarify Card requires a Clarify answer payload.";
  }
  if (answer.questionCardId !== card.id) {
    return "The answer does not belong to this Clarify Card.";
  }
  if (answer.intent === "stop") {
    return null;
  }
  if (answer.intent === "recommend" || answer.intent === "delegate_subtree") {
    const targetNodeId = answer.delegatedNodeIds[0];
    if (
      answer.delegatedNodeIds.length !== 1 ||
      answer.answers.length !== 1 ||
      answer.answers[0]?.nodeId !== targetNodeId
    ) {
      return `${answer.intent} must target exactly one question.`;
    }
    if (!getClarifyQuestions(card).some((question) => question.id === targetNodeId)) {
      return `${answer.intent} targets a question outside this Clarify Card.`;
    }
    return null;
  }
  const byId = new Map(answer.answers.map((entry) => [entry.nodeId, entry]));
  for (const question of getClarifyQuestions(card)) {
    const entry = byId.get(question.id);
    if (!entry && answer.intent !== "note_only") {
      return `Question ${question.title} is unanswered.`;
    }
    if (!entry) {
      continue;
    }
    const choiceIds = new Set(question.choices.map((choice) => choice.id));
    if (entry.choiceIds.some((choiceId) => !choiceIds.has(choiceId))) {
      return `Question ${question.title} contains an unknown choice.`;
    }
    if (question.selectionMode === "single" && entry.choiceIds.length > 1) {
      return `Question ${question.title} accepts one choice.`;
    }
  }
  return null;
}

function validateApprovalAnswer(input: {
  card: ThothIntentContractCardModel;
  answer: ThothCardAnswerPayload;
  controls: ThothTurnControlSnapshot;
}): string | null {
  if (!("cardId" in input.answer)) {
    return "This approval card requires an approval answer payload.";
  }
  if (input.answer.cardId !== input.card.id) {
    return "The answer does not belong to this approval card.";
  }
  if (
    (input.answer.intent === "accept_quick" && input.controls.mode !== "quick") ||
    (input.answer.intent === "accept_loop" && input.controls.mode !== "loop")
  ) {
    return "This card is bound to the execution mode selected when the turn was sent.";
  }
  return null;
}

function submitCard(
  record: ForegroundCardAuthorityRecord,
  answer: ThothCardAnswerPayload,
  submittedSummary: string,
): ForegroundAuthorityCard["card"] {
  if (record.kind !== "clarify_card" || !("answers" in answer)) {
    return { ...record.card, submitted: true, submittedSummary };
  }
  return {
    ...(record.card as ThothClarifyCardModel),
    submitted: true,
    submittedSummary,
    submittedAnswers: answer.answers.map((entry) => ({
      nodeId: entry.nodeId,
      choiceIds: entry.choiceIds,
      choiceNotes: entry.choiceNotes,
      ...(entry.note ? { note: entry.note } : {}),
    })),
    ...(answer.note ? { submittedNote: answer.note } : {}),
  };
}

function projectAuthorityCard(
  record: ForegroundCardAuthorityRecord | null,
): AgentThothCardProjection | null {
  if (!record) return null;
  return {
    kind: record.kind,
    card: record.card as ThothClarifyCardModel & ThothIntentContractCardModel,
    status: record.status,
    submittedSummary: record.submittedSummary,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  } as AgentThothCardProjection;
}

function renderClarifyCard(card: ThothClarifyCardModel): string {
  const answers = card.submittedAnswers ?? [];
  return [
    `Clarification: ${card.card.title}`,
    card.card.whyNow,
    ...getClarifyQuestions(card).map((question) => {
      const answer = answers.find((entry) => entry.nodeId === question.id);
      const selected = question.choices
        .filter((choice) => answer?.choiceIds.includes(choice.id))
        .map((choice) => choice.label);
      return `${question.title}: ${selected.join("、") || answer?.note || "not answered"}`;
    }),
    card.submittedSummary ? `User decision: ${card.submittedSummary}` : "",
    card.submittedNote ? `User note: ${card.submittedNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderIntentContractCard(card: ThothIntentContractCardModel): string {
  return [
    card.contract.title,
    `Objective: ${card.contract.objective}`,
    `Non-goals: ${card.contract.nonGoals.join("; ") || "none"}`,
    `Invariants: ${card.contract.invariants.join("; ") || "none"}`,
    `Acceptance: ${card.contract.acceptanceClaims.map((claim) => claim.statement).join("; ")}`,
    `Risk boundary: ${card.contract.riskBoundary.join("; ") || "none"}`,
    card.submittedSummary ? `User decision: ${card.submittedSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderTaskTruth(input: {
  turn: ForegroundTurnAuthorityRecord;
  cards: ForegroundCardAuthorityRecord[];
  session: DecisionTreeSnapshot;
}): string {
  return [
    `User request:\n${input.turn.userText}`,
    `Decision Tree:\n${JSON.stringify(
      input.session.nodes.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        crossLinkIds: node.crossLinkIds,
        title: node.title,
        summary: node.summary,
        owner: node.owner,
        materiality: node.materiality,
        status: node.status,
        resolutionRef: node.resolutionRef,
        sourceRefs: node.sourceRefs,
      })),
      null,
      2,
    )}`,
    ...input.cards.map((record) => {
      if (record.kind === "clarify_card") {
        return renderClarifyCard(record.card as ThothClarifyCardModel);
      }
      return `Intent Contract:\n${renderIntentContractCard(
        record.card as ThothIntentContractCardModel,
      )}`;
    }),
  ].join("\n\n");
}

function nextSemanticDirection(
  cards: ForegroundCardAuthorityRecord[],
  session: DecisionTreeSnapshot,
): string {
  const contract = cards.filter((card) => card.kind === "intent_contract_card").at(-1);
  if (contract?.status === "answered") {
    return "The Intent Contract decision is committed. Do not create another authority card.";
  }
  const latestClarify = cards.filter((card) => card.kind === "clarify_card").at(-1);
  if (latestClarify?.status === "answered") {
    return "Propagate the latest Human Decision through the Decision Tree, investigate its descendants, and ask only the next material Human-owned frontier. Propose the Intent Contract only when the tree is stable.";
  }
  if (session.session.challengerUsed && !session.session.intentContract) {
    return "The one-shot Challenger reopened missing nodes. Resolve that frontier, then propose the revised Intent Contract without another Challenger.";
  }
  return "Ground in Workspace reality, expand the Decision Tree, resolve Evidence-owned and Agent-owned nodes, then ask the first material Human-owned frontier or propose the Intent Contract if none exists.";
}

function buildThothAuthorityPrompt(input: {
  turn: ForegroundTurnAuthorityRecord;
  cards: ForegroundCardAuthorityRecord[];
  session: DecisionTreeSnapshot;
}): string {
  const controls = input.turn.controls;
  if (!controls) {
    throw new Error("The active Thoth turn is missing its frozen controls.");
  }
  return formatSystemNotificationPrompt(
    [
      "Follow the installed thoth.clarify skill in this visible Agent conversation.",
      `The user selected ${controls.mode === "loop" ? "background Loop" : "foreground Quick"} execution and ${controls.clarifyStrength} clarification.`,
      "Treat the conversation and Workspace as reality. Grow the Decision Tree as you investigate; ask only material Human-owned forks.",
      "Do not expose internal tools, schemas, state, ids, budgets, receipts, or recovery mechanics.",
      nextSemanticDirection(input.cards, input.session),
      renderTaskTruth(input),
    ].join("\n\n"),
  );
}

function buildQuickExecutionPrompt(input: {
  turn: ForegroundTurnAuthorityRecord;
  cards: ForegroundCardAuthorityRecord[];
  resume: boolean;
}): string {
  const contract = input.cards.filter((card) => card.kind === "intent_contract_card").at(-1);
  if (!contract || contract.status !== "answered") {
    throw new Error("Quick execution requires one approved Intent Contract.");
  }
  return formatSystemNotificationPrompt(
    [
      "Execute the complete approved task now in this same visible Agent conversation.",
      "Do not ask further clarification questions and do not call Thoth authority tools.",
      input.resume
        ? "Inspect Workspace reality, preserve completed work, and continue from the largest remaining gap against the Task Anchor."
        : "Orient against the Task Anchor, choose a coherent implementation path, and execute it to a verifiable result.",
      "Use normal provider tools to inspect, edit, test, and verify. Finish with evidence against every Acceptance Claim and name any real blocker plainly.",
      renderIntentContractCard(contract.card as ThothIntentContractCardModel),
    ].join("\n\n"),
  );
}

function buildProviderPlanImplementationPrompt(plan: string): string {
  return formatSystemNotificationPrompt(
    [
      "Implement the approved native Plan now in this same Provider session.",
      "Preserve the current user request, inspect current workspace reality, and verify the result.",
      `Approved Plan:\n${plan}`,
    ].join("\n\n"),
  );
}

function continuationKey(
  cards: ForegroundCardAuthorityRecord[],
  session: DecisionTreeSnapshot,
): string | null {
  const contract = cards.filter((card) => card.kind === "intent_contract_card").at(-1);
  if (contract) {
    return null;
  }
  const latestClarify = cards.filter((card) => card.kind === "clarify_card").at(-1);
  if (latestClarify?.status === "answered") {
    return `clarify-after-${latestClarify.id}`;
  }
  if (session.session.challengerUsed && !session.session.intentContract) {
    return `clarify-after-challenger-${session.session.id}`;
  }
  return "first-authority-card";
}

function occupiesForegroundExecutionSlot(lifecycle: AgentThothState["lifecycle"]): boolean {
  return [
    "running",
    "mapping",
    "awaiting_card",
    "challenging",
    "proposing",
    "awaiting_implementation",
    "quick_wait",
    "quick_exec",
  ].includes(lifecycle);
}

export class ForegroundTurnCoordinator {
  private readonly activeRunTokens = new Map<string, string>();
  private readonly deferredRunTokens = new Map<string, string>();
  private readonly queueDrains = new Set<string>();
  private readonly activeQuickExecutions = new Map<string, ActiveQuickExecution>();
  private readonly activeQuickWaits = new Map<string, ActiveQuickWait>();

  constructor(private readonly options: ForegroundTurnCoordinatorOptions) {}

  /** Fences ephemeral foreground callbacks before Workspace authority closes. */
  close(): void {
    this.activeRunTokens.clear();
    this.deferredRunTokens.clear();
    for (const agentId of [...this.activeQuickWaits.keys()]) {
      this.clearQuickWait(agentId);
    }
    for (const [agentId, active] of this.activeQuickExecutions) {
      clearInterval(active.heartbeat);
      active.unregisterRuntime();
      this.options.toolGateway.endForegroundTurn({
        agentId,
        generation: active.generation,
      });
    }
    this.activeQuickExecutions.clear();
    this.queueDrains.clear();
  }

  async openTaskClarifyHandoff(input: {
    sourceWorkspaceId: string;
    taskWorkspaceId: string;
    task: TaskProjection;
    decisionId: string;
  }): Promise<void> {
    const workspace = this.options.authorityStore.getWorkspace(input.sourceWorkspaceId);
    if (
      !workspace ||
      input.task.workspaceId !== input.taskWorkspaceId ||
      input.task.sourceAgentWorkspaceId !== input.sourceWorkspaceId
    ) {
      throw new Error(
        `Workspace ${input.sourceWorkspaceId} cannot host this Task Clarify handoff.`,
      );
    }
    if (
      input.task.pendingDecision?.id !== input.decisionId ||
      input.task.pendingDecision.kind !== "contract_change"
    ) {
      throw new Error("Task Clarify handoff no longer owns a pending contract decision.");
    }
    const loopStrength =
      input.task.budget.strength === "single"
        ? "one_plan_one_do"
        : input.task.budget.strength === "infinite"
          ? "run_until_stopped"
          : input.task.budget.strength;
    const text = [
      `Background Task @${input.task.title} needs a Human-owned contract decision.`,
      input.task.pendingDecision.question,
      "Reopen Clarify against the existing Task Anchor, latest Workspace evidence, and current decision frontier. Confirm a revised Intent Contract for this same Task; do not create a separate Task.",
    ].join("\n\n");
    await this.startTurn({
      agentId: input.task.sourceAgentId,
      workspaceId: input.sourceWorkspaceId,
      workspacePath: workspace.canonicalPath,
      text,
      messageId: `task-clarify:${input.task.id}:${input.decisionId}`,
      thoth: {
        enabled: true,
        executionMode: "loop",
        clarifyStrength: "balanced",
        loopStrength,
      },
      providerRunMode: "default",
      rawPrompt: text,
      contextRefs: [
        {
          kind: "task",
          workspaceId: input.taskWorkspaceId,
          taskId: input.task.id,
          revision: input.task.revision,
        },
      ],
      deliveryMode: "queue",
      taskClarifyHandoff: {
        taskWorkspaceId: input.taskWorkspaceId,
        taskId: input.task.id,
        decisionRequestId: input.decisionId,
      },
    });
  }

  async startTurn(input: StartForegroundTurnInput): Promise<ThothTurnAck> {
    const agent = await ensureAgentLoaded(input.agentId, {
      executionService: this.options.executionService,
      agentStorage: this.options.agentStorage,
      logger: this.options.logger,
    });
    if (agent.internal === true) {
      throw new Error("Internal agents cannot own foreground Thoth turns.");
    }
    const existingTurn = input.messageId
      ? this.options.authorityStore.getTurnBySourceMessage(agent.id, input.messageId)
      : null;
    if (existingTurn) {
      const state = this.options.authorityStore.getState(agent.id);
      return {
        turnKind: existingTurn.kind,
        turnId: existingTurn.id,
        authorityRevision: state.revision,
        providerRunMode: existingTurn.providerRunMode,
        ...(existingTurn.providerRunModeReceipt
          ? { providerRunModeReceipt: existingTurn.providerRunModeReceipt }
          : {}),
        disposition: "started",
        queuePosition: null,
      };
    }
    const foregroundState = this.options.authorityStore.getState(agent.id);
    if (
      this.options.executionService.hasInFlightRun(agent.id) ||
      occupiesForegroundExecutionSlot(foregroundState.lifecycle)
    ) {
      const queued = this.options.authorityStore.enqueueTurn({
        agentId: agent.id,
        messageId: input.messageId ?? randomUUID(),
        text: input.text,
        deliveryMode: input.deliveryMode,
        attachmentCount: (input.images?.length ?? 0) + (input.attachments?.length ?? 0),
        payload: input,
      });
      const deliveryMode = queued.queuedTurn.deliveryMode;
      if (deliveryMode === "interrupt") {
        void this.interruptAndDrain(agent.id);
      }
      return {
        turnKind: input.thoth?.enabled === true ? "thoth" : "raw",
        turnId: queued.queuedTurn.id,
        authorityRevision: queued.revision,
        providerRunMode: input.providerRunMode,
        disposition: deliveryMode === "interrupt" ? "interrupting" : "queued",
        queuePosition: queued.queuedTurn.position,
      };
    }
    const kind = input.thoth?.enabled === true ? "thoth" : "raw";
    const started = this.options.authorityStore.startTurn({
      agentId: agent.id,
      kind,
      ...(input.thoth?.enabled === true ? { controls: toControls(input.thoth) } : {}),
      providerRunMode: input.providerRunMode,
      ...(input.messageId ? { sourceMessageId: input.messageId } : {}),
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      userText: input.text,
      ...(input.taskClarifyHandoff ? { taskClarifyHandoff: input.taskClarifyHandoff } : {}),
    });
    if (!started.created) {
      return {
        turnKind: started.turn.kind,
        turnId: started.turn.id,
        authorityRevision: started.state.revision,
        providerRunMode: started.turn.providerRunMode,
        ...(started.turn.providerRunModeReceipt
          ? { providerRunModeReceipt: started.turn.providerRunModeReceipt }
          : {}),
        disposition: "started",
        queuePosition: null,
      };
    }

    let taskContextPrompt: string | null = null;
    try {
      const prepared = input.taskClarifyHandoff
        ? this.options.taskContextBroker.prepareTaskClarifyHandoff({
            sourceWorkspaceId: input.workspaceId,
            sourceAgentId: agent.id,
            taskWorkspaceId: input.taskClarifyHandoff.taskWorkspaceId,
            taskId: input.taskClarifyHandoff.taskId,
            taskRevision:
              input.contextRefs?.find(
                (reference) => reference.taskId === input.taskClarifyHandoff?.taskId,
              )?.revision ?? -1,
            decisionRequestId: input.taskClarifyHandoff.decisionRequestId,
          })
        : this.options.taskContextBroker.prepare(input.workspaceId, input.contextRefs ?? []);
      this.options.taskContextBroker.bindTurn({
        workspaceId: input.workspaceId,
        agentId: agent.id,
        turnId: started.turn.id,
        prepared,
      });
      taskContextPrompt = prepared.prompt;
    } catch (error) {
      this.options.authorityStore.markLifecycle({
        agentId: agent.id,
        turnId: started.turn.id,
        generation: started.turn.generation,
        lifecycle: "interrupted",
        reason: "turn_interrupted",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (kind === "thoth") {
      const capabilities = await this.options.executionService.getHarnessCapabilities(
        agent.provider,
      );
      if (
        capabilities.runtimeBundleActivation !== "native_skill" ||
        capabilities.toolAttachment.length === 0
      ) {
        const state = this.options.authorityStore.markLifecycle({
          agentId: agent.id,
          turnId: started.turn.id,
          generation: started.turn.generation,
          lifecycle: "unsupported",
          reason: "turn_interrupted",
          error:
            "The selected provider session does not support same-session per-turn RuntimeBundle activation.",
        });
        throw new Error(
          state?.error ??
            "The selected provider session does not support same-session per-turn RuntimeBundle activation.",
        );
      }
      if (input.messageId) {
        await this.options.executionService.appendTimelineItem(agent.id, {
          type: "user_message",
          text: input.text,
          messageId: input.messageId,
        });
      }
      const controls = started.turn.controls;
      if (!controls) throw new Error("Thoth turn is missing frozen controls");
      if (controls.clarifyStrength === "none") {
        throw new Error("An enabled Thoth turn requires a real Clarify strength");
      }
      const decisionTree = this.options.authorityStore.startDecisionSession({
        agentId: agent.id,
        turnId: started.turn.id,
        requestedStrength: controls.clarifyStrength,
      });
      this.options.authorityStore.markLifecycle({
        agentId: agent.id,
        turnId: started.turn.id,
        generation: started.turn.generation,
        lifecycle: "mapping",
        reason: "decision_tree_changed",
        error: null,
      });
      const prompt = withPromptAttachments({
        text: appendTextContext(
          buildThothAuthorityPrompt({ turn: started.turn, cards: [], session: decisionTree }),
          taskContextPrompt,
        ),
        images: input.images,
        attachments: input.attachments,
      });
      const preparedTurn = await this.prepareProviderRunMode(started.turn);
      this.startProviderRun(preparedTurn, prompt, { replace: false, structured: true });
    } else {
      const preparedTurn = await this.prepareProviderRunMode(started.turn);
      this.startProviderRun(preparedTurn, appendPromptContext(input.rawPrompt, taskContextPrompt), {
        replace: false,
        structured: false,
        runOptions: {
          ...input.rawRunOptions,
          ...(input.messageId ? { messageId: input.messageId } : {}),
        },
      });
    }

    return {
      turnKind: kind,
      turnId: started.turn.id,
      authorityRevision: started.state.revision,
      providerRunMode: input.providerRunMode,
      ...(this.options.authorityStore.getTurn(started.turn.id)?.providerRunModeReceipt
        ? {
            providerRunModeReceipt: this.options.authorityStore.getTurn(started.turn.id)!
              .providerRunModeReceipt!,
          }
        : {}),
      disposition: "started",
      queuePosition: null,
    };
  }

  async commandQueue(
    input: import("../workspace-authority/foreground-authority-types.js").ForegroundQueueCommandInput,
  ) {
    const result = this.options.authorityStore.commandQueue(input);
    if (result.accepted && input.command === "interrupt") {
      void this.interruptAndDrain(input.agentId);
    }
    return result;
  }

  clearQueue(agentId: string): number {
    return this.options.authorityStore.clearQueue(agentId);
  }

  async resumeQueue(agentId: string): Promise<void> {
    await this.drainQueue(agentId);
  }

  async prepareRewind(agentId: string): Promise<void> {
    if (occupiesForegroundExecutionSlot(this.options.authorityStore.getState(agentId).lifecycle)) {
      await this.cancel(agentId, { drainQueue: false });
    }
  }

  private async interruptAndDrain(agentId: string): Promise<void> {
    if (occupiesForegroundExecutionSlot(this.options.authorityStore.getState(agentId).lifecycle)) {
      await this.cancel(agentId);
    }
    await this.drainQueue(agentId);
  }

  private async drainQueue(agentId: string): Promise<void> {
    if (this.queueDrains.has(agentId)) return;
    this.queueDrains.add(agentId);
    try {
      if (
        this.options.executionService.hasInFlightRun(agentId) ||
        occupiesForegroundExecutionSlot(this.options.authorityStore.getState(agentId).lifecycle)
      ) {
        return;
      }
      const next = this.options.authorityStore.peekQueue(agentId);
      if (!next) return;
      const ack = await this.startTurn(next.payload as StartForegroundTurnInput);
      if (ack.disposition === "started") {
        this.options.authorityStore.removeQueuedTurn(agentId, next.queuedTurn.id);
      }
    } catch (error) {
      this.options.logger.error({ err: error, agentId }, "Failed to start queued foreground turn");
    } finally {
      this.queueDrains.delete(agentId);
      if (
        !this.options.executionService.hasInFlightRun(agentId) &&
        !occupiesForegroundExecutionSlot(this.options.authorityStore.getState(agentId).lifecycle) &&
        this.options.authorityStore.peekQueue(agentId)
      ) {
        queueMicrotask(() => void this.drainQueue(agentId));
      }
    }
  }

  async resolveProviderApproval(
    agentId: string,
    requestId: string,
    response: import("@thoth/drivers/agent-runtime").AgentPermissionResponse,
  ): Promise<boolean> {
    const turn = this.options.authorityStore.getActiveTurn(agentId);
    const agent = this.options.executionService.getAgent(agentId);
    const request = agent?.pendingPermissions.get(requestId);
    if (!turn || !request) {
      return false;
    }
    const daemonPlanApproval =
      request.kind === "plan" &&
      request.metadata?.owner === "thoth-daemon" &&
      request.metadata?.authority === "provider-plan";
    if (daemonPlanApproval) {
      const current = this.options.authorityStore.getTurn(turn.id) ?? turn;
      if (
        request.metadata?.turnId !== current.id ||
        request.metadata?.generation !== current.generation ||
        !current.providerInteraction ||
        !current.providerPlanReceipt
      ) {
        throw new Error("The Daemon Plan approval no longer matches its foreground authority.");
      }
      const transition = reduceProviderTurnInteraction(current.providerInteraction, {
        type: response.behavior === "deny" ? "implementation_rejected" : "implementation_approved",
      });
      if (!transition.accepted) {
        throw Object.assign(new Error(transition.errorCode ?? "Provider Plan sequence invalid"), {
          code: transition.errorCode,
        });
      }
      const updated = this.options.authorityStore.recordProviderInteraction({
        agentId,
        turnId: current.id,
        generation: current.generation,
        expectedRevision: current.providerInteractionRevision,
        interaction: transition.state,
      });
      await this.options.executionService.resolveDaemonPlanApproval(agentId, requestId, response);
      if (response.behavior === "deny") {
        this.options.toolGateway.endForegroundTurn({ agentId, generation: turn.generation });
        this.options.authorityStore.markLifecycle({
          agentId,
          turnId: turn.id,
          generation: turn.generation,
          lifecycle: "done",
          reason: "turn_completed",
          error: null,
        });
        void this.drainQueue(agentId);
        return true;
      }
      await this.options.executionService.prepareAgentRunMode(agentId, "default");
      this.options.authorityStore.markLifecycle({
        agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "running",
        reason: "turn_started",
        error: null,
      });
      this.startProviderRun(
        updated,
        buildProviderPlanImplementationPrompt(current.providerPlanReceipt.text),
        { replace: false, structured: false },
      );
      return true;
    }

    const result = await this.options.executionService.respondToPermission(
      agentId,
      requestId,
      response,
    );
    if (result?.followUpPrompt) {
      const current = this.options.authorityStore.getTurn(turn.id) ?? turn;
      const cards = this.options.authorityStore.listCardsForTurn(current.id);
      const hasApprovedContract = cards.some(
        (card) => card.kind === "intent_contract_card" && card.status === "answered",
      );
      this.startProviderRun(current, result.followUpPrompt, {
        replace: true,
        structured:
          current.kind === "thoth" && !(current.controls?.mode === "quick" && hasApprovedContract),
      });
    }
    return true;
  }

  async getState(agentId: string): Promise<AgentThothState> {
    await this.recover(agentId);
    return this.options.authorityStore.getState(agentId);
  }

  async listDecisionSessions(agentId: string) {
    await this.recover(agentId);
    return this.options.authorityStore.listDecisionSessions(agentId);
  }

  async getDecisionTree(agentId: string, sessionId?: string) {
    await this.recover(agentId);
    return this.options.authorityStore.getDecisionTree(agentId, sessionId);
  }

  prioritizeDecisionNode(input: {
    agentId: string;
    sessionId: string;
    nodeId: string;
    expectedRevision: number;
    commandId: string;
  }) {
    return this.options.authorityStore.prioritizeDecisionNode(input);
  }

  async answerCard(
    request: AgentThothCardAnswerRequest,
    actor: { actorId: string; clientId: string; deviceId?: string | null },
  ): Promise<AgentThothCardAnswerResponse["payload"]> {
    const record = this.options.authorityStore.getCard(request.cardId);
    const turn = record ? this.options.authorityStore.getTurn(record.turnId) : null;
    if (!record || !turn || record.agentId !== request.agentId || !turn.controls) {
      return {
        requestId: request.requestId,
        accepted: false,
        conflict: false,
        state: this.options.authorityStore.getState(request.agentId),
        card: null,
        decisionTreeDelta: null,
        error: "The authority card does not belong to this Agent.",
      };
    }
    const validationError =
      record.kind === "clarify_card"
        ? validateClarifyAnswer(record.card as ThothClarifyCardModel, request.answer)
        : validateApprovalAnswer({
            card: record.card as ThothIntentContractCardModel,
            answer: request.answer,
            controls: turn.controls,
          });
    if (validationError) {
      return {
        requestId: request.requestId,
        accepted: false,
        conflict: false,
        state: this.options.authorityStore.getState(request.agentId),
        card: projectAuthorityCard(record),
        decisionTreeDelta: null,
        error: validationError,
      };
    }
    const summary = summarizeAnswer(request.answer);
    const cancelRequested = request.answer.intent === "cancel" || request.answer.intent === "stop";
    const quickApproved =
      record.kind === "intent_contract_card" && request.answer.intent === "accept_quick";
    const loopApproved =
      record.kind === "intent_contract_card" && request.answer.intent === "accept_loop";
    const taskClarifyHandoff = this.options.authorityStore.getTaskClarifyHandoff(turn.id);
    const result = this.options.authorityStore.answerCard({
      agentId: request.agentId,
      cardId: request.cardId,
      answer: request.answer,
      submittedCard: submitCard(record, request.answer, summary),
      submittedSummary: summary,
      expectedRevision: request.expectedRevision,
      commandId: request.commandId,
      nextLifecycle: cancelRequested ? "canceled" : quickApproved ? "quick_exec" : "running",
      actorId: actor.actorId,
      clientId: actor.clientId,
      deviceId: actor.deviceId ?? null,
    });
    if (!result.accepted) {
      return {
        requestId: request.requestId,
        accepted: false,
        conflict: result.conflict,
        state: result.state,
        card: projectAuthorityCard(result.card),
        decisionTreeDelta: result.decisionTreeDelta,
        error: result.error,
      };
    }
    if (result.duplicate) {
      await this.recover(request.agentId);
      return {
        requestId: request.requestId,
        accepted: true,
        conflict: false,
        state: this.options.authorityStore.getState(request.agentId),
        card: projectAuthorityCard(result.card),
        decisionTreeDelta: result.decisionTreeDelta,
        error: null,
      };
    }

    if (cancelRequested) {
      await this.options.executionService.cancelAgentRun(request.agentId).catch(() => false);
    } else {
      if (record.kind === "clarify_card" && "questionCardId" in request.answer) {
        await this.launchAuthorityContinuation(turn);
      } else if (quickApproved || loopApproved) {
        if (taskClarifyHandoff?.status === "active") {
          await this.completeTaskClarifyHandoff(turn, taskClarifyHandoff.taskId);
        } else if (loopApproved) {
          await this.registerLoop(turn);
        } else {
          const task = await this.registerApprovedTask(turn, "quick");
          await this.launchQuickExecution(
            this.options.authorityStore.getTurn(turn.id) ?? turn,
            true,
            task.id,
          );
        }
      } else if (record.kind === "intent_contract_card" && request.answer.intent === "annotate") {
        await this.launchAuthorityContinuation(turn);
      } else {
        await this.launchAuthorityContinuation(turn);
      }
    }

    return {
      requestId: request.requestId,
      accepted: true,
      conflict: false,
      state: this.options.authorityStore.getState(request.agentId),
      card: projectAuthorityCard(result.card),
      decisionTreeDelta: result.decisionTreeDelta,
      error: null,
    };
  }

  async cancel(agentId: string, options: { drainQueue?: boolean } = {}): Promise<AgentThothState> {
    await ensureAgentLoaded(agentId, {
      executionService: this.options.executionService,
      agentStorage: this.options.agentStorage,
      logger: this.options.logger,
    });
    const turn = this.options.authorityStore.getActiveTurn(agentId);
    this.options.authorityStore.cancelActiveTurn({
      agentId,
      submittedSummary: USER_CANCELED_SUMMARY,
    });
    if (turn) {
      this.options.toolGateway.endForegroundTurn({ agentId, generation: turn.generation });
    }
    this.activeRunTokens.delete(agentId);
    this.deferredRunTokens.delete(agentId);
    this.clearQuickWait(agentId);
    await this.options.executionService.cancelAgentRun(agentId).catch(() => false);
    this.settleQuickExecution(agentId, "failed", USER_CANCELED_SUMMARY);
    if (options.drainQueue !== false) {
      void this.drainQueue(agentId);
    }
    return this.options.authorityStore.getState(agentId);
  }

  private startProviderRun(
    turn: ForegroundTurnAuthorityRecord,
    prompt: AgentPromptInput,
    input: { replace: boolean; structured: boolean; runOptions?: AgentRunOptions },
  ): void {
    const token = randomUUID();
    this.activeRunTokens.set(turn.agentId, token);
    this.options.toolGateway.beginForegroundTurn({
      agentId: turn.agentId,
      workspaceId: turn.workspaceId,
      generation: turn.generation,
      kind: input.structured ? "thoth_clarify" : "raw_provider",
      foregroundTurnId: turn.id,
    });
    const runOptions: AgentRunOptions = {
      ...(input.runOptions ?? {}),
      runtimeBundleActivation:
        turn.kind === "thoth" && input.structured
          ? {
              bundleId: CLARIFY_RUNTIME_BUNDLE.id,
              bundleDigest: CLARIFY_RUNTIME_BUNDLE.digest,
              scope: "clarify",
              generation: turn.generation,
            }
          : null,
    };
    const events =
      input.replace && this.options.executionService.hasInFlightRun(turn.agentId)
        ? this.options.executionService.replaceAgentRun(turn.agentId, prompt, runOptions)
        : this.options.executionService.streamAgent(turn.agentId, prompt, runOptions);
    void this.consumeProviderRun({ turn, token, events, structured: input.structured });
  }

  private async consumeProviderRun(input: {
    turn: ForegroundTurnAuthorityRecord;
    token: string;
    events: AsyncGenerator<AgentStreamEvent>;
    structured: boolean;
  }): Promise<void> {
    try {
      for await (const event of input.events) {
        if (this.activeRunTokens.get(input.turn.agentId) !== input.token) {
          continue;
        }
        if (event.type === "turn_started") {
          const providerTurnId = event.providerTurnId ?? event.turnId;
          const runtimeAttachment =
            this.options.executionService.consumeForegroundRuntimeAttachment(
              input.turn.agentId,
              input.turn.generation,
            );
          if (runtimeAttachment) {
            this.options.authorityStore.recordRuntimeAttachment({
              agentId: input.turn.agentId,
              turnId: input.turn.id,
              generation: input.turn.generation,
              receipt: runtimeAttachment,
            });
          }
          if (providerTurnId) {
            this.options.toolGateway.bindForegroundProviderTurn({
              agentId: input.turn.agentId,
              generation: input.turn.generation,
              providerTurnId,
            });
            this.options.authorityStore.bindProviderTurn({
              agentId: input.turn.agentId,
              turnId: input.turn.id,
              generation: input.turn.generation,
              providerTurnId,
            });
          }
          const current = this.options.authorityStore.getTurn(input.turn.id) ?? input.turn;
          if (current.providerRunMode === "plan" && !current.providerInteraction) {
            const agent = this.options.executionService.getAgent(input.turn.agentId);
            const providerThreadId =
              agent?.persistence?.nativeHandle ?? agent?.persistence?.sessionId ?? null;
            if (!providerThreadId || !providerTurnId) {
              throw Object.assign(
                new Error("Native Plan turn is missing Provider thread or turn identity."),
                { code: "PROVIDER_TURN_MISMATCH" },
              );
            }
            this.options.authorityStore.recordProviderInteraction({
              agentId: current.agentId,
              turnId: current.id,
              generation: current.generation,
              expectedRevision: current.providerInteractionRevision,
              interaction: createProviderTurnInteractionState({
                providerThreadId,
                providerTurnId,
              }),
            });
          }
        }
        const interactionTurn = this.options.authorityStore.getTurn(input.turn.id) ?? input.turn;
        if (event.type === "timeline" && event.item.type === "assistant_message") {
          const quick = this.activeQuickExecutions.get(input.turn.agentId);
          if (quick) quick.summary = event.item.text;
        }
        if (event.type === "provider_question_requested" && interactionTurn.providerInteraction) {
          this.commitProviderInteraction(
            interactionTurn,
            {
              type: "question_requested",
              providerThreadId: event.question.providerThreadId,
              providerTurnId: event.question.providerTurnId,
              interactionId: event.question.interactionId,
            },
            null,
          );
        } else if (
          event.type === "provider_question_resolved" &&
          interactionTurn.providerInteraction
        ) {
          this.commitProviderInteraction(
            interactionTurn,
            {
              type: "question_resolved",
              providerThreadId: interactionTurn.providerInteraction.providerThreadId,
              providerTurnId: interactionTurn.providerInteraction.providerTurnId,
              interactionId: event.interactionId,
              resolution: event.status,
            },
            null,
          );
        } else if (event.type === "provider_plan_completed") {
          if (!interactionTurn.providerInteraction) {
            throw Object.assign(
              new Error("Completed native Plan arrived without an active Plan interaction."),
              { code: "PROVIDER_PLAN_SEQUENCE_INVALID" },
            );
          }
          const actualBytes = Buffer.byteLength(event.plan.text, "utf8");
          if (
            event.plan.originalBytes !== actualBytes ||
            event.plan.retainedBytes !== actualBytes
          ) {
            throw Object.assign(
              new Error("Completed native Plan byte receipt does not match its retained text."),
              { code: "PROVIDER_PLAN_SEQUENCE_INVALID" },
            );
          }
          const updated = this.commitProviderInteraction(
            interactionTurn,
            {
              type: "plan_completed",
              providerThreadId: event.plan.providerThreadId,
              providerTurnId: event.plan.providerTurnId,
              itemId: event.plan.itemId,
              byteLength: actualBytes,
            },
            event.plan,
          );
          await this.options.executionService.appendTimelineItem(updated.agentId, {
            type: "tool_call",
            callId: event.plan.itemId,
            name: "Plan",
            status: "completed",
            detail: { type: "plan", text: event.plan.text },
            error: null,
          });
        }
        if (
          event.type !== "turn_completed" &&
          event.type !== "turn_failed" &&
          event.type !== "turn_canceled"
        ) {
          continue;
        }
        this.activeRunTokens.delete(input.turn.agentId);
        this.options.toolGateway.endForegroundTurn({
          agentId: input.turn.agentId,
          generation: input.turn.generation,
        });
        const state = this.options.authorityStore.getState(input.turn.agentId);
        const decisionTree = input.structured
          ? this.options.authorityStore.getDecisionTree(input.turn.agentId)
          : null;
        if (
          decisionTree?.session.intentContract &&
          !decisionTree.session.challengerUsed &&
          ["proposing", "challenging"].includes(state.lifecycle)
        ) {
          await this.launchClarifyChallenger(
            this.options.authorityStore.getTurn(input.turn.id) ?? input.turn,
            decisionTree,
          );
          return;
        }
        if (
          state.lifecycle === "awaiting_card" ||
          state.lifecycle === "awaiting_implementation" ||
          state.lifecycle === "background_handoff" ||
          state.lifecycle === "canceled"
        ) {
          if (state.lifecycle === "background_handoff" || state.lifecycle === "canceled") {
            void this.drainQueue(input.turn.agentId);
          }
          return;
        }
        if (event.type === "turn_failed" || event.type === "turn_canceled") {
          const current = this.options.authorityStore.getTurn(input.turn.id) ?? input.turn;
          if (current.providerInteraction?.phase === "implementing") {
            this.commitProviderInteraction(current, { type: "implementation_settled" }, null);
          }
          this.options.authorityStore.markLifecycle({
            agentId: input.turn.agentId,
            turnId: input.turn.id,
            generation: input.turn.generation,
            lifecycle: "interrupted",
            reason: "turn_interrupted",
            error:
              event.type === "turn_failed" ? event.error : event.reason || "Provider turn canceled",
          });
          this.settleQuickExecution(
            input.turn.agentId,
            "failed",
            event.type === "turn_failed" ? event.error : event.reason || "Provider turn canceled",
          );
          void this.drainQueue(input.turn.agentId);
          return;
        }
        const current = this.options.authorityStore.getTurn(input.turn.id) ?? input.turn;
        if (current.providerInteraction?.phase === "implementing") {
          this.commitProviderInteraction(current, { type: "implementation_settled" }, null);
        } else if (current.providerRunMode === "plan") {
          if (!current.providerInteraction) {
            throw Object.assign(
              new Error("Native Plan turn completed without an interaction receipt."),
              { code: "PROVIDER_PLAN_MISSING" },
            );
          }
          if (!event.providerTurnId) {
            throw Object.assign(
              new Error("Native Plan terminal event is missing Provider turn identity."),
              { code: "PROVIDER_TURN_MISMATCH" },
            );
          }
          const completed = this.commitProviderInteraction(
            current,
            {
              type: "turn_completed",
              providerThreadId: current.providerInteraction.providerThreadId,
              providerTurnId: event.providerTurnId,
            },
            null,
          );
          if (!completed.providerPlanReceipt) {
            throw Object.assign(new Error("Native Plan completed without a durable receipt."), {
              code: "PROVIDER_PLAN_MISSING",
            });
          }
          this.options.authorityStore.markLifecycle({
            agentId: completed.agentId,
            turnId: completed.id,
            generation: completed.generation,
            lifecycle: "awaiting_implementation",
            reason: "turn_started",
            error: null,
          });
          await this.options.executionService.openDaemonPlanApproval({
            agentId: completed.agentId,
            turnId: completed.id,
            generation: completed.generation,
            plan: completed.providerPlanReceipt,
          });
          return;
        }
        if (!input.structured || state.lifecycle === "quick_exec") {
          if (state.lifecycle === "quick_exec") {
            const quick = this.activeQuickExecutions.get(input.turn.agentId);
            this.settleQuickExecution(
              input.turn.agentId,
              "succeeded",
              quick?.summary.trim() || "Quick execution completed in the visible Provider thread.",
            );
          }
          this.options.authorityStore.markLifecycle({
            agentId: input.turn.agentId,
            turnId: input.turn.id,
            generation: input.turn.generation,
            lifecycle: "done",
            reason: "turn_completed",
            error: null,
          });
          void this.drainQueue(input.turn.agentId);
          return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        await this.launchAuthorityContinuation(input.turn);
        return;
      }
    } catch (error) {
      const currentToken = this.activeRunTokens.get(input.turn.agentId);
      if (currentToken && currentToken !== input.token) {
        return;
      }
      this.activeRunTokens.delete(input.turn.agentId);
      this.options.toolGateway.endForegroundTurn({
        agentId: input.turn.agentId,
        generation: input.turn.generation,
      });
      this.options.authorityStore.markLifecycle({
        agentId: input.turn.agentId,
        turnId: input.turn.id,
        generation: input.turn.generation,
        lifecycle: "interrupted",
        reason: "turn_interrupted",
        error: error instanceof Error ? error.message : String(error),
      });
      void this.drainQueue(input.turn.agentId);
    }
  }

  private commitProviderInteraction(
    turn: ForegroundTurnAuthorityRecord,
    event: ProviderTurnInteractionEvent,
    planReceipt: import("@thoth/protocol/agent-types").ProviderPlanCompleted | null,
  ): ForegroundTurnAuthorityRecord {
    if (!turn.providerInteraction) {
      throw Object.assign(new Error("Foreground turn has no Provider interaction state."), {
        code: "PROVIDER_PLAN_SEQUENCE_INVALID",
      });
    }
    const transition = reduceProviderTurnInteraction(turn.providerInteraction, event);
    const updated = this.options.authorityStore.recordProviderInteraction({
      agentId: turn.agentId,
      turnId: turn.id,
      generation: turn.generation,
      expectedRevision: turn.providerInteractionRevision,
      interaction: transition.state,
      ...(planReceipt ? { planReceipt } : {}),
    });
    if (!transition.accepted) {
      throw Object.assign(
        new Error(transition.errorCode ?? "Provider interaction sequence was rejected."),
        { code: transition.errorCode },
      );
    }
    return updated;
  }

  private async launchClarifyChallenger(
    turn: ForegroundTurnAuthorityRecord,
    session: DecisionTreeSnapshot,
  ): Promise<void> {
    if (!session.session.intentContract || session.session.challengerUsed || !turn.controls) {
      return;
    }
    const sourceAgent = await ensureAgentLoaded(turn.agentId, {
      executionService: this.options.executionService,
      agentStorage: this.options.agentStorage,
      logger: this.options.logger,
    });
    this.options.authorityStore.markLifecycle({
      agentId: turn.agentId,
      turnId: turn.id,
      generation: turn.generation,
      lifecycle: "challenging",
      reason: "contract_proposed",
      error: null,
    });
    const challenger = await this.options.executionService.createAgent(
      {
        provider: sourceAgent.provider,
        cwd: sourceAgent.cwd,
        internal: true,
        ...(sourceAgent.config.model ? { model: sourceAgent.config.model } : {}),
        modeId: "auto",
        ...(sourceAgent.config.thinkingOptionId
          ? { thinkingOptionId: sourceAgent.config.thinkingOptionId }
          : {}),
        ...(sourceAgent.config.featureValues
          ? { featureValues: sourceAgent.config.featureValues }
          : {}),
        systemPrompt:
          "You are the one-shot fresh Thoth Intent Contract Challenger. Work read-only. Independently inspect Workspace reality, the visible Decision Tree, and the proposed Intent Contract. Do not ask the user. Call thoth_clarify_judge_contract exactly once with stable, reopen, or blocked; reopen only concrete missing material branches.",
      },
      undefined,
      {
        labels: { surface: "thoth-clarify-challenger", sourceAgentId: sourceAgent.id },
        runtimeBundleScope: "clarify_challenger",
        persistSession: true,
        persistInternal: true,
        initialTitle: "Intent Contract Challenger",
        ...(sourceAgent.workspaceId ? { workspaceId: sourceAgent.workspaceId } : {}),
      },
    );
    const waiting = waitForClarifyChallenge(challenger.id);
    let resolved = false;
    const run = (async () => {
      try {
        for await (const event of this.options.executionService.streamAgent(
          challenger.id,
          formatSystemNotificationPrompt(
            [
              "Judge this proposed Intent Contract once.",
              `User request:\n${turn.userText}`,
              `Decision Tree:\n${JSON.stringify(session.nodes, null, 2)}`,
              `Intent Contract:\n${JSON.stringify(session.session.intentContract, null, 2)}`,
              "Inspect Workspace reality before judging. Return only through thoth_clarify_judge_contract.",
            ].join("\n\n"),
          ),
          {
            runtimeBundleActivation: {
              bundleId: CLARIFY_RUNTIME_BUNDLE.id,
              bundleDigest: CLARIFY_RUNTIME_BUNDLE.digest,
              scope: "clarify_challenger",
              generation: challenger.id,
            },
          },
        )) {
          if (resolved) continue;
          if (event.type === "turn_failed") {
            rejectClarifyChallenge(challenger.id, event.error);
            return;
          }
          if (event.type === "turn_canceled") {
            rejectClarifyChallenge(challenger.id, event.reason || "Challenger canceled");
            return;
          }
          if (event.type === "turn_completed") {
            rejectClarifyChallenge(
              challenger.id,
              "Clarify Challenger completed without a semantic judgment",
            );
            return;
          }
        }
      } catch (error) {
        if (!resolved) {
          rejectClarifyChallenge(
            challenger.id,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    })();

    try {
      const result = await waiting;
      resolved = true;
      await this.options.executionService.cancelAgentRun(challenger.id).catch(() => false);
      await run;
      const challenged = this.options.authorityStore.applyDecisionTreeChallenge({
        agentId: turn.agentId,
        sessionId: session.session.id,
        result,
      });
      if (result.decision === "blocked") {
        this.options.authorityStore.markLifecycle({
          agentId: turn.agentId,
          turnId: turn.id,
          generation: turn.generation,
          lifecycle: "interrupted",
          reason: "turn_interrupted",
          error: result.reason,
        });
        return;
      }
      if (result.decision === "reopen") {
        const reopened = this.options.authorityStore.reopenIntentContract(
          turn.agentId,
          challenged.session.id,
        );
        this.options.authorityStore.markLifecycle({
          agentId: turn.agentId,
          turnId: turn.id,
          generation: turn.generation,
          lifecycle: "mapping",
          reason: "decision_tree_changed",
          error: null,
        });
        await this.launchAuthorityContinuation(
          this.options.authorityStore.getTurn(turn.id) ?? turn,
        );
        if (reopened.session.intentContract) {
          throw new Error("Reopened Clarify session retained a superseded Intent Contract");
        }
        return;
      }
      const existing = this.options.authorityStore
        .listCardsForTurn(turn.id)
        .find((record) => record.kind === "intent_contract_card");
      if (existing) return;
      if (!challenged.session.intentContract) {
        throw new Error("Stable Clarify Challenger lost the proposed Intent Contract");
      }
      const card: ThothIntentContractCardModel = {
        id: `intent-contract-card-${randomUUID()}`,
        sessionId: challenged.session.id,
        contract: challenged.session.intentContract,
        provenanceSummary:
          "Grounded in the visible Decision Tree and one fresh independent challenge",
        turnControls: turn.controls,
        submitted: false,
      };
      this.options.authorityStore.openCard({
        agentId: turn.agentId,
        turnId: turn.id,
        generation: turn.generation,
        card: { kind: "intent_contract_card", card },
        runtime: {
          provider: sourceAgent.provider,
          threadId: challenger.persistence?.nativeHandle ?? challenger.id,
          providerTurnId: challenger.id,
          callId: `clarify-challenge-${challenger.id}`,
          toolName: "thoth_clarify_judge_contract",
          redactedRawInputHash: `sha256:${challenged.session.intentContract.id}`,
        },
      });
      await this.options.executionService.appendTimelineItem(turn.agentId, {
        type: "intent_contract_card",
        card,
      });
    } catch (error) {
      resolved = true;
      await this.options.executionService.cancelAgentRun(challenger.id).catch(() => false);
      await run;
      this.options.authorityStore.markLifecycle({
        agentId: turn.agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "interrupted",
        reason: "turn_interrupted",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async launchAuthorityContinuation(turn: ForegroundTurnAuthorityRecord): Promise<void> {
    const cards = this.options.authorityStore.listCardsForTurn(turn.id);
    const session = this.options.authorityStore.getDecisionTree(turn.agentId);
    if (!session || session.session.activeTurnId !== turn.id) {
      throw new Error("Foreground Thoth turn has no active Decision Session");
    }
    const key = continuationKey(cards, session);
    if (!key) {
      return;
    }
    const agent = await this.ensureRunnableAgent(turn);
    if (!agent) return;
    if (this.options.executionService.hasInFlightRun(agent.id)) {
      this.deferUntilProviderIdle(turn, () => this.launchAuthorityContinuation(turn));
      return;
    }
    if (
      !this.options.authorityStore.claimContinuation({
        turnId: turn.id,
        generation: turn.generation,
        key,
      })
    ) {
      this.options.authorityStore.markLifecycle({
        agentId: turn.agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "interrupted",
        reason: "turn_interrupted",
        error: "The provider ended without submitting the expected semantic authority card.",
      });
      return;
    }
    this.options.authorityStore.markLifecycle({
      agentId: turn.agentId,
      turnId: turn.id,
      generation: turn.generation,
      lifecycle: "running",
      reason: "turn_started",
      error: null,
    });
    const preparedTurn = await this.prepareProviderRunMode(
      this.options.authorityStore.getTurn(turn.id) ?? turn,
    );
    this.startProviderRun(
      preparedTurn,
      appendTextContext(
        buildThothAuthorityPrompt({ turn, cards, session }),
        this.options.taskContextBroker.renderTurn(turn.id),
      ),
      { replace: false, structured: true },
    );
  }

  private async launchQuickExecution(
    turn: ForegroundTurnAuthorityRecord,
    resume: boolean,
    taskId = turn.taskId,
  ): Promise<void> {
    if (!(await this.ensureRunnableAgent(turn))) return;
    if (this.options.executionService.hasInFlightRun(turn.agentId)) {
      this.deferUntilProviderIdle(turn, () => this.launchQuickExecution(turn, resume));
      return;
    }
    if (!taskId) throw new Error("Quick execution has no durable Task identity");
    if (!turn.runtimeAttachment) {
      throw new Error("Quick execution has no durable foreground RuntimeBundle receipt");
    }
    if (!this.activeQuickExecutions.has(turn.agentId)) {
      const executionId = `quick-execution-${turn.id}`;
      const execution = this.options.taskCoordinator.beginQuickExecution({
        workspaceId: turn.workspaceId,
        taskId,
        executionId,
        generation: turn.generation,
        attachment: turn.runtimeAttachment,
        runModeReceipt: turn.providerRunModeReceipt,
      });
      if (!execution) {
        this.waitForQuickMutation(turn, taskId, resume);
        return;
      }
      this.clearQuickWait(turn.agentId);
      const unregisterRuntime = this.options.taskCoordinator.runtimes.register({
        workspaceId: turn.workspaceId,
        taskId,
        generation: turn.generation,
        execution: {
          id: execution.id,
          threadId: turn.runtimeAttachment.threadId,
          nativeTurnId: null,
        },
        interrupt: async () => {
          await this.options.executionService.cancelAgentRun(turn.agentId);
        },
      });
      const heartbeat = setInterval(() => {
        const renewed = this.options.taskCoordinator.renewQuickExecution({
          workspaceId: turn.workspaceId,
          taskId,
          executionId,
          generation: turn.generation,
        });
        if (!renewed) {
          void this.options.executionService.cancelAgentRun(turn.agentId).catch(() => false);
          this.settleQuickExecution(
            turn.agentId,
            "failed",
            "Quick execution lost the Workspace mutation lease.",
          );
        }
      }, 10_000);
      heartbeat.unref();
      this.activeQuickExecutions.set(turn.agentId, {
        workspaceId: turn.workspaceId,
        taskId,
        executionId,
        generation: turn.generation,
        summary: "",
        heartbeat,
        unregisterRuntime,
      });
    }
    const cards = this.options.authorityStore.listCardsForTurn(turn.id);
    this.options.authorityStore.markLifecycle({
      agentId: turn.agentId,
      turnId: turn.id,
      generation: turn.generation,
      lifecycle: "quick_exec",
      reason: "quick_exec_started",
      error: null,
    });
    const preparedTurn = await this.prepareProviderRunMode(
      this.options.authorityStore.getTurn(turn.id) ?? turn,
    );
    this.startProviderRun(
      preparedTurn,
      appendTextContext(
        buildQuickExecutionPrompt({ turn, cards, resume }),
        this.options.taskContextBroker.renderTurn(turn.id),
      ),
      { replace: false, structured: false },
    );
  }

  private settleQuickExecution(
    agentId: string,
    status: "succeeded" | "failed",
    summary: string,
  ): void {
    this.clearQuickWait(agentId);
    const active = this.activeQuickExecutions.get(agentId);
    if (!active) return;
    this.activeQuickExecutions.delete(agentId);
    clearInterval(active.heartbeat);
    active.unregisterRuntime();
    try {
      this.options.taskCoordinator.settleQuickExecution({
        workspaceId: active.workspaceId,
        taskId: active.taskId,
        executionId: active.executionId,
        generation: active.generation,
        status,
        summary: summary.trim() || `Quick execution ${status}.`,
      });
    } catch (error) {
      this.options.logger.warn(
        { err: error, agentId, executionId: active.executionId },
        "Quick execution terminal event arrived after Task authority changed",
      );
    }
  }

  private waitForQuickMutation(
    turn: ForegroundTurnAuthorityRecord,
    taskId: string,
    resume: boolean,
  ): void {
    const existing = this.activeQuickWaits.get(turn.agentId);
    if (
      existing?.turnId === turn.id &&
      existing.generation === turn.generation &&
      existing.taskId === taskId
    ) {
      return;
    }
    this.clearQuickWait(turn.agentId);
    this.options.authorityStore.markLifecycle({
      agentId: turn.agentId,
      turnId: turn.id,
      generation: turn.generation,
      lifecycle: "quick_wait",
      reason: "quick_exec_waiting",
      error: null,
    });
    const token = randomUUID();
    const retry = (): void => {
      const waiting = this.activeQuickWaits.get(turn.agentId);
      if (!waiting || waiting.token !== token) return;
      this.clearQuickWait(turn.agentId);
      const current = this.options.authorityStore.getActiveTurn(turn.agentId);
      const task = this.options.taskCoordinator.get(turn.workspaceId, taskId).task;
      if (
        !current ||
        current.id !== turn.id ||
        current.generation !== turn.generation ||
        task?.mode !== "quick" ||
        task.status !== "queued"
      ) {
        return;
      }
      void this.launchQuickExecution(current, resume, taskId).catch((error: unknown) => {
        this.options.authorityStore.markLifecycle({
          agentId: current.agentId,
          turnId: current.id,
          generation: current.generation,
          lifecycle: "interrupted",
          reason: "turn_interrupted",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };
    const unsubscribe = this.options.taskCoordinator.subscribeQuickMutationReady(
      turn.workspaceId,
      retry,
    );
    const retryTimer = setTimeout(retry, 1_000);
    retryTimer.unref();
    this.activeQuickWaits.set(turn.agentId, {
      token,
      workspaceId: turn.workspaceId,
      taskId,
      turnId: turn.id,
      generation: turn.generation,
      unsubscribe,
      retryTimer,
    });
  }

  private clearQuickWait(agentId: string): void {
    const waiting = this.activeQuickWaits.get(agentId);
    if (!waiting) return;
    this.activeQuickWaits.delete(agentId);
    waiting.unsubscribe();
    clearTimeout(waiting.retryTimer);
  }

  private deferUntilProviderIdle(
    turn: ForegroundTurnAuthorityRecord,
    resume: () => Promise<void>,
  ): void {
    const token = randomUUID();
    this.deferredRunTokens.set(turn.agentId, token);
    const poll = (): void => {
      if (this.deferredRunTokens.get(turn.agentId) !== token) {
        return;
      }
      const current = this.options.authorityStore.getActiveTurn(turn.agentId);
      if (!current || current.id !== turn.id || current.generation !== turn.generation) {
        this.deferredRunTokens.delete(turn.agentId);
        return;
      }
      if (this.options.executionService.hasInFlightRun(turn.agentId)) {
        setTimeout(poll, 25).unref();
        return;
      }
      this.deferredRunTokens.delete(turn.agentId);
      void resume().catch((error) => {
        this.options.authorityStore.markLifecycle({
          agentId: turn.agentId,
          turnId: turn.id,
          generation: turn.generation,
          lifecycle: "interrupted",
          reason: "turn_interrupted",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };
    setTimeout(poll, 0).unref();
  }

  private async registerLoop(turn: ForegroundTurnAuthorityRecord): Promise<void> {
    try {
      const task = await this.registerApprovedTask(turn, "loop");
      this.options.authorityStore.markLifecycle({
        agentId: turn.agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "background_handoff",
        reason: "background_handoff",
        backgroundTaskId: task.id,
        error: null,
      });
      await this.options.executionService.appendTimelineItem(turn.agentId, {
        type: "assistant_message",
        text: BACKGROUND_HANDOFF_SUMMARY,
      });
      this.activeRunTokens.delete(turn.agentId);
      this.deferredRunTokens.delete(turn.agentId);
      this.options.toolGateway.endForegroundTurn({
        agentId: turn.agentId,
        generation: turn.generation,
      });
      await this.options.executionService.cancelAgentRun(turn.agentId).catch(() => false);
      void this.drainQueue(turn.agentId);
    } catch (error) {
      this.options.authorityStore.markLifecycle({
        agentId: turn.agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "interrupted",
        reason: "turn_interrupted",
        error: error instanceof Error ? error.message : String(error),
      });
      await this.options.executionService.cancelAgentRun(turn.agentId).catch(() => false);
      void this.drainQueue(turn.agentId);
    }
  }

  private async completeTaskClarifyHandoff(
    turn: ForegroundTurnAuthorityRecord,
    taskId: string,
  ): Promise<void> {
    let handoff = this.options.authorityStore.getTaskClarifyHandoff(turn.id);
    if (!handoff || handoff.taskId !== taskId || handoff.status === "canceled") {
      throw new Error("The Task Clarify handoff no longer owns its original Task revision.");
    }
    if (handoff.status === "active") {
      const session = this.options.authorityStore.getDecisionTree(turn.agentId);
      const decisions = this.options.authorityStore.listTurnDecisions(turn.id);
      if (
        !session?.session.intentContract ||
        session.session.intentContract.status !== "confirmed"
      ) {
        throw new Error("The Task Clarify handoff has no confirmed revised Intent Contract.");
      }
      this.options.taskCoordinator.commitClarifyContractRevision({
        taskWorkspaceId: handoff.taskWorkspaceId,
        taskId,
        sourceAgentWorkspaceId: turn.workspaceId,
        sourceAgentId: turn.agentId,
        decisionRequestId: handoff.decisionRequestId,
        contract: session.session.intentContract,
        decisionRecordIds: decisions.map((decision) => decision.id),
        commandId: `task-clarify-commit:${turn.id}:${handoff.decisionRequestId}`,
      });
      this.options.authorityStore.finishTaskClarifyHandoff(turn.id, "completed");
      handoff = this.options.authorityStore.getTaskClarifyHandoff(turn.id);
    }
    if (!handoff) throw new Error("The Task Clarify handoff disappeared after commit.");
    const task = this.options.taskCoordinator.get(handoff.taskWorkspaceId, taskId).task;
    if (handoff.status !== "completed" || !task) {
      throw new Error("The Task Clarify handoff did not commit its original Task revision.");
    }
    const state = this.options.authorityStore.getState(turn.agentId);
    const newlySettled =
      state.lifecycle !== "background_handoff" || state.backgroundTaskId !== task.id;
    if (newlySettled) {
      this.options.authorityStore.markLifecycle({
        agentId: turn.agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "background_handoff",
        reason: "background_handoff",
        backgroundTaskId: task.id,
        error: null,
      });
      await this.options.executionService.appendTimelineItem(turn.agentId, {
        type: "registered_task",
        task,
      });
      await this.options.executionService.appendTimelineItem(turn.agentId, {
        type: "assistant_message",
        text: BACKGROUND_REORIENTATION_SUMMARY,
      });
    }
    this.activeRunTokens.delete(turn.agentId);
    this.deferredRunTokens.delete(turn.agentId);
    this.options.toolGateway.endForegroundTurn({
      agentId: turn.agentId,
      generation: turn.generation,
    });
    await this.options.executionService.cancelAgentRun(turn.agentId).catch(() => false);
    void this.options.taskCoordinator
      .continueAfterContractRevision({ workspaceId: task.workspaceId, taskId: task.id })
      .catch((error: unknown) => {
        this.options.logger.error(
          { err: error, workspaceId: task.workspaceId, taskId: task.id },
          "Failed to schedule fresh Task reorientation after Clarify",
        );
      });
    void this.drainQueue(turn.agentId);
  }

  private async registerApprovedTask(turn: ForegroundTurnAuthorityRecord, mode: "quick" | "loop") {
    const cards = this.options.authorityStore.listCardsForTurn(turn.id);
    const contractCard = cards
      .filter((card) => card.kind === "intent_contract_card" && card.status === "answered")
      .at(-1)?.card as ThothIntentContractCardModel | undefined;
    if (!contractCard || !turn.controls) {
      throw new Error("Task registration requires one approved Intent Contract.");
    }
    const clarifySession = this.options.authorityStore.getDecisionTree(turn.agentId);
    if (
      clarifySession?.session.id !== contractCard.sessionId ||
      clarifySession.session.intentContract?.status !== "confirmed"
    ) {
      throw new Error("Task registration requires the confirmed Intent Contract authority.");
    }
    const agent = await ensureAgentLoaded(turn.agentId, {
      executionService: this.options.executionService,
      agentStorage: this.options.agentStorage,
      logger: this.options.logger,
    });
    const registration = this.options.taskCoordinator.register({
      workspaceId: turn.workspaceId,
      sourceAgentId: turn.agentId,
      sourceTurnId: turn.id,
      sourceContractCardId: contractCard.id,
      mode,
      loopStrength: mode === "loop" ? (turn.controls.loop ?? "one_plan_one_do") : null,
      intentContract: clarifySession.session.intentContract,
      providerProfile: {
        adapterId: agent.config.provider,
        config: {
          provider: agent.config.provider,
          ...(agent.config.model ? { model: agent.config.model } : {}),
          ...(agent.config.modeId ? { modeId: agent.config.modeId } : {}),
          ...(agent.config.thinkingOptionId
            ? { thinkingOptionId: agent.config.thinkingOptionId }
            : {}),
          ...(agent.config.featureValues ? { featureValues: agent.config.featureValues } : {}),
        },
      },
    });
    this.options.authorityStore.bindTask({
      agentId: turn.agentId,
      turnId: turn.id,
      generation: turn.generation,
      taskId: registration.task.id,
    });
    if (registration.created) {
      await this.options.executionService.appendTimelineItem(turn.agentId, {
        type: "registered_task",
        task: registration.task,
      });
    }
    return registration.task;
  }

  private async recover(agentId: string): Promise<void> {
    const state = this.options.authorityStore.getState(agentId);
    const turn = this.options.authorityStore.getActiveTurn(agentId);
    if (!turn) {
      await this.drainQueue(agentId);
      return;
    }
    if (
      ["idle", "done", "canceled", "unsupported", "background_handoff"].includes(state.lifecycle)
    ) {
      await this.drainQueue(agentId);
      return;
    }
    if (state.lifecycle === "awaiting_card" || state.lifecycle === "background_handoff") {
      return;
    }
    if (state.lifecycle === "quick_wait" && turn.taskId) {
      await this.launchQuickExecution(turn, true, turn.taskId);
      return;
    }
    if (state.lifecycle === "quick_exec" && !this.activeQuickExecutions.has(agentId)) {
      this.options.authorityStore.markLifecycle({
        agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "interrupted",
        reason: "turn_interrupted",
        error:
          "Quick execution was interrupted by daemon restart and was not replayed automatically.",
      });
      return;
    }
    if (this.options.executionService.hasInFlightRun(agentId)) {
      return;
    }
    if (turn.providerInteraction?.phase === "awaiting_provider_question") {
      const expired = reduceProviderTurnInteraction(turn.providerInteraction, {
        type: "question_resolved",
        providerThreadId: turn.providerInteraction.providerThreadId,
        providerTurnId: turn.providerInteraction.providerTurnId,
        interactionId: turn.providerInteraction.pendingQuestionId!,
        resolution: "expired",
      });
      this.options.authorityStore.recordProviderInteraction({
        agentId,
        turnId: turn.id,
        generation: turn.generation,
        expectedRevision: turn.providerInteractionRevision,
        interaction: expired.state,
      });
      this.options.authorityStore.markLifecycle({
        agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "interrupted",
        reason: "turn_interrupted",
        error:
          "The live Provider question handler was lost during restart; rerun the native Plan turn.",
      });
      return;
    }
    if (
      state.lifecycle === "awaiting_implementation" &&
      turn.providerInteraction?.phase === "awaiting_implementation" &&
      turn.providerPlanReceipt
    ) {
      await this.options.executionService.openDaemonPlanApproval({
        agentId,
        turnId: turn.id,
        generation: turn.generation,
        plan: turn.providerPlanReceipt,
      });
      return;
    }
    const cards = this.options.authorityStore.listCardsForTurn(turn.id);
    const taskClarifyHandoff = this.options.authorityStore.getTaskClarifyHandoff(turn.id);
    if (taskClarifyHandoff && taskClarifyHandoff.status !== "canceled") {
      await this.completeTaskClarifyHandoff(turn, taskClarifyHandoff.taskId);
      return;
    }
    const contract = cards
      .filter((card) => card.kind === "intent_contract_card" && card.status === "answered")
      .at(-1);
    if (contract && turn.controls?.mode === "loop" && !state.backgroundTaskId) {
      const answer = contract.answer;
      if (answer?.intent === "accept_loop") {
        await this.registerLoop(turn);
      }
      return;
    }
    const session = this.options.authorityStore.getDecisionTree(agentId);
    if (session?.session.intentContract && !session.session.challengerUsed) {
      await this.launchClarifyChallenger(turn, session);
      return;
    }
    if (
      turn.kind === "thoth" &&
      ["interrupted", "running", "mapping", "challenging", "proposing"].includes(state.lifecycle)
    ) {
      await this.launchAuthorityContinuation(turn);
    }
  }

  private async ensureRunnableAgent(
    turn: ForegroundTurnAuthorityRecord,
  ): Promise<Awaited<ReturnType<typeof ensureAgentLoaded>> | null> {
    try {
      const agent = await ensureAgentLoaded(turn.agentId, {
        executionService: this.options.executionService,
        agentStorage: this.options.agentStorage,
        logger: this.options.logger,
      });
      if (this.options.executionService.hasRunnableSession(turn.agentId)) {
        return agent;
      }
      this.options.authorityStore.markLifecycle({
        agentId: turn.agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "interrupted",
        reason: "turn_interrupted",
        error: "The provider thread is unavailable; the committed decision is safe to resume.",
      });
      return null;
    } catch (error) {
      this.options.authorityStore.markLifecycle({
        agentId: turn.agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "interrupted",
        reason: "turn_interrupted",
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async prepareProviderRunMode(
    turn: ForegroundTurnAuthorityRecord,
  ): Promise<ForegroundTurnAuthorityRecord> {
    if (turn.providerRunModeReceipt) {
      return turn;
    }
    const result = await this.options.executionService.prepareAgentRunMode(
      turn.agentId,
      turn.providerRunMode,
    );
    const failure =
      turn.providerRunMode === "plan" && result.capability.kind !== "native"
        ? result.capability
        : null;
    const receipt: ProviderRunModeReceipt = {
      id: `foreground-mode-${randomUUID()}`,
      requestedMode: turn.providerRunMode,
      status: failure ? failure.kind : "applied",
      nativeModeId: result.nativeModeId,
      reason: failure?.reason ?? null,
      appliedAt: new Date().toISOString(),
    };
    const updated = this.options.authorityStore.recordRunModeReceipt({
      agentId: turn.agentId,
      turnId: turn.id,
      generation: turn.generation,
      receipt,
    });
    if (failure) {
      this.options.authorityStore.markLifecycle({
        agentId: turn.agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "unsupported",
        reason: "turn_interrupted",
        error: failure.reason,
      });
      throw new Error(failure.reason);
    }
    return updated;
  }
}
