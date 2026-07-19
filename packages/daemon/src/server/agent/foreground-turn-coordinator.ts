import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Logger } from "pino";
import type { AgentAttachment, ThothTurnAck, ThothTurnSnapshot } from "@thoth/protocol/messages";
import type {
  AgentThothCardAnswerRequest,
  AgentThothCardAnswerResponse,
  AgentThothState,
  ThothApprovalGoalCardModel,
  ThothCardAnswerPayload,
  ThothClarifyCardModel,
  ThothGoalsCardModel,
  ThothTaskCardModel,
  ThothTurnControlSnapshot,
} from "@thoth/protocol/thoth/rpc-schemas";
import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import type { AgentPromptInput, AgentRunOptions, AgentStreamEvent } from "./agent-sdk-types.js";
import { ensureAgentLoaded } from "./agent-loading.js";
import { formatSystemNotificationPrompt } from "./agent-prompt.js";
import { readThothRuntimeToolsConfig } from "./thoth-runtime-tools-config.js";
import {
  type ForegroundAuthorityCard,
  type ForegroundCardAuthorityRecord,
  type ForegroundTurnAuthorityRecord,
  ForegroundAuthorityStore,
} from "./foreground-authority-store.js";
import {
  beginForegroundTurnFence,
  bindForegroundProviderTurn,
  endForegroundTurnFence,
} from "./tools/foreground-turn-fence.js";
import type { ThothLoopTaskService } from "../thoth-loop/task-service.js";

const USER_CANCELED_SUMMARY = "已中断当前请求，可继续输入。";
const BACKGROUND_HANDOFF_SUMMARY = "后台任务已注册；前台会话可以继续新的对话。";

interface StartForegroundTurnInput {
  agentId: string;
  workspaceId?: string;
  workspacePath: string;
  text: string;
  messageId?: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: AgentAttachment[];
  thoth?: ThothTurnSnapshot;
  rawPrompt: AgentPromptInput;
  rawRunOptions?: AgentRunOptions;
}

interface ForegroundTurnCoordinatorOptions {
  authorityStore: ForegroundAuthorityStore;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  loopTaskService: ThothLoopTaskService | null;
  logger: Logger;
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

function summarizeAnswer(answer: ThothCardAnswerPayload): string {
  if ("answers" in answer) {
    const choices = answer.answers.flatMap((entry) => entry.choice_ids);
    return answer.note?.trim() || choices.join("、") || answer.raw_answer;
  }
  return answer.note?.trim() || answer.raw_answer;
}

interface NormalizedClarifyQuestion {
  id: string;
  title: string;
  selectionMode: "single" | "multiple";
  choices: Array<{ id: string; label: string }>;
}

function getClarifyQuestions(card: ThothClarifyCardModel): NormalizedClarifyQuestion[] {
  const questionCard = card.card;
  if ("questions" in questionCard) {
    return questionCard.questions.map((question) => ({
      id: question.id,
      title: question.question,
      selectionMode: question.selection_mode,
      choices: question.choices,
    }));
  }
  return [
    {
      id: questionCard.question_id,
      title: questionCard.question,
      selectionMode: "single",
      choices: questionCard.choices,
    },
  ];
}

function validateClarifyAnswer(
  card: ThothClarifyCardModel,
  answer: ThothCardAnswerPayload,
): string | null {
  if (!("answers" in answer)) {
    return "Clarify Card requires a Clarify answer payload.";
  }
  if (answer.question_card_id !== card.id) {
    return "The answer does not belong to this Clarify Card.";
  }
  if (answer.intent === "stop") {
    return null;
  }
  const byId = new Map(answer.answers.map((entry) => [entry.question_id, entry]));
  for (const question of getClarifyQuestions(card)) {
    const entry = byId.get(question.id);
    if (!entry && answer.intent !== "note_only") {
      return `Question ${question.title} is unanswered.`;
    }
    if (!entry) {
      continue;
    }
    const choiceIds = new Set(question.choices.map((choice) => choice.id));
    if (entry.choice_ids.some((choiceId) => !choiceIds.has(choiceId))) {
      return `Question ${question.title} contains an unknown choice.`;
    }
    if (question.selectionMode === "single" && entry.choice_ids.length > 1) {
      return `Question ${question.title} accepts one choice.`;
    }
  }
  return null;
}

function validateApprovalAnswer(input: {
  card: ThothTaskCardModel | ThothApprovalGoalCardModel;
  answer: ThothCardAnswerPayload;
  controls: ThothTurnControlSnapshot;
}): string | null {
  if (!("card_id" in input.answer)) {
    return "This approval card requires an approval answer payload.";
  }
  if (input.answer.card_id !== input.card.id) {
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
      questionId: entry.question_id,
      choiceIds: entry.choice_ids,
      choiceNotes: entry.choice_notes,
      ...(entry.note ? { note: entry.note } : {}),
    })),
    ...(answer.note ? { submittedNote: answer.note } : {}),
  };
}

