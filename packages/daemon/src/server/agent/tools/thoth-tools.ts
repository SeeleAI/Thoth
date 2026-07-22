import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ensureValidJson } from "../../json-utils.js";
import type { Logger } from "pino";

import type { AgentMode, AgentProvider, AgentTimelineItem } from "@thoth/drivers/agent-runtime";
import type { AgentManager, WaitForAgentResult } from "../agent-manager.js";
import {
  AgentFeatureSchema,
  AgentPermissionRequestPayloadSchema,
  AgentListItemPayloadSchema,
  AgentPermissionResponseSchema,
  AgentSnapshotPayloadSchema,
} from "../../messages.js";
import type { AgentListItemPayload } from "../../messages.js";
import {
  buildStoredAgentPayload,
  toAgentListItemPayload,
  toAgentPayload,
} from "../agent-projections.js";
import { curateAgentActivity } from "@thoth/drivers/internal/server/agent/activity-curator";
import { selectItemsByProjectedLimit } from "@thoth/drivers/internal/server/agent/timeline-projection";
import type { AgentRegistry } from "../agent-storage.js";
import { ensureAgentLoaded } from "../agent-loading.js";
import { isStoredAgentProviderAvailable } from "../../persistence-hooks.js";
import {
  killTerminalsForWorkspace,
  type ArchiveDependencies,
} from "../../workspace-archive-service.js";
import { WaitForAgentTracker } from "../wait-for-agent-tracker.js";
import { createAgentCommand, type CreateAgentFromMcpInput } from "../create-agent/create.js";
import { expandUserPath, isSameOrDescendantPath, resolvePathFromBase } from "../../path-utils.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { CreateThothWorktreeWorkflowFn } from "../../worktree-session.js";
import type { ScheduleService } from "../../schedule/service.js";
import {
  ScheduleRunSchema,
  ScheduleSummarySchema,
  StoredScheduleSchema,
  type ScheduleCadence,
  type UpdateScheduleInput,
} from "@thoth/protocol/schedule/types";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import {
  AgentModelSchema,
  AgentProviderEnum,
  AgentStatusEnum,
  ProviderModeSchema,
  ProviderSummarySchema,
  parseDurationString,
  resolveRequiredProviderModel,
  sanitizePermissionRequest,
  serializeSnapshotWithMetadata,
  toScheduleSummary,
  waitForAgentWithTimeout,
} from "../mcp-shared.js";
import {
  ThothReportBlockedInputSchema,
  ThothGetBoundTaskProgressInputSchema,
  ThothSubmitClarifyCardInputSchema,
  ThothSubmitClarifyConvergenceAuditInputSchema,
  ThothSubmitContractPreservationAuditInputSchema,
  ThothSubmitGoalsCardInputSchema,
  ThothSubmitTaskCardInputSchema,
  ThothLoopPlanExecResultInputSchema,
  ThothLoopReportBlockedInputSchema,
  ThothLoopReviewIndependentAssessmentInputSchema,
  ThothLoopReviewVerdictInputSchema,
  type ClarifyConvergenceReview,
  type ClarifyConvergenceAudit,
  type ClarifyFrontierLedger,
  type ThothLoopPlanExecResultInput,
  type ThothLoopReportBlockedInput,
  type ThothLoopReviewIndependentAssessmentInput,
  type ThothLoopReviewVerdictInput,
  type ThothReportBlockedInput,
  type ThothSubmitClarifyCardInput,
  type ThothSubmitClarifyConvergenceAuditInput,
  type ThothSubmitContractPreservationAuditInput,
  type ThothSubmitGoalsCardInput,
  type ThothSubmitTaskCardInput,
} from "@thoth/protocol/thoth-runtime-contract";
import {
  rejectClarifyConvergenceAudit,
  resolveContractPreservationAudit,
  resolveClarifyConvergenceAudit,
  waitForClarifyConvergenceAudit,
} from "../clarify-audit-broker.js";
import type {
  ThothClarifyCardModel,
  ThothApprovalGoalCardModel,
  ThothGoalsCardModel,
  ThothTaskCardModel,
  ThothCardAnswerPayload,
} from "@thoth/protocol/thoth/rpc-schemas";
import { sendPromptToAgent, setupFinishNotification } from "../agent-prompt.js";
import { respondToAgentPermission } from "../permission-response.js";
import {
  readThothRuntimeToolsConfig,
  withThothRuntimeTools,
} from "../thoth-runtime-tools-config.js";
import { createRuntimeAuthorityDecision } from "../runtime-tool-decisions.js";
import {
  assertForegroundAuthorityTurn,
  assertForegroundContextTurn,
  getActiveForegroundAuthorityTurnId,
  parkForegroundTurnFence,
} from "./foreground-turn-fence.js";
import {
  WorkspaceForegroundAuthority,
  type TaskToolGateway,
  type WorkspaceAuthorityManager,
} from "../../workspace-authority/index.js";
import {
  archiveAgentCommand,
  cancelAgentRunCommand,
  closeAgentCommand,
  setAgentModeCommand,
  updateAgentCommand,
} from "../lifecycle-command.js";
import type { GitHubService } from "../../../services/github-service.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import { WorktreeRequestError } from "../../worktree-errors.js";
import {
  archiveCommand,
  type ArchiveCommandDependencies,
  createThothWorktreeCommand,
  type CreateThothWorktreeCommandInput,
  listThothWorktreesCommand,
} from "../../worktree/commands.js";
import type {
  ThothToolCatalog,
  ThothToolConfig,
  ThothToolDefinition,
  ThothToolExecutionContext,
  ThothToolResult,
  ThothToolRuntimeCallerConfig,
} from "@thoth/drivers/agent-runtime";

export interface ThothToolHostDependencies {
  agentManager: AgentManager;
  agentStorage: AgentRegistry;
  terminalManager?: TerminalManager | null;
  getDaemonTcpPort?: () => number | null;
  scheduleService?: ScheduleService | null;
  providerSnapshotManager: ProviderSnapshotManager;
  github?: GitHubService;
  workspaceGitService?: Pick<
    WorkspaceGitService,
    "getSnapshot" | "listWorktrees" | "resolveRepoRoot"
  >;
  findWorkspaceIdForCwd?: ArchiveDependencies["findWorkspaceIdForCwd"];
  listActiveWorkspaces?: ArchiveDependencies["listActiveWorkspaces"];
  archiveWorkspaceRecord?: ArchiveDependencies["archiveWorkspaceRecord"];
  emitWorkspaceUpdatesForWorkspaceIds?: ArchiveDependencies["emitWorkspaceUpdatesForWorkspaceIds"];
  markWorkspaceArchiving?: ArchiveDependencies["markWorkspaceArchiving"];
  clearWorkspaceArchiving?: ArchiveDependencies["clearWorkspaceArchiving"];
  createThothWorktree?: CreateThothWorktreeWorkflowFn;
  // Mints a fresh directory workspace for a cwd and returns its id.
  ensureWorkspaceForCreate?: (cwd: string) => Promise<string>;
  thothHome?: string;
  worktreesRoot?: string;
  /**
   * ID of the agent that is using this tool catalog.
   * Used for cwd/mode inheritance when agents spawn child agents.
   */
  callerAgentId?: string;
  /**
   * Runtime-only config for the caller during session launch. The caller agent
   * is not registered yet when native provider tools are mounted.
   */
  callerAgentConfig?: ThothToolRuntimeCallerConfig;
  logger: Logger;
  workspaceAuthorityManager?: WorkspaceAuthorityManager;
  taskToolGateway?: TaskToolGateway;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function resolveAgentListActivityTime(agent: AgentListItemPayload): number {
  return Math.max(
    parseTimestamp(agent.updatedAt),
    parseTimestamp(agent.lastUserMessageAt),
    parseTimestamp(agent.attentionTimestamp),
    parseTimestamp(agent.archivedAt),
    parseTimestamp(agent.createdAt),
  );
}

interface ProviderSummary {
  id: AgentProvider;
  label: string;
  description: string;
  enabled: boolean;
  modes: AgentMode[];
  status: string;
  error?: string;
}

function toProviderSummary(entry: {
  provider: AgentProvider;
  label?: string;
  description?: string;
  enabled: boolean;
  modes?: AgentMode[];
  status: string;
  error?: string;
}): ProviderSummary {
  return {
    id: entry.provider,
    label: entry.label ?? entry.provider,
    description: entry.description ?? "",
    enabled: entry.enabled,
    modes: entry.modes ?? [],
    status: entry.status === "ready" ? "available" : entry.status,
    ...(entry.error ? { error: entry.error } : {}),
  };
}

function compareAgentListItems(a: AgentListItemPayload, b: AgentListItemPayload): number {
  const attentionDelta =
    Number(b.requiresAttention ?? false) - Number(a.requiresAttention ?? false);
  if (attentionDelta !== 0) {
    return attentionDelta;
  }

  const statusOrder = {
    running: 0,
    initializing: 1,
    idle: 2,
    error: 3,
    closed: 4,
  } as Record<string, number>;
  const statusDelta = (statusOrder[a.status] ?? 999) - (statusOrder[b.status] ?? 999);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  return resolveAgentListActivityTime(b) - resolveAgentListActivityTime(a);
}

function sha256Digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function resolveRuntimeToolCallContext(context: ThothToolExecutionContext): {
  provider: string;
  threadId: string;
  turnId: string;
  callId: string;
  toolName: string;
} {
  const call = context.providerToolCall;
  if (!call) {
    return {
      provider: "unknown",
      threadId: "unknown-thread",
      turnId: "unknown-turn",
      callId: `runtime-call-${randomUUID()}`,
      toolName: "thoth_runtime_tool",
    };
  }
  return {
    provider: call.provider,
    threadId: call.threadId,
    turnId: call.turnId,
    callId: call.callId,
    toolName: call.toolName,
  };
}

function summarizeRuntimeAuthorityAnswer(answer: ThothCardAnswerPayload): string {
  switch (answer.intent) {
    case "accept_quick":
      return "accepted_quick";
    case "accept_loop":
      return "accepted_loop_registered_pending";
    case "annotate":
      return `annotated: ${answer.note ?? answer.raw_answer}`;
    case "cancel":
      return "canceled";
    case "stop":
      return "paused_clarify_questions";
    case "recommend":
      return "user asked Thoth to recommend";
    case "decide":
      return "user authorized Thoth to decide";
    default:
      return answer.raw_answer;
  }
}

export function runtimeToolResultText(input: {
  answer: ThothCardAnswerPayload;
  submittedSummary: string;
  cardKind: "clarify_card" | "task_card" | "goals_card" | "blocked_card";
  clarifyConverged?: boolean;
}): string {
  const answerSummary = summarizeRuntimeAuthorityAnswer(input.answer);
  if (input.cardKind === "task_card" && input.answer.intent === "accept_quick") {
    return [
      "User approved the Task Card and chose the Quick foreground path.",
      `Visible answer summary: ${input.submittedSummary}`,
      `Answer: ${answerSummary}`,
      "Next required runtime tool: thoth_submit_goals_card.",
      "Submit the Goals Card as the second approval card, grounded in the clarify transcript and the approved Task Card.",
      "Do not execute yet. Do not answer in prose. Do not submit another Task Card unless the user requested revisions.",
    ].join("\n");
  }
  if (input.cardKind === "task_card" && input.answer.intent === "accept_loop") {
    return [
      "User approved the Task Card and chose the Loop registration path.",
      `Visible answer summary: ${input.submittedSummary}`,
      `Answer: ${answerSummary}`,
      "Next required runtime tool: thoth_submit_goals_card.",
      "Submit the Goals Card as the second approval card, grounded in the clarify transcript and the approved Task Card.",
      "Do not register, execute, or review yet. Registration is allowed only after the Goals Card is approved.",
    ].join("\n");
  }
  if (input.cardKind === "clarify_card" && input.clarifyConverged) {
    return [
      "The user completed this converged Clarify card.",
      `Visible answer summary: ${input.submittedSummary}`,
      `Answer: ${answerSummary}`,
      "Next required runtime tool: thoth_submit_task_card.",
      "Submit the Task Card now. Do not submit a Goals Card, register a task, or execute before the user approves that Task Card.",
      "The independent Clarify convergence audit will either permit the Task Card or return a concrete frontier for another Clarify card.",
    ].join("\n");
  }
  if (input.answer.intent === "accept_quick") {
    return [
      "User approved this card for Quick foreground execution.",
      `Visible answer summary: ${input.submittedSummary}`,
      `Answer: ${answerSummary}`,
      "Continue in the same provider turn by executing the approved task in the current workspace.",
      "Use normal provider tools and timeline events such as shell, edit, read, write, search, fetch, and tests as needed.",
      "If the approved task requires implementation, create or edit the necessary files and verify the result instead of only summarizing in prose.",
      "Do not submit another authority card unless a new high-impact user decision appears.",
    ].join("\n");
  }
  if (input.answer.intent === "accept_loop") {
    return [
      "User approved this card for Loop registration.",
      `Visible answer summary: ${input.submittedSummary}`,
      "The task has been registered and handed to the Thoth background Loop scheduler.",
      "Do not continue foreground execution for this task in the visible Agent session.",
    ].join("\n");
  }
  if (input.answer.intent === "annotate") {
    return [
      "User requested revisions.",
      `Visible answer summary: ${input.submittedSummary}`,
      `Answer: ${answerSummary}`,
      "Continue by submitting a revised authority card or a new clarify card if the annotation reopens a material decision.",
    ].join("\n");
  }
  if (input.answer.intent === "stop") {
    return [
      "User paused further Clarify questioning for now.",
      `Visible answer summary: ${input.submittedSummary}`,
      "Do not switch the user's selected mode or clarify strength.",
      "Do not execute hidden work.",
      "If the user later asks to continue, continue from the current Clarify context and strength.",
    ].join("\n");
  }
  if (input.answer.intent === "cancel") {
    return [
      "User canceled this authority flow.",
      `Visible answer summary: ${input.submittedSummary}`,
      "Stop the structured flow and do not execute hidden work.",
    ].join("\n");
  }
  return [
    "User answered this clarify card.",
    `Visible answer summary: ${input.submittedSummary}`,
    `Answer: ${answerSummary}`,
    "Continue according to the loaded Thoth Clarify Skill.",
    "If the current clarify strength is balanced or dive and the soft minimum has not been reached, normally continue with another Clarify card on the next material frontier.",
    "Do not use an early Task Card unless the user explicitly stopped, the task is genuinely trivial, or every remaining material frontier category is grounded, agent-owned, discoverable, or standard practice.",
    "Submit another Clarify card if material user-owned decisions remain; otherwise submit the next authority card.",
  ].join("\n");
}

function clarifyDecisionRecordsForAgent(
  store: WorkspaceForegroundAuthority | null,
  agentId: string | null,
) {
  if (!store || !agentId) {
    return [];
  }
  return store.listCardsForAgent(agentId).filter((record) => record.kind === "clarify_card");
}

function countAnsweredClarifyCardsForAgent(
  store: WorkspaceForegroundAuthority | null,
  agentId: string | null,
): number {
  return clarifyDecisionRecordsForAgent(store, agentId).filter(
    (record) => record.status === "answered",
  ).length;
}

function latestClarifyLedgerForAgent(
  store: WorkspaceForegroundAuthority | null,
  agentId: string | null,
): ClarifyFrontierLedger | null {
  return (
    clarifyDecisionRecordsForAgent(store, agentId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((record) => (record.card as ThothClarifyCardModel).frontierLedger)
      .find((ledger): ledger is ClarifyFrontierLedger => Boolean(ledger)) ?? null
  );
}

function softClarifyMinimum(strength: string): number | null {
  if (strength === "balanced") {
    return 5;
  }
  if (strength === "dive") {
    return 10;
  }
  return null;
}

function resolveScheduleProviderAndModel(params: {
  provider?: string;
  defaultProvider: AgentProvider;
}): { provider: AgentProvider; model?: string } {
  const providerInput = params.provider?.trim() || params.defaultProvider;
  const slashIndex = providerInput.indexOf("/");
  if (slashIndex === -1) {
    return { provider: providerInput };
  }

  const provider = providerInput.slice(0, slashIndex).trim();
  const model = providerInput.slice(slashIndex + 1).trim();
  if (!provider || !model) {
    throw new Error("provider must be <provider> or <provider>/<model>");
  }

  return {
    provider: provider,
    model,
  };
}

function resolveScheduleUpdateProviderAndModel(params: {
  provider?: string;
  model?: string | null;
}): { provider?: string; model?: string | null } {
  const providerInput = params.provider?.trim();
  const modelInput = typeof params.model === "string" ? params.model.trim() : params.model;

  if (params.model !== undefined && modelInput === "") {
    throw new Error("model cannot be empty");
  }

  if (!providerInput) {
    return params.model !== undefined ? { model: modelInput } : {};
  }

  const slashIndex = providerInput.indexOf("/");
  if (slashIndex === -1) {
    return {
      provider: providerInput,
      ...(params.model !== undefined ? { model: modelInput } : {}),
    };
  }

  const provider = providerInput.slice(0, slashIndex).trim();
  const modelFromProvider = providerInput.slice(slashIndex + 1).trim();
  if (!provider || !modelFromProvider) {
    throw new Error("provider must be <provider> or <provider>/<model>");
  }
  if (params.model === null) {
    throw new Error("provider specifies a model but model is null");
  }
  if (typeof modelInput === "string" && modelInput !== modelFromProvider) {
    throw new Error("Conflicting model values provided");
  }

  return {
    provider,
    model: modelInput ?? modelFromProvider,
  };
}

interface ScheduleUpdateToolInput {
  id: string;
  every?: string;
  cron?: string;
  timezone?: string;
  name?: string | null;
  prompt?: string;
  maxRuns?: number | null;
  provider?: string;
  model?: string | null;
  mode?: string | null;
  expiresIn?: string;
  clearExpires?: boolean;
}

function normalizeScheduleCadenceArg(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
}

function normalizeScheduleTimeZoneArg(value: string | undefined): string | undefined {
  return normalizeScheduleCadenceArg(value);
}

function resolveScheduleUpdateCadence(input: ScheduleUpdateToolInput): ScheduleCadence | undefined {
  const every = normalizeScheduleCadenceArg(input.every);
  const cron = normalizeScheduleCadenceArg(input.cron);
  const timeZone = normalizeScheduleTimeZoneArg(input.timezone);

  if (every !== undefined && cron !== undefined) {
    throw new Error("Specify at most one of every or cron");
  }
  if (timeZone !== undefined && cron === undefined) {
    throw new Error("timezone can only be used with cron");
  }
  if (every !== undefined) {
    return { type: "every", everyMs: parseDurationString(every) };
  }
  if (cron !== undefined) {
    return {
      type: "cron",
      expression: cron,
      ...(timeZone !== undefined ? { timezone: timeZone } : {}),
    };
  }
  return undefined;
}

function resolveScheduleUpdateExpiresAt(input: ScheduleUpdateToolInput): string | null | undefined {
  if (input.expiresIn !== undefined && input.clearExpires) {
    throw new Error("Specify at most one of expiresIn or clearExpires");
  }
  if (input.expiresIn !== undefined) {
    return new Date(Date.now() + parseDurationString(input.expiresIn)).toISOString();
  }
  if (input.clearExpires) {
    return null;
  }
  return undefined;
}

function buildScheduleUpdateInput(input: ScheduleUpdateToolInput): UpdateScheduleInput {
  const cadence = resolveScheduleUpdateCadence(input);
  const expiresAt = resolveScheduleUpdateExpiresAt(input);
  const providerModelPatch = resolveScheduleUpdateProviderAndModel({
    provider: input.provider,
    model: input.model,
  });
  const newAgentConfig = {
    ...(providerModelPatch.provider !== undefined ? { provider: providerModelPatch.provider } : {}),
    ...(providerModelPatch.model !== undefined ? { model: providerModelPatch.model } : {}),
    ...(input.mode !== undefined ? { modeId: input.mode } : {}),
  };

  return {
    id: input.id,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
    ...(cadence !== undefined ? { cadence } : {}),
    ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(Object.keys(newAgentConfig).length > 0 ? { newAgentConfig } : {}),
  };
}

function resolveChildAgentCwd(params: { parentCwd: string; requestedCwd?: string }): string {
  const requestedCwd = params.requestedCwd?.trim();
  if (!requestedCwd) {
    return params.parentCwd;
  }

  return resolvePathFromBase(params.parentCwd, requestedCwd);
}

const TerminalSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  cwd: z.string(),
});

const WorktreeSummarySchema = z.object({
  path: z.string(),
  createdAt: z.string(),
  branchName: z.string().optional(),
  head: z.string().optional(),
});

function resolveTerminalKeyToken(key: string, literal: boolean): string {
  if (literal) {
    return key;
  }

  switch (key) {
    case "Enter":
      return "\r";
    case "Tab":
      return "\t";
    case "Escape":
      return "\u001b";
    case "Space":
      return " ";
    case "BSpace":
      return "\u007f";
    case "C-c":
      return "\u0003";
    case "C-d":
      return "\u0004";
    case "C-z":
      return "\u001a";
    case "C-l":
      return "\u000c";
    case "C-a":
      return "\u0001";
    case "C-e":
      return "\u0005";
    default:
      return key;
  }
}

export function createThothToolCatalog(options: ThothToolHostDependencies): ThothToolCatalog {
  const {
    agentManager,
    agentStorage,
    terminalManager,
    scheduleService,
    providerSnapshotManager,
    callerAgentId,
    logger,
  } = options;
  const childLogger = logger.child({ module: "agent", component: "thoth-tool-catalog" });
  const foregroundAuthorityStore = options.workspaceAuthorityManager
    ? new WorkspaceForegroundAuthority(options.workspaceAuthorityManager)
    : null;
  const waitTracker = new WaitForAgentTracker(logger);
  // AgentManager builds the native dynamic-tool catalog before it registers the
  // provider session. Read the caller lazily for handlers that need a live
  // session, otherwise a valid Clarify -> Task transition falsely loses its
  // independent audit capability.
  const initialToolCallerAgent = callerAgentId ? agentManager.getAgent(callerAgentId) : null;
  const toolCallerConfig = initialToolCallerAgent?.config ?? options.callerAgentConfig;
  const runtimeTools = toolCallerConfig ? readThothRuntimeToolsConfig(toolCallerConfig) : null;
  const enableClarifyRuntimeTools = runtimeTools?.scope === "clarify";
  const enableClarifyAuditTools = runtimeTools?.scope === "clarify_audit";
  const enableContractAuditTools = runtimeTools?.scope === "contract_audit";
  const enableLoopRuntimeTools =
    runtimeTools?.scope === "loop_planexec" || runtimeTools?.scope === "loop_review";
  const loopRuntimePhase =
    runtimeTools?.scope === "loop_planexec"
      ? "planexec"
      : runtimeTools?.scope === "loop_review"
        ? "review"
        : null;
  const parseToolInput = async (tool: ThothToolDefinition, input: unknown): Promise<unknown> => {
    const inputSchema = tool.inputSchema;
    if (!inputSchema) {
      return input;
    }
    const schema =
      typeof inputSchema === "object" &&
      inputSchema !== null &&
      typeof (inputSchema as { safeParseAsync?: unknown }).safeParseAsync === "function"
        ? (inputSchema as z.ZodType)
        : z.object(inputSchema as z.ZodRawShape).passthrough();
    return schema.parseAsync(input);
  };

  const tools = new Map<string, ThothToolDefinition>();
  const registerTool = (
    name: string,
    config: ThothToolConfig,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool handlers are schema-validated at registration boundaries.
    handler: (input: any, context: ThothToolExecutionContext) => Promise<ThothToolResult>,
  ) => {
    tools.set(name, {
      name,
      title: config.title,
      description: config.description ?? name,
      inputSchema: config.inputSchema,
      outputSchema: config.outputSchema,
      handler: handler as ThothToolDefinition["handler"],
    });
  };
  const toCatalog = (): ThothToolCatalog => ({
    tools,
    getTool(name: string): ThothToolDefinition | undefined {
      return tools.get(name);
    },
    async executeTool(
      name: string,
      input: unknown,
      context: ThothToolExecutionContext = {},
    ): Promise<ThothToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Thoth tool not found: ${name}`);
      }
      if (runtimeTools?.scope === "clarify" && callerAgentId) {
        if (name === "thoth_get_bound_task_progress") {
          assertForegroundContextTurn({ agentId: callerAgentId, context });
        } else {
          assertForegroundAuthorityTurn({ agentId: callerAgentId, context });
        }
      }
      return tool.handler(await parseToolInput(tool, input), context);
    },
  });

  const runClarifyConvergenceAudit = async (input: {
    taskCard: ThothSubmitTaskCardInput["task_card"];
    convergenceReview: ClarifyConvergenceReview;
    clarifyCount: number;
    clarifyTranscript: string;
  }): Promise<ClarifyConvergenceAudit> => {
    const toolCallerAgent = callerAgentId ? agentManager.getAgent(callerAgentId) : null;
    if (
      !toolCallerAgent ||
      readThothRuntimeToolsConfig(toolCallerAgent.config)?.scope !== "clarify"
    ) {
      throw new Error(
        "Clarify convergence audit requires an active provider runtime-tools session.",
      );
    }
    const auditAgent = await agentManager.createAgent(
      withThothRuntimeTools(
        {
          provider: toolCallerAgent.provider,
          cwd: toolCallerAgent.cwd,
          internal: true,
          ...(toolCallerAgent.config.model ? { model: toolCallerAgent.config.model } : {}),
          modeId: "auto",
          ...(toolCallerAgent.config.thinkingOptionId
            ? { thinkingOptionId: toolCallerAgent.config.thinkingOptionId }
            : {}),
          systemPrompt:
            "You are an independent Thoth Clarify convergence auditor. Do not ask the user questions and do not write files. Judge whether a candidate Task Card is grounded by the supplied frontier ledger and transcript. Call thoth_submit_clarify_convergence_audit exactly once with proceed, revise_frontier, or blocked.",
        },
        {
          enabled: true,
          scope: "clarify_audit",
        },
      ),
      undefined,
      {
        labels: { surface: "thoth-clarify-audit", sourceAgentId: toolCallerAgent.id },
        persistSession: true,
        persistInternal: true,
        initialTitle: "Clarify convergence audit",
        ...(toolCallerAgent.workspaceId ? { workspaceId: toolCallerAgent.workspaceId } : {}),
      },
    );
    const wait = waitForClarifyConvergenceAudit(auditAgent.id);
    const prompt = [
      "Audit this candidate without creating a user-facing card.",
      `Clarify cards answered: ${input.clarifyCount}`,
      `Candidate Task Card:\n${JSON.stringify(input.taskCard, null, 2)}`,
      `Convergence review:\n${JSON.stringify(input.convergenceReview, null, 2)}`,
      `Clarify transcript:\n${input.clarifyTranscript}`,
      "A revise_frontier result must name only material user-owned assumptions. Proceed only when no such assumption remains.",
    ].join("\n\n");
    void (async () => {
      try {
        for await (const event of agentManager.streamAgent(auditAgent.id, prompt)) {
          if (event.type === "turn_failed") {
            rejectClarifyConvergenceAudit(auditAgent.id, event.error);
            return;
          }
          if (event.type === "turn_canceled") {
            rejectClarifyConvergenceAudit(auditAgent.id, event.reason);
            return;
          }
        }
      } catch (error) {
        rejectClarifyConvergenceAudit(
          auditAgent.id,
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
    return wait;
  };

  if (enableClarifyAuditTools) {
    registerTool(
      "thoth_submit_clarify_convergence_audit",
      {
        title: "Submit Clarify convergence audit",
        description:
          "Submit the independent internal Clarify audit. Proceed only when no material user-owned assumption remains; revise_frontier must identify the missing frontier.",
        inputSchema: ThothSubmitClarifyConvergenceAuditInputSchema,
        outputSchema: z.object({ ok: z.literal(true) }).strict(),
      },
      async (input: ThothSubmitClarifyConvergenceAuditInput) => {
        if (!callerAgentId || !resolveClarifyConvergenceAudit(callerAgentId, input)) {
          throw new Error("No pending Clarify convergence audit owns this result.");
        }
        return {
          content: [{ type: "text", text: "Clarify convergence audit recorded." }],
          structuredContent: { ok: true },
        };
      },
    );
  }

  if (enableContractAuditTools) {
    registerTool(
      "thoth_submit_contract_preservation_audit",
      {
        title: "Submit contract preservation audit",
        description:
          "Submit the internal audit for an automatic future-goal replan. Proceed only if the proposal preserves the approved task goal, constraints, and acceptance.",
        inputSchema: ThothSubmitContractPreservationAuditInputSchema,
        outputSchema: z.object({ ok: z.literal(true) }).strict(),
      },
      async (input: ThothSubmitContractPreservationAuditInput) => {
        if (!callerAgentId || !resolveContractPreservationAudit(callerAgentId, input)) {
          throw new Error("No pending contract preservation audit owns this result.");
        }
        return {
          content: [{ type: "text", text: "Contract preservation audit recorded." }],
          structuredContent: { ok: true },
        };
      },
    );
  }

  const buildCronScheduleCadence = (input: {
    cron: string | undefined;
    timezone?: string;
  }): ScheduleCadence => {
    const expression = input.cron?.trim() ?? "";
    if (!expression) {
      throw new Error("cron is required");
    }
    const timezone = normalizeScheduleTimeZoneArg(input.timezone);
    return {
      type: "cron",
      expression,
      ...(timezone !== undefined ? { timezone } : {}),
    };
  };

  const buildScheduleExpiry = (expiresIn: string | undefined): string | undefined => {
    return expiresIn === undefined
      ? undefined
      : new Date(Date.now() + parseDurationString(expiresIn)).toISOString();
  };

  const resolveCallerAgent = () => {
    if (!callerAgentId) {
      return null;
    }
    const parentAgent = agentManager.getAgent(callerAgentId);
    if (!parentAgent) {
      throw new Error(`Parent agent ${callerAgentId} not found`);
    }
    return parentAgent;
  };

  const resolveScopedCwd = (requestedCwd?: string, opts?: { required?: boolean }): string => {
    const callerAgent = resolveCallerAgent();
    if (callerAgent) {
      return resolveChildAgentCwd({
        parentCwd: callerAgent.cwd,
        requestedCwd,
      });
    }

    const trimmedCwd = requestedCwd?.trim();
    if (!trimmedCwd) {
      if (opts?.required) {
        throw new Error("cwd is required");
      }
      throw new Error("cwd is required outside an agent-scoped session");
    }

    return expandUserPath(trimmedCwd);
  };

  async function resolveTerminalWorkspaceId(resolvedCwd: string): Promise<string> {
    // An agent-spawned terminal belongs to the caller agent's workspace. Only if
    // the caller has no workspace do we mint one for the cwd.
    const callerAgent = callerAgentId ? agentManager.getAgent(callerAgentId) : null;
    if (callerAgent?.workspaceId) {
      return callerAgent.workspaceId;
    }

    if (!options.ensureWorkspaceForCreate) {
      throw new Error(
        callerAgentId
          ? `Caller agent ${callerAgentId} has no workspace and workspace minting is not configured`
          : "workspaceId is required outside an agent-scoped session",
      );
    }

    return options.ensureWorkspaceForCreate(resolvedCwd);
  }

  const buildCallerAgentScheduleConfigExtras = (
    callerAgent: NonNullable<ReturnType<typeof resolveCallerAgent>>,
  ): Record<string, unknown> => {
    return {
      ...(callerAgent.config.thinkingOptionId
        ? { thinkingOptionId: callerAgent.config.thinkingOptionId }
        : {}),
      ...(callerAgent.config.approvalPolicy
        ? { approvalPolicy: callerAgent.config.approvalPolicy }
        : {}),
      ...(callerAgent.config.sandboxMode ? { sandboxMode: callerAgent.config.sandboxMode } : {}),
      ...(typeof callerAgent.config.networkAccess === "boolean"
        ? { networkAccess: callerAgent.config.networkAccess }
        : {}),
      ...(typeof callerAgent.config.webSearch === "boolean"
        ? { webSearch: callerAgent.config.webSearch }
        : {}),
      ...(callerAgent.config.title ? { title: callerAgent.config.title } : {}),
      ...(callerAgent.config.extra ? { extra: callerAgent.config.extra } : {}),
      ...(callerAgent.config.featureValues
        ? { featureValues: callerAgent.config.featureValues }
        : {}),
      ...(callerAgent.config.systemPrompt ? { systemPrompt: callerAgent.config.systemPrompt } : {}),
      ...(callerAgent.config.mcpServers ? { mcpServers: callerAgent.config.mcpServers } : {}),
    };
  };

  const buildCallerAgentScheduleConfig = (
    callerAgent: NonNullable<ReturnType<typeof resolveCallerAgent>>,
    params?: { provider?: string },
  ) => {
    const hasProviderOverride = params?.provider !== undefined;
    const resolvedProviderModel = hasProviderOverride
      ? resolveScheduleProviderAndModel({
          provider: params?.provider,
          defaultProvider: callerAgent.provider,
        })
      : null;
    const resolvedProvider = resolvedProviderModel?.provider ?? callerAgent.provider;
    let resolvedModel: string | undefined;
    if (resolvedProviderModel?.model) {
      resolvedModel = resolvedProviderModel.model;
    } else if (!hasProviderOverride && callerAgent.config.model) {
      resolvedModel = callerAgent.config.model;
    }
    return {
      provider: resolvedProvider,
      ...(callerAgent.currentModeId && callerAgent.provider === resolvedProvider
        ? {
            modeId: callerAgent.currentModeId,
          }
        : {}),
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...buildCallerAgentScheduleConfigExtras(callerAgent),
    };
  };

  const resolveNewAgentScheduleTarget = (params?: { provider?: string }) => {
    if (!params?.provider?.trim()) {
      throw new Error("provider is required when target is new-agent");
    }

    const callerAgent = resolveCallerAgent();
    if (!callerAgent?.workspaceId) {
      throw new Error("Schedule tools require an Agent owned by a Workspace");
    }
    return {
      type: "new-agent" as const,
      config: buildCallerAgentScheduleConfig(callerAgent, params),
    };
  };

  const resolveScheduleWorkspaceId = (): string => {
    const callerAgent = resolveCallerAgent();
    if (!callerAgent?.workspaceId) {
      throw new Error("Schedule tools require an Agent owned by a Workspace");
    }
    return callerAgent.workspaceId;
  };

  const appendRuntimeAuthorityToolCall = async (input: {
    callId: string;
    safeName: string;
    label: string;
    text: string;
    status: "running" | "completed" | "failed" | "canceled";
    error?: unknown;
    metadata?: Record<string, unknown>;
  }) => {
    if (!callerAgentId) {
      return;
    }
    const item = {
      type: "tool_call",
      callId: input.callId,
      name: input.safeName,
      status: input.status,
      error: input.status === "failed" ? (input.error ?? { message: "Tool call failed" }) : null,
      detail: {
        type: "plain_text",
        label: input.label,
        text: input.text,
        icon: input.status === "running" ? "brain" : "sparkles",
      },
      ...(input.metadata ? { metadata: input.metadata } : {}),
    } as AgentTimelineItem;
    await agentManager.appendTimelineItem(callerAgentId, item);
  };

  const waitForRuntimeAuthorityAnswer = async (input: {
    context: ThothToolExecutionContext;
    safeName: string;
    label: string;
    pendingText: string;
    metadata?: Record<string, unknown>;
    publicBadgeSummary?: string;
    frontierLedger?: ClarifyFrontierLedger;
    decisionDelta?: import("@thoth/protocol/thoth-runtime-contract").ClarifyDecisionDelta;
    convergenceReview?: ClarifyConvergenceReview;
    card:
      | { kind: "clarify_card"; card: ThothClarifyCardModel }
      | { kind: "task_card"; card: ThothTaskCardModel }
      | { kind: "goals_card"; card: ThothApprovalGoalCardModel }
      | { kind: "blocked_card"; title: string; reason: string };
    appendOpenCard: () => Promise<void>;
  }): Promise<ThothToolResult> => {
    if (!callerAgentId) {
      throw new Error("Thoth runtime authority tools require an agent-scoped caller");
    }
    if (!foregroundAuthorityStore) {
      throw new Error("Thoth foreground authority is unavailable for this provider session");
    }
    const call = resolveRuntimeToolCallContext(input.context);
    const foregroundTurnId = getActiveForegroundAuthorityTurnId(callerAgentId);
    if (!foregroundTurnId) {
      throw new Error("No active Agent-scoped Thoth turn owns this authority card");
    }
    const { record } = createRuntimeAuthorityDecision({
      store: foregroundAuthorityStore,
      provider: call.provider,
      agentId: callerAgentId,
      threadId: call.threadId,
      providerTurnId: call.turnId,
      callId: call.callId,
      toolName: call.toolName,
      card: input.card,
      redactedRawInputHash: sha256Digest(
        JSON.stringify({
          toolName: call.toolName,
          cardKind: input.card.kind,
          foregroundTurnId,
        }),
      ),
      ...(input.publicBadgeSummary ? { publicBadgeSummary: input.publicBadgeSummary } : {}),
      ...(input.frontierLedger ? { frontierLedger: input.frontierLedger } : {}),
      ...(input.decisionDelta ? { decisionDelta: input.decisionDelta } : {}),
      ...(input.convergenceReview ? { convergenceReview: input.convergenceReview } : {}),
    });
    await appendRuntimeAuthorityToolCall({
      callId: call.callId,
      safeName: input.safeName,
      label: input.label,
      text: input.pendingText,
      status: "running",
      metadata: {
        thothAuthorityDecision: true,
        pendingAuthorityDecision: true,
        cardKind: input.card.kind,
        authorityDecisionId: record.id,
        cardId: record.cardId,
        ...(input.metadata ?? {}),
      },
    });
    await input.appendOpenCard();
    parkForegroundTurnFence({ agentId: callerAgentId, providerTurnId: call.turnId });
    await appendRuntimeAuthorityToolCall({
      callId: call.callId,
      safeName: input.safeName,
      label: input.label,
      text: "等待用户决定",
      status: "completed",
      metadata: {
        thothAuthorityDecision: true,
        pendingAuthorityDecision: true,
        cardKind: input.card.kind,
        authorityDecisionId: record.id,
        cardId: record.cardId,
        status: "awaiting_user",
        ...(input.metadata ?? {}),
      },
    });
    void agentManager.cancelAgentRun(callerAgentId).catch((error) => {
      logger.warn(
        { err: error, agentId: callerAgentId },
        "Failed to park provider turn after authority card",
      );
    });
    return {
      content: [
        {
          type: "text",
          text: "The authority card is durable. Stop this turn and wait for the user's answer.",
        },
      ],
      structuredContent: {
        ok: true,
        status: "awaiting_user",
        authorityDecisionId: record.id,
        cardId: record.cardId,
      },
    };
  };

  const requireApprovedTaskCardForGoals = async (
    context: ThothToolExecutionContext,
  ): Promise<ThothToolResult | null> => {
    const hasApprovedTaskCard = Boolean(
      callerAgentId &&
      foregroundAuthorityStore
        ?.listCardsForAgent(callerAgentId)
        .some((record) => record.kind === "task_card" && record.status === "answered"),
    );
    if (hasApprovedTaskCard) {
      return null;
    }

    const call = resolveRuntimeToolCallContext(context);
    const message = [
      "Goals Card was rejected because this topic has no user-approved Task Card.",
      "Required authority order: Clarify -> Task Card -> user approval -> Goals Card.",
      "Submit or repair thoth_submit_task_card first. Do not create a Goals Card before that approval.",
    ].join("\n");
    await appendRuntimeAuthorityToolCall({
      callId: call.callId,
      safeName: "goals_approval",
      label: "Goals Card",
      text: message,
      status: "failed",
      error: { message },
      metadata: {
        thothAuthorityDecision: true,
        transitionRejected: true,
        requiredPreviousCard: "task_card",
      },
    });
    return {
      content: [{ type: "text", text: message }],
      structuredContent: { ok: false, status: "rejected" },
      isError: true,
    };
  };

  if (enableClarifyRuntimeTools) {
    registerTool(
      "thoth_get_bound_task_progress",
      {
        title: "Get bound Task progress",
        description:
          "Read the latest semantic progress for Tasks that the user explicitly attached to this foreground turn. This tool is read-only and cannot discover unbound Tasks.",
        inputSchema: ThothGetBoundTaskProgressInputSchema,
        outputSchema: z
          .object({
            tasks: z.array(z.unknown()),
          })
          .strict(),
      },
      async (_input, context) => {
        if (!callerAgentId || !options.workspaceAuthorityManager) {
          throw new Error("Bound Task progress requires foreground Workspace authority");
        }
        const turnId = assertForegroundContextTurn({ agentId: callerAgentId, context });
        const store = options.workspaceAuthorityManager.forTurn(turnId);
        if (!store) {
          throw new Error(`Foreground turn ${turnId} has no Workspace authority`);
        }
        const tasks = store.listLatestTurnTaskContexts(turnId);
        if (tasks.length === 0) {
          throw new Error("This foreground turn has no user-selected Task context");
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                tasks.map((entry) => ({
                  task: entry.task,
                  humanDecisions: entry.decisions,
                  blackboard: entry.blackboard,
                  generatedAt: entry.generatedAt,
                })),
              ),
            },
          ],
          structuredContent: { tasks },
        };
      },
    );

    registerTool(
      "thoth_submit_clarify_card",
      {
        title: "Submit Thoth Clarify card",
        description:
          "Submit one high-value Thoth Clarify decision card. Use for user-owned route, scope, risk, acceptance, or irreversible decisions; before balanced/dive soft minimum, keep expanding material frontiers instead of converging.",
        inputSchema: ThothSubmitClarifyCardInputSchema,
        outputSchema: z
          .object({
            ok: z.boolean(),
            status: z.enum(["awaiting_user"]),
            authorityDecisionId: z.string(),
            cardId: z.string(),
          })
          .strict(),
      },
      async (input: ThothSubmitClarifyCardInput, context) => {
        const roundIndex =
          countAnsweredClarifyCardsForAgent(foregroundAuthorityStore, callerAgentId ?? null) + 1;
        const frontierLedgerRef = `${input.frontier_ledger.clarify_strength}:frontier:${roundIndex}`;
        const card: ThothClarifyCardModel = {
          id: `clarify-card-${randomUUID()}`,
          roundLabel: `Clarify ${roundIndex}`,
          roundIndex,
          title: input.title,
          whyNow: input.why_now,
          continuesClarify: input.frontier_ledger.convergence_state !== "ready_for_task",
          publicBadgeSummary: input.public_badge_summary,
          frontierLedger: input.frontier_ledger,
          decisionDelta: input.decision_delta,
          frontierLedgerRef,
          ...(input.decision_delta ? { decisionDelta: input.decision_delta } : {}),
          submitted: false,
          card: {
            question_id: `question-card-${randomUUID()}`,
            title: input.title,
            behavior_tree_node: frontierLedgerRef,
            why_now: input.why_now,
            questions: input.questions.map((question, index) => ({
              id: question.id || `q-${index + 1}`,
              question: question.question,
              behavior_tree_node: question.behavior_tree_node ?? `decision-${index + 1}`,
              selection_mode: question.selection_mode,
              choices: question.choices,
              ...(question.note ? { note: question.note } : {}),
            })),
            allow_choice_notes: true,
            allow_note_only: true,
          },
        };
        return waitForRuntimeAuthorityAnswer({
          context,
          safeName: "clarify",
          label: "需求拆解",
          pendingText: input.public_badge_summary,
          publicBadgeSummary: input.public_badge_summary,
          frontierLedger: input.frontier_ledger,
          metadata: {
            publicBadgeSummary: input.public_badge_summary,
            frontierLedger: input.frontier_ledger,
            frontierLedgerRef,
            roundIndex,
          },
          card: { kind: "clarify_card", card },
          appendOpenCard: async () => {
            if (callerAgentId) {
              await agentManager.appendTimelineItem(callerAgentId, { type: "clarify_card", card });
            }
          },
        });
      },
    );

    registerTool(
      "thoth_submit_task_card",
      {
        title: "Submit Thoth Task card",
        description:
          "Submit the concise CEO Task Card only after Clarify converges. Below balanced/dive soft minimum, convergence is exceptional and must account for every material frontier category.",
        inputSchema: ThothSubmitTaskCardInputSchema,
        outputSchema: z
          .object({
            ok: z.boolean(),
            status: z.enum(["awaiting_user", "revise_frontier", "blocked"]),
            authorityDecisionId: z.string().optional(),
            cardId: z.string().optional(),
          })
          .strict(),
      },
      async (input: ThothSubmitTaskCardInput, context) => {
        const clarifyCount = countAnsweredClarifyCardsForAgent(
          foregroundAuthorityStore,
          callerAgentId ?? null,
        );
        const latestLedger = latestClarifyLedgerForAgent(
          foregroundAuthorityStore,
          callerAgentId ?? null,
        );
        const reviewStrength = input.convergence_review.frontier_ledger.clarify_strength;
        if (latestLedger && latestLedger.clarify_strength !== reviewStrength) {
          throw new Error(
            `Clarify convergence review strength mismatch: expected ${latestLedger.clarify_strength} from the latest Clarify frontier ledger, got ${reviewStrength}.`,
          );
        }
        const minimum = softClarifyMinimum(reviewStrength);
        if (
          minimum !== null &&
          clarifyCount < minimum &&
          !input.convergence_review.below_soft_target_rationale?.trim()
        ) {
          throw new Error(
            `Clarify soft target not reviewed: ${input.convergence_review.frontier_ledger.clarify_strength} needs an explicit below_soft_target_rationale before Task when only ${clarifyCount} Clarify cards have been answered.`,
          );
        }
        let audit: ClarifyConvergenceAudit;
        try {
          audit = await runClarifyConvergenceAudit({
            taskCard: input.task_card,
            convergenceReview: input.convergence_review,
            clarifyCount,
            clarifyTranscript: input.provenance.clarify_transcript_verbatim,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Clarify convergence audit is unavailable; Task Card was not created: ${reason}`,
              },
            ],
            structuredContent: { ok: true, status: "blocked" },
            isError: true,
          };
        }
        if (audit.outcome === "blocked") {
          return {
            content: [
              { type: "text", text: `Clarify convergence audit blocked: ${audit.summary}` },
            ],
            structuredContent: { ok: true, status: "blocked" },
            isError: true,
          };
        }
        if (audit.outcome === "revise_frontier") {
          return {
            content: [
              {
                type: "text",
                text: [
                  "Independent Clarify convergence audit requires another material frontier before Task Card.",
                  `Missing frontier: ${audit.missing_material_frontier.join("; ")}`,
                  `Audit summary: ${audit.summary}`,
                  "Continue the same Clarify session with thoth_submit_clarify_card. Do not create a Task Card yet.",
                ].join("\n"),
              },
            ],
            structuredContent: { ok: true, status: "revise_frontier" },
          };
        }
        const card: ThothTaskCardModel = {
          id: `task-card-${randomUUID()}`,
          roundLabel: "Task",
          title: input.task_card.title,
          goal: input.task_card.goal,
          constraints: input.task_card.constraints,
          acceptance: input.task_card.acceptance,
          provenanceSummary: "基于完整 Clarify 原文记录整理",
          turnControls:
            foregroundAuthorityStore?.getActiveTurn(callerAgentId ?? "")?.controls ?? undefined,
          submitted: false,
        };
        return waitForRuntimeAuthorityAnswer({
          context,
          safeName: "task_approval",
          label: "Task",
          pendingText: "等待用户确认任务总览。",
          convergenceReview: input.convergence_review,
          metadata: {
            convergenceReview: input.convergence_review,
            clarifyCount,
            softMinimum: minimum,
            convergenceAudit: audit,
          },
          card: { kind: "task_card", card },
          appendOpenCard: async () => {
            if (callerAgentId) {
              await agentManager.appendTimelineItem(callerAgentId, { type: "task_card", card });
            }
          },
        });
      },
    );

    registerTool(
      "thoth_submit_goals_card",
      {
        title: "Submit Thoth Goals card",
        description:
          "Submit the second approval card as a linear Goals Card with fine-grained ordered goals, each with goal, constraints, and acceptance. Do not include commands, file paths, or code-level steps.",
        inputSchema: ThothSubmitGoalsCardInputSchema,
        outputSchema: z
          .object({
            ok: z.boolean(),
            status: z.enum(["awaiting_user", "rejected"]),
            authorityDecisionId: z.string().optional(),
            cardId: z.string().optional(),
          })
          .strict(),
      },
      async (input: ThothSubmitGoalsCardInput, context) => {
        const rejected = await requireApprovedTaskCardForGoals(context);
        if (rejected) {
          return rejected;
        }
        const card: ThothGoalsCardModel = {
          id: `goals-card-${randomUUID()}`,
          roundLabel: "Goals",
          title: input.goals_card.title,
          summary: input.goals_card.summary,
          goalsCountRationale: input.goals_card.goals_count_rationale,
          goals: input.goals_card.goals,
          provenanceSummary: "受 Clarify 原文和已确认 CEO Task Card 约束",
          turnControls:
            foregroundAuthorityStore?.getActiveTurn(callerAgentId ?? "")?.controls ?? undefined,
          submitted: false,
        };
        return waitForRuntimeAuthorityAnswer({
          context,
          safeName: "goals_approval",
          label: "Goals Card",
          pendingText: "等待用户确认线性 goals。",
          card: { kind: "goals_card", card },
          appendOpenCard: async () => {
            if (callerAgentId) {
              await agentManager.appendTimelineItem(callerAgentId, { type: "goal_card", card });
            }
          },
        });
      },
    );

    registerTool(
      "thoth_report_blocked",
      {
        title: "Report Thoth blocked state",
        description:
          "Report that the structured Thoth turn is blocked by a real user decision or external condition.",
        inputSchema: ThothReportBlockedInputSchema,
        outputSchema: z.object({ ok: z.boolean(), status: z.literal("blocked") }).strict(),
      },
      async (input: ThothReportBlockedInput, context) => {
        if (!callerAgentId) {
          throw new Error("thoth_report_blocked requires an agent-scoped caller");
        }
        const call = resolveRuntimeToolCallContext(context);
        await appendRuntimeAuthorityToolCall({
          callId: call.callId,
          safeName: "blocked",
          label: input.title,
          text: input.reason,
          status: "failed",
          error: { message: input.reason },
        });
        await agentManager.appendTimelineItem(callerAgentId, {
          type: "error",
          message: input.reason,
        });
        return {
          content: [{ type: "text", text: `Blocked: ${input.reason}` }],
          structuredContent: { ok: true, status: "blocked" },
          isError: true,
        };
      },
    );
  }

  if (enableLoopRuntimeTools && loopRuntimePhase !== "review") {
    registerTool(
      "thoth_loop_submit_planexec_result",
      {
        title: "Submit Thoth Loop PlanExec result",
        description:
          "Submit the completed PlanExec result for the current Thoth background Loop goal. Use exactly once after planning, implementation, and local validation material are ready for Review.",
        inputSchema: ThothLoopPlanExecResultInputSchema,
        outputSchema: z.object({ ok: z.boolean(), status: z.literal("accepted") }).strict(),
      },
      async (input: ThothLoopPlanExecResultInput, context: ThothToolExecutionContext) => {
        if (!callerAgentId) {
          throw new Error("thoth_loop_submit_planexec_result requires an agent-scoped caller");
        }
        const runtimeToolContext = resolveRuntimeToolCallContext(context);
        if (
          !options.taskToolGateway?.submitPlanExec(
            callerAgentId,
            input,
            runtimeToolContext.turnId,
            runtimeToolContext.callId,
          )
        ) {
          throw new Error("No active Thoth Loop PlanExec phase is waiting for this agent");
        }
        return {
          content: [
            {
              type: "text",
              text: [
                "PlanExec result accepted by Thoth Loop.",
                "Wait for the independent Review phase. Do not continue to another goal in this session.",
              ].join("\n"),
            },
          ],
          structuredContent: { ok: true, status: "accepted" },
        };
      },
    );
  }

  if (enableLoopRuntimeTools && loopRuntimePhase !== "planexec") {
    registerTool(
      "thoth_loop_submit_review_independent_assessment",
      {
        title: "Submit independent Review assessment",
        description:
          "Submit the Review agent's independent observations and working theory before receiving PlanExec's semantic account for comparison.",
        inputSchema: ThothLoopReviewIndependentAssessmentInputSchema,
        outputSchema: z.object({ ok: z.boolean(), status: z.literal("accepted") }).strict(),
      },
      async (
        input: ThothLoopReviewIndependentAssessmentInput,
        context: ThothToolExecutionContext,
      ) => {
        if (!callerAgentId) {
          throw new Error(
            "thoth_loop_submit_review_independent_assessment requires an agent-scoped caller",
          );
        }
        const planExecBrief = options.taskToolGateway?.submitReviewAssessment(
          callerAgentId,
          input,
          resolveRuntimeToolCallContext(context).turnId,
        );
        if (!planExecBrief) {
          throw new Error("No active Thoth Loop Review phase is waiting for this assessment");
        }
        return {
          content: [{ type: "text", text: planExecBrief }],
          structuredContent: { ok: true, status: "accepted" },
        };
      },
    );
    registerTool(
      "thoth_loop_submit_review_verdict",
      {
        title: "Submit Thoth Loop Review verdict",
        description:
          "Submit the independent Review verdict for the current Thoth background Loop goal. Pass advances; continue or reframe supplies the next Direction Memo for the same goal.",
        inputSchema: ThothLoopReviewVerdictInputSchema,
        outputSchema: z.object({ ok: z.boolean(), status: z.literal("accepted") }).strict(),
      },
      async (input: ThothLoopReviewVerdictInput, context: ThothToolExecutionContext) => {
        if (!callerAgentId) {
          throw new Error("thoth_loop_submit_review_verdict requires an agent-scoped caller");
        }
        const runtimeToolContext = resolveRuntimeToolCallContext(context);
        if (
          !options.taskToolGateway?.submitReviewVerdict(
            callerAgentId,
            input,
            runtimeToolContext.turnId,
            runtimeToolContext.callId,
          )
        ) {
          throw new Error("No active Thoth Loop Review phase is waiting for this agent");
        }
        return {
          content: [
            {
              type: "text",
              text: "Review verdict accepted by Thoth Loop. Stop this Review session now.",
            },
          ],
          structuredContent: { ok: true, status: "accepted" },
        };
      },
    );
  }

  if (enableLoopRuntimeTools) {
    registerTool(
      "thoth_loop_report_blocked",
      {
        title: "Report Thoth Loop blocked state",
        description:
          "Report that the current background Loop phase is blocked by a real external condition or user-owned decision.",
        inputSchema: ThothLoopReportBlockedInputSchema,
        outputSchema: z.object({ ok: z.boolean(), status: z.literal("blocked") }).strict(),
      },
      async (input: ThothLoopReportBlockedInput, context: ThothToolExecutionContext) => {
        if (!callerAgentId) {
          throw new Error("thoth_loop_report_blocked requires an agent-scoped caller");
        }
        if (
          !options.taskToolGateway?.reportBlocked(
            callerAgentId,
            input,
            resolveRuntimeToolCallContext(context).turnId,
          )
        ) {
          throw new Error("No active Thoth Loop phase is waiting for this agent");
        }
        return {
          content: [{ type: "text", text: `Loop blocked: ${input.reason}` }],
          structuredContent: { ok: true, status: "blocked" },
          isError: true,
        };
      },
    );
  }

  const ProviderModelInputSchema = AgentProviderEnum.trim()
    .refine((value) => value.includes("/"), {
      message: "provider must use provider-id/model-id form",
    })
    .refine(
      (value) => {
        try {
          resolveRequiredProviderModel(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: "provider must use provider-id/model-id form" },
    );
  const ProviderOrProviderModelInputSchema = AgentProviderEnum.trim()
    .min(1, "provider is required")
    .refine(
      (value) => {
        if (!value.includes("/")) {
          return true;
        }
        try {
          resolveRequiredProviderModel(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: "provider must be a provider ID or provider-id/model-id" },
    );
  const CreateAgentSettingsInputSchema = z
    .object({
      modeId: z.string().optional().describe("Session mode to configure before the first run."),
      thinkingOptionId: z.string().optional().describe("Thinking option ID."),
      features: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Provider-specific feature values defined by the selected provider."),
    })
    .strict();
  const UpdateAgentSettingsInputSchema = z
    .object({
      modeId: z.string().optional().describe("Session mode ID."),
      model: z.string().nullable().optional().describe("Model ID. Pass null to clear."),
      thinkingOptionId: z
        .string()
        .nullable()
        .optional()
        .describe("Thinking option ID. Pass null to clear."),
      features: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Provider-specific feature values defined by the selected provider."),
    })
    .strict();
  const InspectProviderSettingsInputSchema = z
    .object({
      modeId: z.string().optional().describe("Draft session mode ID."),
      model: z.string().optional().describe("Draft model ID."),
      thinkingOptionId: z.string().optional().describe("Draft thinking option ID."),
      features: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Draft provider feature values."),
    })
    .strict();
  const AgentRelationshipInputSchema = z.discriminatedUnion("kind", [
    z
      .object({ kind: z.literal("subagent") })
      .strict()
      .describe("Create a child agent under this agent's subagent track."),
    z
      .object({ kind: z.literal("detached") })
      .strict()
      .describe("Create a root agent that does not appear in this agent's subagent track."),
  ]);
  const AgentCreateWorktreeTargetInputSchema = z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("branch-off"),
        worktreeSlug: z
          .string()
          .min(1)
          .optional()
          .describe("Optional worktree slug/path label. Omit to let Thoth generate one."),
        branchName: z
          .string()
          .min(1)
          .optional()
          .describe("Optional git branch name. Defaults to the worktree slug."),
        baseBranch: z
          .string()
          .min(1)
          .optional()
          .describe("Optional base branch. Defaults to the repository default branch."),
      })
      .strict()
      .describe("Create a new branch in a Thoth-managed worktree."),
    z
      .object({
        kind: z.literal("checkout-branch"),
        branch: z.string().min(1).describe("Existing branch to check out."),
      })
      .strict()
      .describe("Check out an existing branch in a Thoth-managed worktree."),
    z
      .object({
        kind: z.literal("checkout-pr"),
        githubPrNumber: z.number().int().positive().describe("GitHub pull request number."),
      })
      .strict()
      .describe("Check out a GitHub pull request in a Thoth-managed worktree."),
  ]);
  const AgentWorkspaceInputSchema = z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("current"),
        cwd: z.string().optional().describe("Optional runtime cwd. Defaults to the caller's cwd."),
      })
      .strict()
      .describe("Use the caller's current workspace."),
    z
      .object({
        kind: z.literal("existing"),
        workspaceId: z.string().min(1).describe("Existing workspace id to attach the agent to."),
        cwd: z
          .string()
          .optional()
          .describe("Optional runtime cwd. Defaults to the existing workspace cwd."),
      })
      .strict()
      .describe("Attach the agent to an existing workspace."),
    z
      .object({
        kind: z.literal("create"),
        source: z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("directory"),
              path: z
                .string()
                .optional()
                .describe("Optional directory path. Defaults to the caller's cwd."),
            })
            .strict(),
          z
            .object({
              kind: z.literal("worktree"),
              cwd: z
                .string()
                .optional()
                .describe("Optional source repository. Defaults to the caller's cwd."),
              target: AgentCreateWorktreeTargetInputSchema,
            })
            .strict(),
        ]),
      })
      .strict()
      .describe("Create a new workspace for the agent."),
  ]);
  const commonCreateAgentInputSchema = {
    relationship: AgentRelationshipInputSchema.describe(
      "Whether the created agent is a subagent under you or a detached root agent.",
    ),
    workspace: AgentWorkspaceInputSchema.describe(
      "Workspace ownership/location for the created agent.",
    ),
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(60, "Title must be 60 characters or fewer")
      .describe("Short descriptive title (<= 60 chars) summarizing the agent's focus."),
    provider: ProviderModelInputSchema.describe(
      "Required provider/model pair in provider-id/model-id form.",
    ),
    labels: z.record(z.string(), z.string()).optional().describe("Labels to set on the agent"),
    settings: CreateAgentSettingsInputSchema.optional().describe(
      "Initial runtime settings for the new agent.",
    ),
    initialPrompt: z
      .string()
      .trim()
      .min(1, "initialPrompt is required")
      .describe("Required first task to run immediately after creation."),
  };
  const agentToAgentInputSchema = {
    ...commonCreateAgentInputSchema,
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Get notified when the created agent finishes, errors, or needs permission. Set false only for truly fire-and-forget agents.",
      ),
  };
  const canonicalTopLevelInputSchema = {
    ...commonCreateAgentInputSchema,
    background: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Run agent in background. If false (default), waits for completion or permission request. If true, returns immediately.",
      ),
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Agent-scoped only: get notified when the created agent finishes, errors, or needs permission.",
      ),
  };
  const legacyTopLevelCreateAgentInputSchema = {
    relationship: commonCreateAgentInputSchema.relationship.optional(),
    workspace: commonCreateAgentInputSchema.workspace.optional(),
    cwd: z
      .string()
      .optional()
      .describe("Legacy top-level working directory. Prefer workspace.source.path."),
    mode: z.string().optional().describe("Legacy session mode ID. Prefer settings.modeId."),
    thinking: z
      .string()
      .optional()
      .describe("Legacy thinking option ID. Prefer settings.thinkingOptionId."),
    features: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Legacy feature values. Prefer settings.features."),
    worktreeName: z
      .string()
      .min(1)
      .optional()
      .describe("Legacy worktree slug. Prefer workspace.source.target.worktreeSlug."),
    branchName: z
      .string()
      .min(1)
      .optional()
      .describe("Legacy branch name. Prefer workspace.source.target.branchName."),
    baseBranch: z
      .string()
      .min(1)
      .optional()
      .describe("Legacy base branch. Prefer workspace.source.target.baseBranch."),
    refName: z
      .string()
      .min(1)
      .optional()
      .describe("Legacy branch/ref to check out. Prefer workspace.source.target.branch."),
    githubPrNumber: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Legacy GitHub PR number. Prefer workspace.source.target.githubPrNumber."),
  };
  const topLevelInputSchema = {
    ...canonicalTopLevelInputSchema,
    ...legacyTopLevelCreateAgentInputSchema,
  };

  const createAgentInputSchema = callerAgentId ? agentToAgentInputSchema : topLevelInputSchema;
  const agentToAgentCreateAgentArgsSchema = z.object(agentToAgentInputSchema).strict();
  const canonicalTopLevelCreateAgentArgsSchema = z.object(canonicalTopLevelInputSchema).strict();
  const topLevelCreateAgentArgsSchema = z.object(topLevelInputSchema).strict();
  const commonSendAgentPromptInputSchema = {
    agentId: z.string(),
    prompt: z.string(),
    sessionMode: z.string().optional().describe("Optional mode to set before running the prompt."),
  };
  const agentToAgentSendAgentPromptInputSchema = {
    ...commonSendAgentPromptInputSchema,
    background: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Run agent in background. Agent-scoped default is true so you can continue until the finish notification arrives. Set false only when you need a blocking response.",
      ),
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Get notified when the prompted agent finishes, errors, or needs permission. Set false only for truly fire-and-forget prompts.",
      ),
  };
  const topLevelSendAgentPromptInputSchema = {
    ...commonSendAgentPromptInputSchema,
    background: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Run agent in background. If false (default), waits for completion or permission request. If true, returns immediately.",
      ),
    notifyOnFinish: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Agent-scoped only: get notified when the prompted agent finishes, errors, or needs permission.",
      ),
  };
  const sendAgentPromptInputSchema = callerAgentId
    ? agentToAgentSendAgentPromptInputSchema
    : topLevelSendAgentPromptInputSchema;
  const inspectProviderInputSchema = {
    provider: ProviderOrProviderModelInputSchema.describe(
      "Provider ID, optionally followed by a model ID in provider-id/model-id form.",
    ),
    cwd: z
      .string()
      .optional()
      .describe("Working directory used to resolve provider feature availability."),
    settings: InspectProviderSettingsInputSchema.optional().describe(
      "Draft provider settings used to compute available features.",
    ),
  };
  type AgentToAgentCreateAgentArgs = z.infer<typeof agentToAgentCreateAgentArgsSchema>;
  type TopLevelCreateAgentArgs = z.infer<typeof canonicalTopLevelCreateAgentArgsSchema>;
  type TopLevelCreateAgentToolArgs = z.infer<typeof topLevelCreateAgentArgsSchema>;

  registerTool(
    "create_agent",
    {
      title: "Create agent",
      description:
        "Create an agent. Requires relationship, workspace, provider/model, and an initial prompt. Do not guess; call list_providers and list_models first if uncertain.",
      inputSchema: createAgentInputSchema,
      outputSchema: {
        agentId: z.string(),
        type: AgentProviderEnum,
        status: AgentStatusEnum,
        cwd: z.string(),
        workspaceId: z.string().optional(),
        currentModeId: z.string().nullable(),
        availableModes: z.array(ProviderModeSchema),
        lastMessage: z.string().nullable().optional(),
        permission: AgentPermissionRequestPayloadSchema.nullable().optional(),
        guidance: z.string().optional(),
      },
    },
    async (args: unknown) => {
      const resolvedArgs = await resolveCreateAgentToolArgs(args);
      const { parsedArgs, worktree } = resolvedArgs;
      let requestedBackground: boolean;
      let notifyOnFinish: boolean;
      let detached: boolean;
      if (resolvedArgs.kind === "agent-scoped") {
        requestedBackground = true;
        notifyOnFinish = parsedArgs.notifyOnFinish;
        detached = resolvedArgs.relationship.kind === "detached";
      } else {
        requestedBackground = resolvedArgs.parsedArgs.background;
        notifyOnFinish = resolvedArgs.parsedArgs.notifyOnFinish ?? false;
        detached = resolvedArgs.parsedArgs.relationship.kind === "detached";
      }
      const {
        snapshot,
        background: createdInBackground,
        initialPromptStarted,
      } = await createAgentCommand(
        {
          agentManager,
          agentStorage,
          logger: childLogger,
          thothHome: options.thothHome,
          worktreesRoot: options.worktreesRoot,
          terminalManager,
          providerSnapshotManager,
          createThothWorktree: options.createThothWorktree,
          ...(options.ensureWorkspaceForCreate
            ? { ensureWorkspaceForCreate: options.ensureWorkspaceForCreate }
            : {}),
        },
        {
          kind: "mcp",
          provider: parsedArgs.provider,
          title: parsedArgs.title,
          initialPrompt: parsedArgs.initialPrompt,
          cwd: resolvedArgs.cwd,
          workspaceId: resolvedArgs.workspaceId,
          thinking: parsedArgs.settings?.thinkingOptionId,
          features: parsedArgs.settings?.features,
          labels: parsedArgs.labels,
          mode: parsedArgs.settings?.modeId,
          background: requestedBackground,
          notifyOnFinish,
          detached,
          callerAgentId,
          worktree,
        },
      );

      try {
        if (!createdInBackground && initialPromptStarted) {
          const result = await waitForAgentWithTimeout(agentManager, snapshot.id, {
            waitForActive: true,
          });

          const liveSnapshot = agentManager.getAgent(snapshot.id) ?? snapshot;
          const responseData = {
            agentId: snapshot.id,
            type: snapshot.provider,
            status: result.status,
            cwd: liveSnapshot.cwd,
            ...(liveSnapshot.workspaceId ? { workspaceId: liveSnapshot.workspaceId } : {}),
            currentModeId: liveSnapshot.currentModeId,
            availableModes: liveSnapshot.availableModes,
            lastMessage: result.lastMessage,
            permission: sanitizePermissionRequest(result.permission),
          };
          const validJson = ensureValidJson(responseData);

          const response = {
            content: [],
            structuredContent: validJson,
          };
          return response;
        }
      } catch (error) {
        childLogger.error({ err: error, agentId: snapshot.id }, "Failed to run initial prompt");
        throw error;
      }

      // Return immediately for async creation.
      const currentSnapshot = agentManager.getAgent(snapshot.id) ?? snapshot;
      const guidance =
        callerAgentId && notifyOnFinish && initialPromptStarted
          ? "You will get notified when the created agent finishes, errors, or needs permission. Do not call wait_for_agent or poll for status; continue with other work until the notification arrives."
          : undefined;
      const response = {
        content: [],
        structuredContent: ensureValidJson({
          agentId: currentSnapshot.id,
          type: snapshot.provider,
          status: currentSnapshot.lifecycle,
          cwd: currentSnapshot.cwd,
          ...(currentSnapshot.workspaceId ? { workspaceId: currentSnapshot.workspaceId } : {}),
          currentModeId: currentSnapshot.currentModeId,
          availableModes: currentSnapshot.availableModes,
          lastMessage: null,
          permission: null,
          ...(guidance ? { guidance } : {}),
        }),
      };
      return response;
    },
  );

  type ResolvedCreateAgentToolArgs =
    | {
        kind: "agent-scoped";
        parsedArgs: AgentToAgentCreateAgentArgs;
        relationship: AgentToAgentCreateAgentArgs["relationship"];
        cwd: string | undefined;
        workspaceId: string | undefined;
        worktree: CreateAgentFromMcpInput["worktree"];
      }
    | {
        kind: "top-level";
        parsedArgs: TopLevelCreateAgentArgs;
        cwd: string | undefined;
        workspaceId: string | undefined;
        worktree: CreateAgentFromMcpInput["worktree"];
      };

  async function resolveCreateAgentToolArgs(args: unknown): Promise<ResolvedCreateAgentToolArgs> {
    if (callerAgentId) {
      const parsed = agentToAgentCreateAgentArgsSchema.parse(args);
      const { cwd, workspaceId, worktree } = await resolveCreateAgentWorkspace(parsed.workspace);
      return {
        kind: "agent-scoped",
        parsedArgs: parsed,
        relationship: parsed.relationship,
        cwd,
        workspaceId,
        worktree,
      };
    }
    const parsedArgs = normalizeTopLevelCreateAgentArgs(topLevelCreateAgentArgsSchema.parse(args));
    if (parsedArgs.relationship.kind === "subagent") {
      throw new Error("relationship subagent requires an agent-scoped tool session");
    }
    const { cwd, workspaceId, worktree } = await resolveCreateAgentWorkspace(parsedArgs.workspace);
    return {
      kind: "top-level",
      parsedArgs,
      cwd,
      workspaceId,
      worktree,
    };
  }

  function normalizeTopLevelCreateAgentArgs(
    args: TopLevelCreateAgentToolArgs,
  ): TopLevelCreateAgentArgs {
    const {
      cwd,
      mode,
      thinking,
      features,
      worktreeName,
      branchName,
      baseBranch,
      refName,
      githubPrNumber,
      ...canonicalCandidate
    } = args;
    const settings = {
      ...canonicalCandidate.settings,
      ...(mode ? { modeId: mode } : {}),
      ...(thinking ? { thinkingOptionId: thinking } : {}),
      ...(features ? { features } : {}),
    };

    if (canonicalCandidate.relationship && canonicalCandidate.workspace) {
      return canonicalTopLevelCreateAgentArgsSchema.parse({
        ...canonicalCandidate,
        ...(Object.keys(settings).length > 0 ? { settings } : {}),
      });
    }

    if (canonicalCandidate.relationship || canonicalCandidate.workspace) {
      throw new Error("relationship and workspace must be provided together");
    }

    if (!cwd?.trim()) {
      throw new Error("cwd is required for legacy top-level create_agent calls");
    }

    const legacyWorktreeTarget = resolveLegacyCreateAgentWorktreeTarget({
      worktreeName,
      branchName,
      baseBranch,
      refName,
      githubPrNumber,
    });
    const workspace = legacyWorktreeTarget
      ? {
          kind: "create" as const,
          source: {
            kind: "worktree" as const,
            cwd,
            target: legacyWorktreeTarget,
          },
        }
      : {
          kind: "create" as const,
          source: {
            kind: "directory" as const,
            path: cwd,
          },
        };

    return canonicalTopLevelCreateAgentArgsSchema.parse({
      ...canonicalCandidate,
      relationship: { kind: "detached" },
      workspace,
      ...(Object.keys(settings).length > 0 ? { settings } : {}),
    });
  }

  function resolveLegacyCreateAgentWorktreeTarget(input: {
    worktreeName?: string;
    branchName?: string;
    baseBranch?: string;
    refName?: string;
    githubPrNumber?: number;
  }): z.infer<typeof AgentCreateWorktreeTargetInputSchema> | null {
    if (input.githubPrNumber !== undefined) {
      return {
        kind: "checkout-pr",
        githubPrNumber: input.githubPrNumber,
      };
    }

    if (input.refName) {
      return {
        kind: "checkout-branch",
        branch: input.refName,
      };
    }

    if (input.worktreeName || input.branchName || input.baseBranch) {
      return {
        kind: "branch-off",
        worktreeSlug: input.worktreeName,
        branchName: input.branchName,
        baseBranch: input.baseBranch,
      };
    }

    return null;
  }

  async function resolveCreateAgentWorkspace(
    workspace: AgentToAgentCreateAgentArgs["workspace"] | TopLevelCreateAgentArgs["workspace"],
  ): Promise<{
    cwd: string | undefined;
    workspaceId: string | undefined;
    worktree: CreateAgentFromMcpInput["worktree"];
  }> {
    if (workspace.kind === "current") {
      if (!callerAgentId) {
        throw new Error("workspace current requires an agent-scoped tool session");
      }
      const callerAgent = resolveCallerAgent();
      if (!callerAgent?.workspaceId) {
        throw new Error(`Caller agent ${callerAgentId} has no current workspace`);
      }
      return {
        cwd: workspace.cwd,
        workspaceId: callerAgent.workspaceId,
        worktree: undefined,
      };
    }

    if (workspace.kind === "existing") {
      if (!options.listActiveWorkspaces) {
        throw new Error("Workspace lookup is not configured");
      }
      const existingWorkspace = (await options.listActiveWorkspaces()).find(
        (candidate) => candidate.workspaceId === workspace.workspaceId,
      );
      if (!existingWorkspace) {
        throw new Error(`Workspace ${workspace.workspaceId} not found`);
      }
      const cwd = workspace.cwd
        ? resolveScopedCwd(workspace.cwd, { required: true })
        : existingWorkspace.cwd;
      return {
        cwd,
        workspaceId: workspace.workspaceId,
        worktree: undefined,
      };
    }

    if (workspace.source.kind === "directory") {
      const cwd = resolveScopedCwd(workspace.source.path, { required: true });
      if (!options.ensureWorkspaceForCreate) {
        throw new Error("Workspace creation is not configured");
      }
      return {
        cwd,
        workspaceId: await options.ensureWorkspaceForCreate(cwd),
        worktree: undefined,
      };
    }

    const cwd = resolveScopedCwd(workspace.source.cwd, { required: true });
    return {
      cwd,
      workspaceId: undefined,
      worktree: resolveCreateAgentWorktree(workspace.source.target),
    };
  }

  function resolveCreateAgentWorktree(
    target: z.infer<typeof AgentCreateWorktreeTargetInputSchema>,
  ): NonNullable<CreateAgentFromMcpInput["worktree"]> {
    switch (target.kind) {
      case "branch-off":
        return {
          action: "branch-off",
          worktreeName: target.worktreeSlug,
          branchName: target.branchName,
          baseBranch: target.baseBranch,
        };
      case "checkout-branch":
        return {
          action: "checkout",
          refName: target.branch,
        };
      case "checkout-pr":
        return {
          action: "checkout",
          githubPrNumber: target.githubPrNumber,
        };
      default:
        throw new Error("unreachable");
    }
  }

  registerTool(
    "wait_for_agent",
    {
      title: "Wait for agent",
      description:
        "Block until the agent requests permission or the current run completes. Returns the pending permission (if any) and recent activity summary.",
      inputSchema: {
        agentId: z.string().describe("Agent identifier returned by the create_agent tool"),
      },
      outputSchema: {
        agentId: z.string(),
        status: AgentStatusEnum,
        permission: AgentPermissionRequestPayloadSchema.nullable(),
        lastMessage: z.string().nullable(),
      },
    },
    async ({ agentId }, { signal }) => {
      const abortController = new AbortController();
      const cleanupFns: Array<() => void> = [];

      const cleanup = () => {
        while (cleanupFns.length) {
          const fn = cleanupFns.pop();
          try {
            fn?.();
          } catch {
            // ignore cleanup errors
          }
        }
      };

      const forwardExternalAbort = () => {
        if (!abortController.signal.aborted) {
          const reason = signal?.reason ?? new Error("wait_for_agent aborted");
          abortController.abort(reason);
        }
      };

      if (signal) {
        if (signal.aborted) {
          forwardExternalAbort();
        } else {
          signal.addEventListener("abort", forwardExternalAbort, { once: true });
          cleanupFns.push(() => signal.removeEventListener("abort", forwardExternalAbort));
        }
      }

      const unregister = waitTracker.register(agentId, (reason) => {
        if (!abortController.signal.aborted) {
          abortController.abort(new Error(reason ?? "wait_for_agent cancelled"));
        }
      });
      cleanupFns.push(unregister);

      try {
        const result: WaitForAgentResult = await waitForAgentWithTimeout(agentManager, agentId, {
          signal: abortController.signal,
        });

        const validJson = ensureValidJson({
          agentId,
          status: result.status,
          permission: sanitizePermissionRequest(result.permission),
          lastMessage: result.lastMessage,
        });

        const response = {
          content: [],
          structuredContent: validJson,
        };
        return response;
      } finally {
        cleanup();
      }
    },
  );

  registerTool(
    "send_agent_prompt",
    {
      title: "Send agent prompt",
      description:
        "Send a task to a running agent. Agent-scoped callers run in background by default; top-level callers wait by default.",
      inputSchema: sendAgentPromptInputSchema,
      outputSchema: {
        success: z.boolean(),
        status: AgentStatusEnum,
        lastMessage: z.string().nullable().optional(),
        permission: AgentPermissionRequestPayloadSchema.nullable().optional(),
        guidance: z.string().optional(),
      },
    },
    async ({
      agentId,
      prompt,
      sessionMode,
      background = Boolean(callerAgentId),
      notifyOnFinish = Boolean(callerAgentId),
    }) => {
      if (agentManager.hasInFlightRun(agentId)) {
        waitTracker.cancel(agentId, "Agent run interrupted by new prompt");
      }
      const shouldNotifyOnFinish = Boolean(callerAgentId && notifyOnFinish && background);

      await sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId,
        prompt,
        sessionMode,
        logger: childLogger,
      });

      if (shouldNotifyOnFinish && callerAgentId) {
        setupFinishNotification({
          agentManager,
          agentStorage,
          childAgentId: agentId,
          callerAgentId,
          logger: childLogger,
        });
      }

      // If not running in background, wait for completion
      if (!background) {
        const result = await waitForAgentWithTimeout(agentManager, agentId, {
          waitForActive: true,
        });

        const responseData = {
          success: true,
          status: result.status,
          lastMessage: result.lastMessage,
          permission: sanitizePermissionRequest(result.permission),
        };
        const validJson = ensureValidJson(responseData);

        const response = {
          content: [],
          structuredContent: validJson,
        };
        return response;
      }

      // Return immediately if background=true
      // Re-fetch snapshot since the state may have changed
      const currentSnapshot = agentManager.getAgent(agentId);

      const responseData = {
        success: true,
        status: currentSnapshot?.lifecycle ?? "idle",
        lastMessage: null,
        permission: null,
        ...(shouldNotifyOnFinish
          ? {
              guidance:
                "You will get notified when the prompted agent finishes, errors, or needs permission. Do not call wait_for_agent or poll for status; continue with other work until the notification arrives.",
            }
          : {}),
      };
      const validJson = ensureValidJson(responseData);

      const response = {
        content: [],
        structuredContent: validJson,
      };
      return response;
    },
  );

  registerTool(
    "get_agent_status",
    {
      title: "Get agent status",
      description:
        "Return the latest snapshot for an agent, including lifecycle state, capabilities, and pending permissions.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        status: AgentStatusEnum,
        snapshot: AgentSnapshotPayloadSchema,
      },
    },
    async ({ agentId }) => {
      const snapshot = agentManager.getAgent(agentId);
      if (snapshot) {
        const structuredSnapshot = await serializeSnapshotWithMetadata(
          agentStorage,
          snapshot,
          childLogger,
        );
        return {
          content: [],
          structuredContent: ensureValidJson({
            status: snapshot.lifecycle,
            snapshot: structuredSnapshot,
          }),
        };
      }

      const record = await agentStorage.get(agentId);
      if (!record || record.internal) {
        throw new Error(`Agent ${agentId} not found`);
      }

      const structuredSnapshot = buildStoredAgentPayload(
        record,
        new Set(providerSnapshotManager.listRegisteredProviderIds()),
      );
      return {
        content: [],
        structuredContent: ensureValidJson({
          status: structuredSnapshot.status,
          snapshot: structuredSnapshot,
        }),
      };
    },
  );

  registerTool(
    "list_agents",
    {
      title: "List agents",
      description: "List recent agents as compact metadata.",
      inputSchema: {
        includeArchived: z.boolean().optional().default(false),
        sinceHours: z
          .number()
          .int()
          .positive()
          .max(24 * 30)
          .optional()
          .default(48),
        statuses: z.array(AgentStatusEnum).optional(),
        limit: z.number().int().positive().max(200).optional().default(50),
      },
      outputSchema: {
        agents: z.array(AgentListItemPayloadSchema),
      },
    },
    async ({ includeArchived = false, cwd, sinceHours = 48, statuses, limit = 50 }) => {
      const callerCwd = callerAgentId ? resolveCallerAgent()?.cwd : undefined;
      const requestedCwd = cwd?.trim() ? expandUserPath(cwd) : callerCwd;
      const statusFilter = statuses && statuses.length > 0 ? new Set(statuses) : null;
      const sinceMs = Date.now() - sinceHours * 60 * 60 * 1000;
      const liveSnapshots = agentManager.listAgents();
      const liveAgents = await Promise.all(
        liveSnapshots.map((snapshot) =>
          serializeSnapshotWithMetadata(agentStorage, snapshot, childLogger),
        ),
      );
      const liveIds = new Set(liveSnapshots.map((snapshot) => snapshot.id));
      const storedRecords = await agentStorage.list();
      const registeredProviderIds = new Set(providerSnapshotManager.listRegisteredProviderIds());
      const storedAgents = storedRecords
        .filter((record) => !record.internal && !liveIds.has(record.id))
        .filter((record) => includeArchived || !record.archivedAt)
        .filter(
          (record) =>
            includeArchived || isStoredAgentProviderAvailable(record, registeredProviderIds),
        )
        .map((record) => buildStoredAgentPayload(record, registeredProviderIds));
      const agents = [...liveAgents, ...storedAgents]
        .map(toAgentListItemPayload)
        .filter((agent) => !requestedCwd || isSameOrDescendantPath(requestedCwd, agent.cwd))
        .filter((agent) => !statusFilter || statusFilter.has(agent.status))
        .filter((agent) => !agent.archivedAt || resolveAgentListActivityTime(agent) >= sinceMs)
        .sort(compareAgentListItems)
        .slice(0, limit);

      return {
        content: [],
        structuredContent: ensureValidJson({ agents }),
      };
    },
  );

  registerTool(
    "cancel_agent",
    {
      title: "Cancel agent run",
      description: "Abort the agent's current run but keep the agent alive for future tasks.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      const { cancelled } = await cancelAgentRunCommand(
        { agentManager, logger: childLogger },
        agentId,
      );
      if (cancelled) {
        waitTracker.cancel(agentId, "Agent run cancelled");
      }
      return {
        content: [],
        structuredContent: ensureValidJson({ success: cancelled }),
      };
    },
  );

  registerTool(
    "archive_agent",
    {
      title: "Archive agent",
      description:
        "Archive an agent (soft-delete). The agent is interrupted if running and removed from the active list.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      await archiveAgentCommand(
        {
          agentManager,
          agentStorage,
          logger: childLogger,
        },
        agentId,
      );
      waitTracker.cancel(agentId, "Agent archived");
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "kill_agent",
    {
      title: "Kill agent",
      description: "Terminate an agent session permanently.",
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId }) => {
      await closeAgentCommand({ agentManager }, agentId);
      waitTracker.cancel(agentId, "Agent terminated");
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "update_agent",
    {
      title: "Update agent",
      description: "Update an agent name, labels, and/or runtime settings.",
      inputSchema: {
        agentId: z.string(),
        name: z.string().optional(),
        labels: z.record(z.string(), z.string()).optional().describe("Labels to set on the agent"),
        settings: UpdateAgentSettingsInputSchema.optional().describe(
          "Runtime settings to apply to the agent.",
        ),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId, name, labels, settings }) => {
      if (settings?.modeId !== undefined) {
        await agentManager.setAgentMode(agentId, settings.modeId);
      }
      if (settings?.model !== undefined) {
        await agentManager.setAgentModel(agentId, settings.model);
      }
      if (settings?.thinkingOptionId !== undefined) {
        await agentManager.setAgentThinkingOption(agentId, settings.thinkingOptionId);
      }
      if (settings?.features) {
        for (const [featureId, value] of Object.entries(settings.features)) {
          await agentManager.setAgentFeature(agentId, featureId, value);
        }
      }

      await updateAgentCommand({ agentManager }, { agentId, name, labels });

      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "list_terminals",
    {
      title: "List terminals",
      description: "List terminals for a working directory or across all working directories.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional working directory. Defaults to your current working directory."),
        all: z.boolean().optional().describe("List terminals across all working directories."),
      },
      outputSchema: {
        terminals: z.array(TerminalSummarySchema),
      },
    },
    async ({ cwd, all }) => {
      if (!terminalManager) {
        throw new Error("Terminal manager is not configured");
      }

      const terminals = all
        ? (
            await Promise.all(
              terminalManager.listDirectories().map(async (directory) =>
                (await terminalManager.getTerminals(directory)).map((terminal) => ({
                  id: terminal.id,
                  name: terminal.name,
                  cwd: terminal.cwd,
                })),
              ),
            )
          ).flat()
        : (await terminalManager.getTerminals(resolveScopedCwd(cwd, { required: true }))).map(
            (terminal) => ({
              id: terminal.id,
              name: terminal.name,
              cwd: terminal.cwd,
            }),
          );

      return {
        content: [],
        structuredContent: ensureValidJson({ terminals }),
      };
    },
  );

  registerTool(
    "create_terminal",
    {
      title: "Create terminal",
      description: "Create a terminal session for a working directory.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional working directory. Defaults to your current working directory."),
        name: z.string().optional().describe("Optional terminal name."),
      },
      outputSchema: TerminalSummarySchema.shape,
    },
    async ({ cwd, name }) => {
      if (!terminalManager) {
        throw new Error("Terminal manager is not configured");
      }

      const resolvedCwd = resolveScopedCwd(cwd, { required: true });
      const workspaceId = await resolveTerminalWorkspaceId(resolvedCwd);

      const terminal = await terminalManager.createTerminal({
        cwd: resolvedCwd,
        workspaceId,
        ...(name?.trim() ? { name: name.trim() } : {}),
      });

      return {
        content: [],
        structuredContent: ensureValidJson({
          id: terminal.id,
          name: terminal.name,
          cwd: terminal.cwd,
        }),
      };
    },
  );

  registerTool(
    "kill_terminal",
    {
      title: "Kill terminal",
      description: "Kill an existing terminal session.",
      inputSchema: {
        terminalId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ terminalId }) => {
      if (!terminalManager) {
        throw new Error("Terminal manager is not configured");
      }

      const terminal = terminalManager.getTerminal(terminalId);
      if (!terminal) {
        throw new Error(`Terminal ${terminalId} not found`);
      }

      terminal.kill();

      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "capture_terminal",
    {
      title: "Capture terminal",
      description: "Capture plain-text terminal output lines from a terminal session.",
      inputSchema: {
        terminalId: z.string(),
        start: z.number().optional(),
        end: z.number().optional(),
        scrollback: z.boolean().optional(),
        stripAnsi: z.boolean().optional().default(true),
      },
      outputSchema: {
        terminalId: z.string(),
        lines: z.array(z.string()),
        totalLines: z.number().int().nonnegative(),
      },
    },
    async ({ terminalId, start, end, scrollback, stripAnsi = true }) => {
      if (!terminalManager) {
        throw new Error("Terminal manager is not configured");
      }

      if (!terminalManager.getTerminal(terminalId)) {
        throw new Error(`Terminal ${terminalId} not found`);
      }

      const capture = await terminalManager.captureTerminal(terminalId, {
        start: scrollback ? 0 : start,
        end,
        stripAnsi,
      });

      return {
        content: [],
        structuredContent: ensureValidJson({
          terminalId,
          lines: capture.lines,
          totalLines: capture.totalLines,
        }),
      };
    },
  );

  registerTool(
    "send_terminal_keys",
    {
      title: "Send terminal keys",
      description: "Send literal text or special key tokens to a terminal session.",
      inputSchema: {
        terminalId: z.string(),
        keys: z.string(),
        literal: z.boolean().optional(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ terminalId, keys, literal = false }) => {
      if (!terminalManager) {
        throw new Error("Terminal manager is not configured");
      }

      const terminal = terminalManager.getTerminal(terminalId);
      if (!terminal) {
        throw new Error(`Terminal ${terminalId} not found`);
      }

      terminal.send({
        type: "input",
        data: resolveTerminalKeyToken(keys, literal),
      });

      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "create_schedule",
    {
      title: "Create schedule",
      description: "Create a recurring schedule that starts a new agent on a cron cadence.",
      inputSchema: {
        prompt: z.string().trim().min(1, "prompt is required"),
        cron: z.string().trim().min(1, "cron is required"),
        timezone: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("IANA time zone for the cron cadence. For example: America/New_York."),
        name: z.string().optional(),
        provider: AgentProviderEnum.optional().describe(
          "Provider, or provider/model in provider-id/model-id form.",
        ),
        cwd: z.string().optional(),
        maxRuns: z.number().int().positive().optional(),
        expiresIn: z.string().optional(),
      },
      outputSchema: ScheduleSummarySchema.shape,
    },
    async ({ prompt, cron, timezone, name, provider, maxRuns, expiresIn }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const expiresAt = buildScheduleExpiry(expiresIn);
      const schedule = await scheduleService.create(resolveScheduleWorkspaceId(), {
        prompt: prompt.trim(),
        cadence: buildCronScheduleCadence({
          cron,
          ...(timezone !== undefined ? { timezone } : {}),
        }),
        target: resolveNewAgentScheduleTarget({ provider }),
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(maxRuns === undefined ? {} : { maxRuns }),
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });

      return {
        content: [],
        structuredContent: ensureValidJson(toScheduleSummary(schedule)),
      };
    },
  );

  registerTool(
    "create_heartbeat",
    {
      title: "Create heartbeat",
      description: "Create a recurring heartbeat that sends you a prompt on a cron cadence.",
      inputSchema: {
        prompt: z.string().trim().min(1, "prompt is required"),
        cron: z.string().trim().min(1, "cron is required"),
        timezone: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("IANA time zone for the cron cadence. For example: America/New_York."),
        name: z.string().optional(),
        maxRuns: z.number().int().positive().optional(),
        expiresIn: z.string().optional(),
      },
      outputSchema: ScheduleSummarySchema.shape,
    },
    async ({ prompt, cron, timezone, name, maxRuns, expiresIn }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }
      if (!callerAgentId) {
        throw new Error("create_heartbeat requires an agent-scoped session");
      }
      resolveCallerAgent();

      const expiresAt = buildScheduleExpiry(expiresIn);
      const schedule = await scheduleService.create(resolveScheduleWorkspaceId(), {
        prompt: prompt.trim(),
        cadence: buildCronScheduleCadence({
          cron,
          ...(timezone !== undefined ? { timezone } : {}),
        }),
        target: { type: "agent", agentId: callerAgentId },
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(maxRuns === undefined ? {} : { maxRuns }),
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });

      return {
        content: [],
        structuredContent: ensureValidJson(toScheduleSummary(schedule)),
      };
    },
  );

  registerTool(
    "list_schedules",
    {
      title: "List schedules",
      description: "List schedules owned by the current Workspace.",
      inputSchema: {},
      outputSchema: {
        schedules: z.array(ScheduleSummarySchema),
      },
    },
    async () => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const schedules = (await scheduleService.list(resolveScheduleWorkspaceId())).map((schedule) =>
        toScheduleSummary(schedule),
      );
      return {
        content: [],
        structuredContent: ensureValidJson({ schedules }),
      };
    },
  );

  registerTool(
    "inspect_schedule",
    {
      title: "Inspect schedule",
      description: "Inspect a schedule and its run history.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: StoredScheduleSchema.shape,
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const schedule = await scheduleService.inspect(resolveScheduleWorkspaceId(), id);
      return {
        content: [],
        structuredContent: ensureValidJson(schedule),
      };
    },
  );

  registerTool(
    "pause_schedule",
    {
      title: "Pause schedule",
      description: "Pause an active schedule.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      await scheduleService.pause(resolveScheduleWorkspaceId(), id);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "resume_schedule",
    {
      title: "Resume schedule",
      description: "Resume a paused schedule.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      await scheduleService.resume(resolveScheduleWorkspaceId(), id);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "delete_schedule",
    {
      title: "Delete schedule",
      description: "Delete a schedule permanently.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      await scheduleService.delete(resolveScheduleWorkspaceId(), id);
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "update_schedule",
    {
      title: "Update schedule",
      description:
        "Update an existing schedule. Only provided fields are changed; omitted fields remain unchanged.",
      inputSchema: {
        id: z.string(),
        every: z.string().optional().describe("New interval duration string (e.g. 5m, 1h)."),
        cron: z.string().optional().describe("New cron expression."),
        timezone: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "IANA time zone for cron cadence; requires cron. For example: America/New_York.",
          ),
        name: z.string().nullable().optional().describe("New name (null to clear)."),
        prompt: z.string().trim().min(1).optional().describe("New prompt text."),
        maxRuns: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("New max runs limit (null to clear)."),
        provider: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("New provider for new-agent target."),
        model: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe("New model for new-agent target (null to clear)."),
        mode: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe("New mode for new-agent target (null to clear)."),
        expiresIn: z
          .string()
          .optional()
          .describe("New relative expiry duration (for example: 1h, 2d)."),
        clearExpires: z.boolean().optional().describe("Clear any schedule expiry."),
      },
      outputSchema: StoredScheduleSchema.shape,
    },
    async (input) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const schedule = await scheduleService.update(
        resolveScheduleWorkspaceId(),
        buildScheduleUpdateInput(input),
      );

      return {
        content: [],
        structuredContent: ensureValidJson(schedule),
      };
    },
  );

  registerTool(
    "schedule_logs",
    {
      title: "Schedule logs",
      description: "Get the run history (logs) for a schedule.",
      inputSchema: {
        id: z.string(),
      },
      outputSchema: {
        runs: z.array(ScheduleRunSchema),
      },
    },
    async ({ id }) => {
      if (!scheduleService) {
        throw new Error("Schedule service is not configured");
      }

      const runs = await scheduleService.logs(resolveScheduleWorkspaceId(), id);
      return {
        content: [],
        structuredContent: ensureValidJson({ runs }),
      };
    },
  );

  registerTool(
    "list_providers",
    {
      title: "List providers",
      description: "List configured agent providers, availability, and their modes.",
      inputSchema: {},
      outputSchema: {
        providers: z.array(ProviderSummarySchema),
      },
    },
    async () => {
      const providers = (await providerSnapshotManager.listProviders({ wait: true })).map(
        toProviderSummary,
      );
      return {
        content: [],
        structuredContent: ensureValidJson({ providers }),
      };
    },
  );

  registerTool(
    "list_models",
    {
      title: "List models",
      description: "List models for an agent provider.",
      inputSchema: {
        provider: AgentProviderEnum,
      },
      outputSchema: {
        provider: z.string(),
        models: z.array(AgentModelSchema),
      },
    },
    async ({ provider }) => {
      const models = await providerSnapshotManager.listModels({
        provider,
        wait: true,
      });
      return {
        content: [],
        structuredContent: ensureValidJson({
          provider,
          models,
        }),
      };
    },
  );

  registerTool(
    "inspect_provider",
    {
      title: "Inspect provider",
      description:
        "Inspect compact provider capabilities for orchestration, including modes and draft feature settings. Use list_models for the full model list.",
      inputSchema: inspectProviderInputSchema,
      outputSchema: {
        provider: AgentProviderEnum,
        label: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        enabled: z.boolean(),
        status: z.string(),
        modes: z.array(ProviderModeSchema).nullish(),
        selectedModel: z.string().nullable(),
        features: z.array(AgentFeatureSchema),
      },
    },
    async ({ provider, cwd, settings }) => {
      const resolvedProviderModel = resolveScheduleProviderAndModel({
        provider,
        defaultProvider: provider,
      });
      const providerId = resolvedProviderModel.provider;
      const resolvedCwd = resolveScopedCwd(cwd, { required: true });
      const entry = await providerSnapshotManager.getProvider({
        cwd: resolvedCwd,
        provider: providerId,
        wait: true,
      });
      const summary = toProviderSummary(entry);
      if (!entry.enabled) {
        throw new Error(`Provider '${providerId}' is disabled`);
      }
      if (entry.status !== "ready") {
        throw new Error(entry.error ?? `Provider '${providerId}' is unavailable`);
      }
      const selectedModel = settings?.model ?? resolvedProviderModel.model;
      const features = await agentManager.listDraftFeatures({
        provider: providerId,
        cwd: resolvedCwd,
        ...(settings?.modeId ? { modeId: settings.modeId } : {}),
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(settings?.thinkingOptionId ? { thinkingOptionId: settings.thinkingOptionId } : {}),
        ...(settings?.features ? { featureValues: settings.features } : {}),
      });
      return {
        content: [],
        structuredContent: ensureValidJson({
          provider: providerId,
          label: summary.label,
          description: summary.description,
          enabled: summary.enabled,
          status: summary.status,
          modes: summary.modes,
          selectedModel: selectedModel ?? null,
          features,
        }),
      };
    },
  );

  registerTool(
    "list_worktrees",
    {
      title: "List worktrees",
      description: "List Thoth-managed git worktrees for a repository.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional repository cwd. Defaults to your current working directory."),
      },
      outputSchema: {
        worktrees: z.array(WorktreeSummarySchema),
      },
    },
    async ({ cwd }) => {
      const resolvedCwd = resolveScopedCwd(cwd, { required: true });
      if (!options.workspaceGitService) {
        throw new Error("WorkspaceGitService is required to list worktrees");
      }
      const worktrees = await listThothWorktreesCommand(
        { workspaceGitService: options.workspaceGitService },
        {
          cwd: resolvedCwd,
          reason: "mcp:list-worktrees",
        },
      );

      return {
        content: [],
        structuredContent: ensureValidJson({ worktrees }),
      };
    },
  );

  registerTool(
    "create_worktree",
    {
      title: "Create worktree",
      description:
        "Create a Thoth-managed git worktree. Branch off a new branch, check out an existing branch, or check out a GitHub PR.",
      inputSchema: {
        cwd: z.string().optional().describe("Repository directory. Defaults to the agent's cwd."),
        target: AgentCreateWorktreeTargetInputSchema.describe("What the worktree should contain."),
      },
      outputSchema: {
        branchName: z.string(),
        worktreePath: z.string(),
        workspaceId: z.string(),
      },
    },
    async ({ cwd, target }) => {
      const repoRoot = resolveScopedCwd(cwd, { required: true });
      const commandResult = await createThothWorktreeCommand(
        {
          thothHome: options.thothHome,
          worktreesRoot: options.worktreesRoot,
          createThothWorktreeWorkflow: options.createThothWorktree,
        },
        createMcpWorktreeCommandInput(repoRoot, target),
      );
      if (!commandResult.ok) {
        throw new WorktreeRequestError(commandResult.error);
      }
      const { worktree, workspace } = commandResult.createdWorktree;
      await options.workspaceGitService?.listWorktrees?.(repoRoot, {
        force: true,
        reason: "mcp:create-worktree",
      });

      return {
        content: [],
        structuredContent: ensureValidJson({
          branchName: worktree.branchName,
          worktreePath: worktree.worktreePath,
          workspaceId: workspace.workspaceId,
        }),
      };
    },
  );

  registerTool(
    "archive_worktree",
    {
      title: "Archive worktree",
      description: "Delete a Thoth-managed git worktree.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional repository cwd. Defaults to your current working directory."),
        worktreePath: z.string().optional(),
        worktreeSlug: z.string().optional(),
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ cwd, worktreePath, worktreeSlug }) => {
      const resolvedCwd = resolveScopedCwd(cwd, { required: true });
      if (!worktreePath && !worktreeSlug) {
        throw new Error("worktreePath or worktreeSlug is required");
      }
      if (!options.workspaceGitService) {
        throw new Error("WorkspaceGitService is required to archive worktrees");
      }
      const repoRoot = await options.workspaceGitService.resolveRepoRoot(resolvedCwd);

      const result = await archiveCommand(
        archiveWorktreeDependencies(options, {
          agentManager,
          agentStorage,
          terminalManager: terminalManager ?? null,
          logger: childLogger,
        }),
        {
          requestId: "mcp:archive_worktree",
          repoRoot,
          worktreePath,
          worktreeSlug,
          // This tool archives every workspace on the directory, then removes the
          // directory. Disk removal is derived from scope + last-reference.
          scope: "worktree",
        },
      );
      if (!result.ok) {
        throw new Error(result.message);
      }
      await options.workspaceGitService.listWorktrees(repoRoot, {
        force: true,
        reason: "mcp:archive-worktree",
      });

      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  registerTool(
    "get_agent_activity",
    {
      title: "Get agent activity",
      description: "Return recent agent timeline entries as a curated summary.",
      inputSchema: {
        agentId: z.string(),
        limit: z
          .number()
          .optional()
          .describe("Optional limit for number of activities to include (most recent first)."),
      },
      outputSchema: {
        agentId: z.string(),
        updateCount: z.number(),
        currentModeId: z.string().nullable(),
        content: z.string(),
      },
    },
    async ({ agentId, limit }) => {
      await ensureAgentLoaded(agentId, {
        agentManager,
        agentStorage,
        logger: childLogger,
      });
      const timeline = agentManager.getTimeline(agentId);
      const snapshot = agentManager.getAgent(agentId);

      const selection = selectItemsByProjectedLimit({
        items: timeline,
        direction: "tail",
        limit: limit ?? 0,
      });
      const curatedContent = curateAgentActivity(selection.items);
      const { totalProjected, shownProjected } = selection;

      const noun = totalProjected === 1 ? "activity" : "activities";
      const countHeader =
        limit && shownProjected < totalProjected
          ? `Showing ${shownProjected} of ${totalProjected} ${noun} (limited to ${limit})`
          : `Showing all ${totalProjected} ${noun}`;

      const contentWithCount = `${countHeader}\n\n${curatedContent}`;

      return {
        content: [],
        structuredContent: ensureValidJson({
          agentId,
          updateCount: timeline.length,
          currentModeId: snapshot?.currentModeId ?? null,
          content: contentWithCount,
        }),
      };
    },
  );

  registerTool(
    "set_agent_mode",
    {
      title: "Set agent session mode",
      description:
        "Switch the agent's session mode (plan, bypassPermissions, read-only, auto, etc.).",
      inputSchema: {
        agentId: z.string(),
        modeId: z.string(),
      },
      outputSchema: {
        success: z.boolean(),
        newMode: z.string(),
      },
    },
    async ({ agentId, modeId }) => {
      const result = await setAgentModeCommand({ agentManager }, { agentId, modeId });
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true, newMode: result.modeId }),
      };
    },
  );

  registerTool(
    "list_pending_permissions",
    {
      title: "List pending permissions",
      description:
        "Return all pending permission requests across all agents with the normalized payloads.",
      inputSchema: {},
      outputSchema: {
        permissions: z.array(
          z.object({
            agentId: z.string(),
            status: AgentStatusEnum,
            request: AgentPermissionRequestPayloadSchema,
          }),
        ),
      },
    },
    async () => {
      const permissions = agentManager.listAgents().flatMap((agent) => {
        const payload = toAgentPayload(agent);
        return payload.pendingPermissions.map((request) => ({
          agentId: agent.id,
          status: payload.status,
          request: sanitizePermissionRequest(request),
        }));
      });

      return {
        content: [],
        structuredContent: ensureValidJson({ permissions }),
      };
    },
  );

  registerTool(
    "respond_to_permission",
    {
      title: "Respond to permission",
      description:
        "Approve or deny a pending permission request with an AgentManager-compatible response payload.",
      inputSchema: {
        agentId: z.string(),
        requestId: z.string(),
        response: AgentPermissionResponseSchema,
      },
      outputSchema: {
        success: z.boolean(),
      },
    },
    async ({ agentId, requestId, response }) => {
      await respondToAgentPermission({
        agentManager,
        agentId,
        requestId,
        response,
        logger: childLogger,
      });
      return {
        content: [],
        structuredContent: ensureValidJson({ success: true }),
      };
    },
  );

  return toCatalog();
}