function renderClarifyCard(card: ThothClarifyCardModel): string {
  const answers = card.submittedAnswers ?? [];
  return [
    `Clarification: ${card.title}`,
    card.whyNow,
    ...getClarifyQuestions(card).map((question) => {
      const answer = answers.find((entry) => entry.questionId === question.id);
      const selected = question.choices
        .filter((choice) => answer?.choiceIds.includes(choice.id))
        .map((choice) => choice.label);
      return `${question.title}: ${selected.join("、") || answer?.note || "not answered"}`;
    }),
    card.submittedNote ? `User note: ${card.submittedNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderTaskCard(card: ThothTaskCardModel): string {
  return [
    card.title,
    `Goal: ${card.goal}`,
    `Constraints: ${card.constraints.join("; ")}`,
    `Acceptance: ${card.acceptance.join("; ")}`,
    card.submittedSummary ? `User decision: ${card.submittedSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderGoalsCard(card: ThothApprovalGoalCardModel): string {
  if (!("goals" in card)) {
    return [card.title, card.summary, card.submittedSummary ?? ""].filter(Boolean).join("\n");
  }
  return [
    card.title,
    card.summary,
    ...card.goals
      .slice()
      .sort((left, right) => left.order - right.order)
      .map(
        (goal) =>
          `${goal.order}. ${goal.title}\n${goal.goal}\nConstraints: ${goal.constraints.join("; ")}\nAcceptance: ${goal.acceptance.join("; ")}`,
      ),
    card.submittedSummary ? `User decision: ${card.submittedSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function renderTaskTruth(input: {
  turn: ForegroundTurnAuthorityRecord;
  cards: ForegroundCardAuthorityRecord[];
}): string {
  return [
    `User request:\n${input.turn.userText}`,
    ...input.cards.map((record) => {
      if (record.kind === "clarify_card") {
        return renderClarifyCard(record.card as ThothClarifyCardModel);
      }
      if (record.kind === "task_card") {
        return `Approved Task Card:\n${renderTaskCard(record.card as ThothTaskCardModel)}`;
      }
      return `Approved Goals Card:\n${renderGoalsCard(record.card as ThothApprovalGoalCardModel)}`;
    }),
  ].join("\n\n");
}

function nextSemanticDirection(cards: ForegroundCardAuthorityRecord[]): string {
  const latestGoal = cards.filter((card) => card.kind === "goal_card").at(-1);
  if (latestGoal?.status === "answered") {
    return "The approved work is being handed off. Do not create another authority card.";
  }
  const latestTask = cards.filter((card) => card.kind === "task_card").at(-1);
  if (latestTask?.status === "answered") {
    return "The user approved the Task Card. Submit the Goals Card grounded in that understanding.";
  }
  const latestClarify = cards.filter((card) => card.kind === "clarify_card").at(-1);
  if (latestClarify?.status === "answered") {
    const card = latestClarify.card as ThothClarifyCardModel;
    return card.frontierLedger?.convergence_state === "ready_for_task"
      ? "The clarified intent is ready. Synthesize the concise Task Card now."
      : "Continue co-thinking from the user's answer. Ask the next highest-leverage decision, or synthesize the Task Card only when the intent is genuinely ready.";
  }
  return "Begin by understanding and expanding the user's intent as a thoughtful expert partner. Submit the highest-leverage Clarify Card, or a Task Card only when the request is already genuinely complete.";
}

function buildThothAuthorityPrompt(input: {
  turn: ForegroundTurnAuthorityRecord;
  cards: ForegroundCardAuthorityRecord[];
}): string {
  const controls = input.turn.controls;
  if (!controls) {
    throw new Error("The active Thoth turn is missing its frozen controls.");
  }
  return formatSystemNotificationPrompt(
    [
      "Follow the installed thoth.clarify skill in this visible Agent conversation.",
      `The user selected ${controls.mode === "loop" ? "background Loop" : "foreground Quick"} execution and ${controls.clarifyStrength} clarification.`,
      "Treat the conversation and workspace as reality. Think with the user, investigate discoverable facts yourself, and use a Thoth semantic authority card for the next user-owned decision.",
      "Do not expose internal tools, schemas, state, ids, budgets, receipts, or recovery mechanics.",
      nextSemanticDirection(input.cards),
      renderTaskTruth(input),
    ].join("\n\n"),
  );
}

function buildQuickExecutionPrompt(input: {
  turn: ForegroundTurnAuthorityRecord;
  cards: ForegroundCardAuthorityRecord[];
  resume: boolean;
}): string {
  const task = input.cards.filter((card) => card.kind === "task_card").at(-1);
  const goals = input.cards.filter((card) => card.kind === "goal_card").at(-1);
  if (!task || !goals) {
    throw new Error("Quick execution requires an approved Task Card and Goals Card.");
  }
  return formatSystemNotificationPrompt(
    [
      "Execute the complete approved task now in this same visible Agent conversation.",
      "Do not ask further clarification questions and do not call Thoth authority tools.",
      input.resume
        ? "Inspect the current workspace first, preserve completed work, and continue from the earliest unfinished approved goal."
        : "State a concise plan, then execute every approved goal in order. Do not stop after the first goal.",
      "Use normal provider tools to inspect, edit, test, and verify. Finish with evidence against the approved goals and name any real blocker plainly.",
      renderTaskTruth(input),
    ].join("\n\n"),
  );
}

function continuationKey(cards: ForegroundCardAuthorityRecord[]): string | null {
  const latestGoal = cards.filter((card) => card.kind === "goal_card").at(-1);
  if (latestGoal?.status === "answered") {
    return null;
  }
  const latestTask = cards.filter((card) => card.kind === "task_card").at(-1);
  if (latestTask?.status === "answered") {
    return `goals-after-${latestTask.id}`;
  }
  const latestClarify = cards.filter((card) => card.kind === "clarify_card").at(-1);
  if (latestClarify?.status === "answered") {
    return `clarify-after-${latestClarify.id}`;
  }
  return "first-authority-card";
}

export class ForegroundTurnCoordinator {
  private readonly activeRunTokens = new Map<string, string>();
  private readonly deferredRunTokens = new Map<string, string>();

  constructor(private readonly options: ForegroundTurnCoordinatorOptions) {}

  async startTurn(input: StartForegroundTurnInput): Promise<ThothTurnAck> {
    const agent = await ensureAgentLoaded(input.agentId, {
      agentManager: this.options.agentManager,
      agentStorage: this.options.agentStorage,
      logger: this.options.logger,
    });
    if (agent.internal === true) {
      throw new Error("Internal agents cannot own foreground Thoth turns.");
    }
    if (this.options.agentManager.hasInFlightRun(agent.id)) {
      throw new Error(`Agent ${agent.id} already has an active run`);
    }
    const kind = input.thoth?.enabled === true ? "thoth" : "raw";
    const started = this.options.authorityStore.startTurn({
      agentId: agent.id,
      kind,
      ...(input.thoth?.enabled === true ? { controls: toControls(input.thoth) } : {}),
      ...(input.messageId ? { sourceMessageId: input.messageId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      workspacePath: input.workspacePath,
      userText: input.text,
    });
    if (!started.created) {
      return {
        turnKind: started.turn.kind,
        turnId: started.turn.id,
        authorityRevision: started.state.revision,
      };
    }

    if (kind === "thoth") {
      const capabilities = this.options.agentManager.getProviderCapabilities(agent.provider);
      const runtime = readThothRuntimeToolsConfig(agent.config);
      if (capabilities?.supportsNativeThothTools !== true || runtime?.scope !== "clarify") {
        const state = this.options.authorityStore.markLifecycle({
          agentId: agent.id,
          turnId: started.turn.id,
          generation: started.turn.generation,
          lifecycle: "unsupported",
          reason: "turn_interrupted",
          error:
            "The selected provider session does not support Agent-scoped Thoth semantic tools.",
        });
        throw new Error(
          state?.error ??
            "The selected provider session does not support Agent-scoped Thoth semantic tools.",
        );
      }
      if (input.messageId) {
        await this.options.agentManager.appendTimelineItem(agent.id, {
          type: "user_message",
          text: input.text,
          messageId: input.messageId,
        });
      }
      const prompt = withPromptAttachments({
        text: buildThothAuthorityPrompt({ turn: started.turn, cards: [] }),
        images: input.images,
        attachments: input.attachments,
      });
      this.startProviderRun(started.turn, prompt, { replace: false, structured: true });
    } else {
      this.startProviderRun(started.turn, input.rawPrompt, {
        replace: false,
        structured: false,
        runOptions: input.rawRunOptions,
      });
    }

    return {
      turnKind: kind,
      turnId: started.turn.id,
      authorityRevision: started.state.revision,
    };
  }

  async getState(agentId: string): Promise<AgentThothState> {
    await this.recover(agentId);
    return this.options.authorityStore.getState(agentId);
  }

  async answerCard(
    request: AgentThothCardAnswerRequest,
  ): Promise<AgentThothCardAnswerResponse["payload"]> {
    const record = this.options.authorityStore.getCard(request.cardId);
    const turn = record ? this.options.authorityStore.getTurn(record.turnId) : null;
    if (!record || !turn || record.agentId !== request.agentId || !turn.controls) {
      return {
        requestId: request.requestId,
        accepted: false,
        conflict: false,
        state: this.options.authorityStore.getState(request.agentId),
        error: "The authority card does not belong to this Agent.",
      };
    }
    const validationError =
      record.kind === "clarify_card"
        ? validateClarifyAnswer(record.card as ThothClarifyCardModel, request.answer)
        : validateApprovalAnswer({
            card: record.card as ThothTaskCardModel | ThothApprovalGoalCardModel,
            answer: request.answer,
            controls: turn.controls,
          });
    if (validationError) {
      return {
        requestId: request.requestId,
        accepted: false,
        conflict: false,
        state: this.options.authorityStore.getState(request.agentId),
        error: validationError,
      };
    }

    const summary = summarizeAnswer(request.answer);
    const cancelRequested = request.answer.intent === "cancel" || request.answer.intent === "stop";
    const quickApproved = record.kind === "goal_card" && request.answer.intent === "accept_quick";
    const result = this.options.authorityStore.answerCard({
      agentId: request.agentId,
      cardId: request.cardId,
      answer: request.answer,
      submittedCard: submitCard(record, request.answer, summary),
      submittedSummary: summary,
      expectedRevision: request.expectedRevision,
      commandId: request.commandId,
      nextLifecycle: cancelRequested ? "canceled" : quickApproved ? "quick_exec" : "running",
    });
    if (!result.accepted) {
      return {
        requestId: request.requestId,
        accepted: false,
        conflict: result.conflict,
        state: result.state,
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
        error: null,
      };
    }

    if (cancelRequested) {
      await this.appendSubmittedCard(request.agentId, result.card);
      await this.options.agentManager.cancelAgentRun(request.agentId).catch(() => false);
    } else if (record.kind === "goal_card" && request.answer.intent === "accept_loop") {
      await this.registerLoop(turn, request.answer);
    } else {
      await this.appendSubmittedCard(request.agentId, result.card);
      if (quickApproved) {
        await this.launchQuickExecution(turn, true);
      } else {
        await this.launchAuthorityContinuation(turn);
      }
    }

    return {
      requestId: request.requestId,
      accepted: true,
      conflict: false,
      state: this.options.authorityStore.getState(request.agentId),
      error: null,
    };
  }

  async cancel(agentId: string): Promise<AgentThothState> {
    await ensureAgentLoaded(agentId, {
      agentManager: this.options.agentManager,
      agentStorage: this.options.agentStorage,
      logger: this.options.logger,
    });
    const turn = this.options.authorityStore.getActiveTurn(agentId);
    const canceled = this.options.authorityStore.cancelActiveTurn({
      agentId,
      submittedSummary: USER_CANCELED_SUMMARY,
    });
    for (const card of canceled.pendingCards) {
      await this.appendSubmittedCard(agentId, {
        ...card,
        card: { ...card.card, submitted: true, submittedSummary: USER_CANCELED_SUMMARY },
      });
    }
    if (turn) {
      endForegroundTurnFence({ agentId, generation: turn.generation });
    }
    this.activeRunTokens.delete(agentId);
    this.deferredRunTokens.delete(agentId);
    await this.options.agentManager.cancelAgentRun(agentId).catch(() => false);
    return this.options.authorityStore.getState(agentId);
  }

  private startProviderRun(
    turn: ForegroundTurnAuthorityRecord,
    prompt: AgentPromptInput,
    input: { replace: boolean; structured: boolean; runOptions?: AgentRunOptions },
  ): void {
    const token = randomUUID();
    this.activeRunTokens.set(turn.agentId, token);
    beginForegroundTurnFence({
      agentId: turn.agentId,
      generation: turn.generation,
      kind: input.structured ? "thoth_clarify" : "raw_provider",
      foregroundTurnId: turn.id,
    });
    const events =
      input.replace && this.options.agentManager.hasInFlightRun(turn.agentId)
        ? this.options.agentManager.replaceAgentRun(turn.agentId, prompt, input.runOptions)
        : this.options.agentManager.streamAgent(turn.agentId, prompt, input.runOptions);
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
          if (providerTurnId) {
            bindForegroundProviderTurn({
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
        }
        if (
          event.type !== "turn_completed" &&
          event.type !== "turn_failed" &&
          event.type !== "turn_canceled"
        ) {
          continue;
        }
        this.activeRunTokens.delete(input.turn.agentId);
        endForegroundTurnFence({
          agentId: input.turn.agentId,
          generation: input.turn.generation,
        });
        const state = this.options.authorityStore.getState(input.turn.agentId);
        if (
          state.lifecycle === "awaiting_card" ||
          state.lifecycle === "background_handoff" ||
          state.lifecycle === "canceled"
        ) {
          return;
        }
        if (event.type === "turn_failed" || event.type === "turn_canceled") {
          this.options.authorityStore.markLifecycle({
            agentId: input.turn.agentId,
            turnId: input.turn.id,
            generation: input.turn.generation,
            lifecycle: "interrupted",
            reason: "turn_interrupted",
            error:
              event.type === "turn_failed" ? event.error : event.reason || "Provider turn canceled",
          });
          return;
        }
        if (!input.structured || state.lifecycle === "quick_exec") {
          this.options.authorityStore.markLifecycle({
            agentId: input.turn.agentId,
            turnId: input.turn.id,
            generation: input.turn.generation,
            lifecycle: "done",
            reason: "turn_completed",
            error: null,
          });
          return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        await this.launchAuthorityContinuation(input.turn);
        return;
      }
    } catch (error) {
      if (this.activeRunTokens.get(input.turn.agentId) !== input.token) {
        return;
      }
      this.activeRunTokens.delete(input.turn.agentId);
      endForegroundTurnFence({
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
    }
  }

  private async launchAuthorityContinuation(turn: ForegroundTurnAuthorityRecord): Promise<void> {
    const cards = this.options.authorityStore.listCardsForTurn(turn.id);
    const key = continuationKey(cards);
    if (!key) {
      return;
    }
    const agent = await ensureAgentLoaded(turn.agentId, {
      agentManager: this.options.agentManager,
      agentStorage: this.options.agentStorage,
      logger: this.options.logger,
    });
    if (this.options.agentManager.hasInFlightRun(agent.id)) {
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
    this.startProviderRun(
      this.options.authorityStore.getTurn(turn.id) ?? turn,
      buildThothAuthorityPrompt({ turn, cards }),
      { replace: false, structured: true },
    );
  }

  private async launchQuickExecution(
    turn: ForegroundTurnAuthorityRecord,
    resume: boolean,
  ): Promise<void> {
    if (this.options.agentManager.hasInFlightRun(turn.agentId)) {
      this.deferUntilProviderIdle(turn, () => this.launchQuickExecution(turn, resume));
      return;
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
    this.startProviderRun(
      this.options.authorityStore.getTurn(turn.id) ?? turn,
      buildQuickExecutionPrompt({ turn, cards, resume }),
      { replace: false, structured: false },
    );
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
      if (this.options.agentManager.hasInFlightRun(turn.agentId)) {
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

  private async registerLoop(
    turn: ForegroundTurnAuthorityRecord,
    answer: ThothCardAnswerPayload,
  ): Promise<void> {
    try {
      if (!this.options.loopTaskService) {
        throw new Error("Thoth Loop background task service is unavailable.");
      }
      const cards = this.options.authorityStore.listCardsForTurn(turn.id);
      const taskCard = cards.filter((card) => card.kind === "task_card").at(-1)?.card as
        | ThothTaskCardModel
        | undefined;
      const goalsCard = cards.filter((card) => card.kind === "goal_card").at(-1)?.card as
        | ThothApprovalGoalCardModel
        | undefined;
      if (!taskCard || !goalsCard || !("goals" in goalsCard) || !turn.controls) {
        throw new Error("Loop registration requires approved Task and linear Goals cards.");
      }
      const agent = await ensureAgentLoaded(turn.agentId, {
        agentManager: this.options.agentManager,
        agentStorage: this.options.agentStorage,
        logger: this.options.logger,
      });
      const loopTask = await this.options.loopTaskService.register({
        workspaceName: path.basename(turn.workspacePath),
        workspacePath: turn.workspacePath,
        sourceAgentId: turn.agentId,
        taskCard,
        goalsCard: goalsCard as ThothGoalsCardModel,
        clarifyTranscript: renderTaskTruth({ turn, cards }),
        loopStrength: turn.controls.loop ?? "one_plan_one_do",
        provider: {
          provider: agent.config.provider,
          ...(agent.config.model ? { model: agent.config.model } : {}),
          ...(agent.config.modeId ? { modeId: agent.config.modeId } : {}),
          ...(agent.config.thinkingOptionId
            ? { thinkingOptionId: agent.config.thinkingOptionId }
            : {}),
          ...(agent.config.featureValues ? { featureValues: agent.config.featureValues } : {}),
        },
      });
      const registeredTask = {
        id: loopTask.id,
        title: loopTask.title,
        workspaceName: loopTask.workspaceName,
        workspacePath: loopTask.workspacePath,
        sourceAgentId: turn.agentId,
        status: "queued",
        summary: loopTask.summary,
        taskCard,
        goalCard: goalsCard,
        ...(loopTask.goals.find((goal) => goal.id === loopTask.currentGoalId)?.title
          ? {
              currentGoalTitle: loopTask.goals.find((goal) => goal.id === loopTask.currentGoalId)!
                .title,
            }
          : {}),
      } as const;
      await this.options.agentManager.appendTimelineItem(turn.agentId, {
        type: "registered_task",
        task: registeredTask,
      });
      this.options.authorityStore.markLifecycle({
        agentId: turn.agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "background_handoff",
        reason: "background_handoff",
        backgroundTaskId: loopTask.id,
        error: null,
      });
      const goalCard = this.options.authorityStore.getCard((answer as { card_id: string }).card_id);
      await this.appendSubmittedCard(turn.agentId, goalCard);
      await this.options.agentManager.appendTimelineItem(turn.agentId, {
        type: "assistant_message",
        text: BACKGROUND_HANDOFF_SUMMARY,
      });
      this.activeRunTokens.delete(turn.agentId);
      this.deferredRunTokens.delete(turn.agentId);
      endForegroundTurnFence({ agentId: turn.agentId, generation: turn.generation });
      await this.options.agentManager.cancelAgentRun(turn.agentId).catch(() => false);
    } catch (error) {
      this.options.authorityStore.markLifecycle({
        agentId: turn.agentId,
        turnId: turn.id,
        generation: turn.generation,
        lifecycle: "interrupted",
        reason: "turn_interrupted",
        error: error instanceof Error ? error.message : String(error),
      });
      await this.options.agentManager.cancelAgentRun(turn.agentId).catch(() => false);
    }
  }

  private async recover(agentId: string): Promise<void> {
    const state = this.options.authorityStore.getState(agentId);
    const turn = this.options.authorityStore.getActiveTurn(agentId);
    if (!turn || state.lifecycle === "awaiting_card" || state.lifecycle === "background_handoff") {
      return;
    }
    if (this.options.agentManager.hasInFlightRun(agentId)) {
      return;
    }
    const cards = this.options.authorityStore.listCardsForTurn(turn.id);
    const goal = cards
      .filter((card) => card.kind === "goal_card" && card.status === "answered")
      .at(-1);
    if (goal && turn.controls?.mode === "loop" && !state.backgroundTaskId) {
      const answer = goal.answer;
      if (answer?.intent === "accept_loop") {
        await this.registerLoop(turn, answer);
      }
      return;
    }
    if (goal && turn.controls?.mode === "quick" && state.lifecycle === "interrupted") {
      await this.launchQuickExecution(turn, true);
      return;
    }
    if (state.lifecycle === "interrupted" || state.lifecycle === "running") {
      await this.launchAuthorityContinuation(turn);
    }
  }

  private async appendSubmittedCard(
    agentId: string,
    record: ForegroundCardAuthorityRecord | null,
  ): Promise<void> {
    if (!record) {
      return;
    }
    if (record.kind === "clarify_card") {
      await this.options.agentManager.appendTimelineItem(agentId, {
        type: "clarify_card",
        card: record.card as ThothClarifyCardModel,
      });
    } else if (record.kind === "task_card") {
      await this.options.agentManager.appendTimelineItem(agentId, {
        type: "task_card",
        card: record.card as ThothTaskCardModel,
      });
    } else {
      await this.options.agentManager.appendTimelineItem(agentId, {
        type: "goal_card",
        card: record.card as ThothApprovalGoalCardModel,
      });
    }
  }
}