type McpCreateWorktreeTarget =
  | { kind: "branch-off"; worktreeSlug?: string; branchName?: string; baseBranch?: string }
  | { kind: "checkout-branch"; branch: string }
  | { kind: "checkout-pr"; githubPrNumber: number };

interface ArchiveWorktreeCommandContext {
  agentManager: AgentManager;
  agentStorage: AgentRegistry;
  terminalManager: TerminalManager | null;
  logger: Logger;
}

function archiveWorktreeDependencies(
  options: ThothToolHostDependencies,
  context: ArchiveWorktreeCommandContext,
): ArchiveCommandDependencies {
  if (!options.github) {
    throw new Error("GitHub service is required to archive worktrees");
  }
  if (!options.workspaceGitService) {
    throw new Error("WorkspaceGitService is required to archive worktrees");
  }
  if (!options.archiveWorkspaceRecord) {
    throw new Error("Workspace registry archiver is required to archive worktrees");
  }
  if (!options.findWorkspaceIdForCwd) {
    throw new Error("Workspace resolver is required to archive worktrees");
  }
  if (!options.listActiveWorkspaces) {
    throw new Error("Active workspace lister is required to archive worktrees");
  }
  if (!options.emitWorkspaceUpdatesForWorkspaceIds) {
    throw new Error("Workspace update emitter is required to archive worktrees");
  }
  if (!options.markWorkspaceArchiving) {
    throw new Error("Workspace archiving marker is required to archive worktrees");
  }
  if (!options.clearWorkspaceArchiving) {
    throw new Error("Workspace archiving clearer is required to archive worktrees");
  }
  return {
    thothHome: options.thothHome,
    thothWorktreesBaseRoot: options.worktreesRoot,
    github: options.github,
    workspaceGitService: options.workspaceGitService,
    agentManager: context.agentManager,
    agentStorage: context.agentStorage,
    findWorkspaceIdForCwd: options.findWorkspaceIdForCwd,
    listActiveWorkspaces: options.listActiveWorkspaces,
    archiveWorkspaceRecord: options.archiveWorkspaceRecord,
    emitWorkspaceUpdatesForWorkspaceIds: options.emitWorkspaceUpdatesForWorkspaceIds,
    markWorkspaceArchiving: options.markWorkspaceArchiving,
    clearWorkspaceArchiving: options.clearWorkspaceArchiving,
    killTerminalsForWorkspace: (workspaceId: string) =>
      killTerminalsForWorkspace(
        {
          terminalManager: context.terminalManager,
          sessionLogger: context.logger,
        },
        workspaceId,
      ),
    sessionLogger: context.logger,
  };
}

function createMcpWorktreeCommandInput(
  repoRoot: string,
  target: McpCreateWorktreeTarget,
): CreateThothWorktreeCommandInput {
  const base = { cwd: repoRoot } as const;
  switch (target.kind) {
    case "branch-off":
      return {
        ...base,
        worktreeSlug: target.worktreeSlug,
        branchName: target.branchName,
        action: "branch-off",
        ...(target.baseBranch ? { refName: target.baseBranch } : {}),
      };
    case "checkout-branch":
      return { ...base, action: "checkout", refName: target.branch };
    case "checkout-pr":
      return { ...base, action: "checkout", githubPrNumber: target.githubPrNumber };
    default:
      throw new Error("unreachable");
  }
}
