import type { Options as ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentProviderNotice,
  ProviderPlanCompleted,
  ProviderPlanProgress,
  ProviderPlanStep,
  ProviderQuestionItem,
  ProviderQuestionOption,
  ProviderQuestionProjection,
  ProviderQuestionResolution,
} from "@thoth/protocol/agent-types";
import type { AgentAttachment } from "@thoth/protocol/messages";
import type { TaskProjection } from "@thoth/protocol/task-authority";
import type {
  ThothClarifyCardModel,
  ThothIntentContractCardModel,
} from "@thoth/protocol/thoth/rpc-schemas";
import type { ThothToolCatalog } from "./tools/types.js";
import type { HarnessCapabilities } from "../../harness/index.js";
import type { ProviderPlanCapability, ProviderRunMode } from "@thoth/protocol/provider-control";

export type {
  AgentProviderNotice,
  ProviderPlanCompleted,
  ProviderPlanProgress,
  ProviderPlanStep,
  ProviderQuestionItem,
  ProviderQuestionOption,
  ProviderQuestionProjection,
  ProviderQuestionResolution,
};

export type AgentProvider = string;

export interface AgentMetadata {
  [key: string]: unknown;
}

/**
 * Stdio-based MCP server (spawns a subprocess).
 */
export interface McpStdioServerConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /**
   * When true, all tools from this server are always included in the prompt
   * and never deferred behind tool search. Honored by the Claude provider.
   */
  alwaysLoad?: boolean;
}

/**
 * HTTP-based MCP server.
 */
export interface McpHttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  /**
   * When true, all tools from this server are always included in the prompt
   * and never deferred behind tool search. Honored by the Claude provider.
   */
  alwaysLoad?: boolean;
}

/**
 * SSE-based MCP server (Server-Sent Events over HTTP).
 */
export interface McpSseServerConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  /**
   * When true, all tools from this server are always included in the prompt
   * and never deferred behind tool search. Honored by the Claude provider.
   */
  alwaysLoad?: boolean;
}

/**
 * Canonical MCP server configuration.
 * Discriminated union by `type` field.
 * Each provider normalizes this to their expected format.
 */
export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpSseServerConfig;

export interface AgentMode {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  colorTier?: string;
  isUnattended?: boolean;
}

export type ProviderStatus = "ready" | "loading" | "error" | "unavailable";

export interface AgentModelDefinition {
  provider: AgentProvider;
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  metadata?: AgentMetadata;
  thinkingOptions?: AgentSelectOption[];
  defaultThinkingOptionId?: string;
  contextWindowMaxTokens?: number;
}

export interface AgentSelectOption {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  metadata?: AgentMetadata;
}

export function normalizeAgentModelDefinition(model: AgentModelDefinition): AgentModelDefinition {
  const defaultThinkingOptionId =
    model.defaultThinkingOptionId ?? model.thinkingOptions?.find((option) => option.isDefault)?.id;
  if (!defaultThinkingOptionId || defaultThinkingOptionId === model.defaultThinkingOptionId) {
    return model;
  }
  return { ...model, defaultThinkingOptionId };
}

export interface ProviderSnapshotEntry {
  provider: AgentProvider;
  status: ProviderStatus;
  enabled: boolean;
  error?: string;
  models?: AgentModelDefinition[];
  modes?: AgentMode[];
  fetchedAt?: string;
  label?: string;
  description?: string;
  defaultModeId?: string | null;
  source?: "builtin" | "custom";
  deletable?: boolean;
  planCapability?: import("@thoth/protocol/provider-control").ProviderPlanCapability;
}

export interface AgentCreateConfigParent {
  provider: AgentProvider;
  modeId: string | null;
  isUnattended: boolean;
}

export interface ResolveAgentCreateConfigInput {
  provider: AgentProvider;
  requestedMode: string | undefined;
  featureValues: Record<string, unknown> | undefined;
  parent: AgentCreateConfigParent | null;
  unattended: boolean;
  availableModes: AgentMode[] | undefined;
  defaultModeId?: string | null;
}

export interface ResolveAgentCreateConfigResult {
  modeId: string | undefined;
  featureValues: Record<string, unknown> | undefined;
}

export interface AgentCreateConfigUnattendedInput {
  modeId: string | null;
  config: AgentSessionConfig;
  features?: AgentFeature[];
  availableModes: AgentMode[];
}

export interface AgentFeatureToggle {
  type: "toggle";
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  value: boolean;
}

export interface AgentFeatureSelect {
  type: "select";
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  value: string | null;
  options: AgentSelectOption[];
}

export type AgentFeature = AgentFeatureToggle | AgentFeatureSelect;

export interface AgentCapabilityFlags {
  [capability: string]: boolean | undefined;
  supportsStreaming: boolean;
  supportsSessionPersistence: boolean;
  supportsSessionListing?: boolean;
  supportsDynamicModes: boolean;
  supportsMcpServers: boolean;
  supportsReasoningStream: boolean;
  supportsToolInvocations: boolean;
  supportsRewindConversation?: boolean;
  supportsRewindFiles?: boolean;
  supportsRewindBoth?: boolean;
}

export interface AgentPersistenceHandle {
  provider: AgentProvider;
  sessionId: string;
  /** Provider specific handle (Codex thread id, Claude resume token, etc). */
  nativeHandle?: string;
  metadata?: AgentMetadata;
}

export type ProviderRewindScope = "conversation" | "files" | "both";

/** Adapter-owned, versioned receipt. The opaque anchor is never interpreted outside the adapter. */
export interface ProviderMessageAnchorReceipt {
  version: 1;
  opaqueAnchor: string;
}

export type AgentPromptContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | AgentAttachment;

export type AgentPromptInput = string | AgentPromptContentBlock[];

export interface AgentRunOptions {
  outputSchema?: unknown;
  resumeFrom?: AgentPersistenceHandle;
  maxThinkingTokens?: number;
  messageId?: string;
  runtimeBundleActivation?: import("../../harness/types.js").RuntimeBundleActivation | null;
}

export interface AgentUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  contextWindowMaxTokens?: number;
  contextWindowUsedTokens?: number;
}

export const TOOL_CALL_ICON_NAMES = [
  "wrench",
  "square_terminal",
  "eye",
  "pencil",
  "search",
  "bot",
  "sparkles",
  "brain",
  "mic_vocal",
] as const;

export type ToolCallIconName = (typeof TOOL_CALL_ICON_NAMES)[number];

export type ToolCallDetail =
  | {
      type: "shell";
      command: string;
      cwd?: string;
      output?: string;
      exitCode?: number | null;
    }
  | {
      type: "read";
      filePath: string;
      content?: string;
      offset?: number;
      limit?: number;
    }
  | {
      type: "edit";
      filePath: string;
      oldString?: string;
      newString?: string;
      unifiedDiff?: string;
    }
  | {
      type: "write";
      filePath: string;
      content?: string;
    }
  | {
      type: "search";
      query: string;
      toolName?: "search" | "grep" | "glob" | "web_search";
      content?: string;
      filePaths?: string[];
      webResults?: Array<{
        title: string;
        url: string;
      }>;
      annotations?: string[];
      numFiles?: number;
      numMatches?: number;
      durationMs?: number;
      durationSeconds?: number;
      truncated?: boolean;
      mode?: "content" | "files_with_matches" | "count";
    }
  | {
      type: "fetch";
      url: string;
      prompt?: string;
      result?: string;
      code?: number;
      codeText?: string;
      bytes?: number;
      durationMs?: number;
    }
  | {
      type: "worktree_setup";
      worktreePath: string;
      branchName: string;
      log: string;
      commands: Array<{
        index: number;
        command: string;
        cwd: string;
        log: string;
        status: "running" | "completed" | "failed";
        exitCode: number | null;
        durationMs?: number;
      }>;
      truncated?: boolean;
    }
  | {
      type: "sub_agent";
      subAgentType?: string;
      description?: string;
      childSessionId?: string;
      log: string;
      actions?: Array<{
        index: number;
        toolName: string;
        summary?: string;
      }>;
    }
  | {
      type: "plain_text";
      label?: string;
      text?: string;
      icon?: ToolCallIconName;
    }
  | {
      type: "plan";
      text: string;
    }
  | {
      type: "unknown";
      input: unknown;
      output: unknown;
    };

export interface AgentTimelineContentTruncationReceipt {
  truncated: true;
  encoding: "utf-8";
  strategy: "prefix";
  originalBytes: number;
  retainedBytes: number;
  limitBytes: number;
}

interface ToolCallBase {
  [key: string]: unknown;
  type: "tool_call";
  callId: string;
  name: string;
  detail: ToolCallDetail;
  metadata?: Record<string, unknown> & {
    contentTruncation?: AgentTimelineContentTruncationReceipt;
  };
}

type ToolCallRunningTimelineItem = ToolCallBase & {
  status: "running";
  error: null;
};

type ToolCallCompletedTimelineItem = ToolCallBase & {
  status: "completed";
  error: null;
};

type ToolCallFailedTimelineItem = ToolCallBase & {
  status: "failed";
  error: unknown;
};

type ToolCallCanceledTimelineItem = ToolCallBase & {
  status: "canceled";
  error: null;
};

export type ToolCallTimelineItem =
  | ToolCallRunningTimelineItem
  | ToolCallCompletedTimelineItem
  | ToolCallFailedTimelineItem
  | ToolCallCanceledTimelineItem;

export interface CompactionTimelineItem {
  [key: string]: unknown;
  type: "compaction";
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
}

export type AgentTimelineItem =
  | { type: "user_message"; text: string; messageId?: string }
  | { type: "assistant_message"; text: string; messageId?: string }
  | { type: "reasoning"; text: string }
  | { type: "clarify_card"; card: ThothClarifyCardModel }
  | { type: "intent_contract_card"; card: ThothIntentContractCardModel }
  | {
      type: "legacy_execution_plan";
      title: string;
      summary: string;
      items: Array<{
        title: string;
        outcome: string;
        objective: string;
        constraints: string[];
        acceptance: string[];
      }>;
    }
  | { type: "registered_task"; task: TaskProjection }
  | ToolCallTimelineItem
  | { type: "todo"; items: { text: string; completed: boolean }[] }
  | { type: "error"; message: string }
  | CompactionTimelineItem;

export type AgentStreamEvent = (
  | { type: "thread_started"; sessionId: string; provider: AgentProvider }
  | { type: "turn_started"; provider: AgentProvider; turnId?: string }
  | { type: "turn_completed"; provider: AgentProvider; usage?: AgentUsage; turnId?: string }
  | { type: "usage_updated"; provider: AgentProvider; usage: AgentUsage; turnId?: string }
  | {
      type: "mode_changed";
      provider: AgentProvider;
      currentModeId: string | null;
      availableModes: AgentMode[];
    }
  | { type: "model_changed"; provider: AgentProvider; runtimeInfo: AgentRuntimeInfo }
  | {
      type: "thinking_option_changed";
      provider: AgentProvider;
      thinkingOptionId: string | null;
    }
  | {
      type: "turn_failed";
      provider: AgentProvider;
      error: string;
      code?: string;
      diagnostic?: string;
      turnId?: string;
    }
  | { type: "turn_canceled"; provider: AgentProvider; reason: string; turnId?: string }
  | {
      type: "timeline";
      item: AgentTimelineItem;
      provider: AgentProvider;
      turnId?: string;
      timestamp?: string;
    }
  | {
      type: "permission_requested";
      provider: AgentProvider;
      request: AgentPermissionRequest;
      turnId?: string;
    }
  | {
      type: "permission_resolved";
      provider: AgentProvider;
      requestId: string;
      resolution: AgentPermissionResponse;
      turnId?: string;
    }
  | {
      type: "provider_plan_progress";
      provider: AgentProvider;
      progress: ProviderPlanProgress;
      turnId?: string;
    }
  | {
      type: "provider_plan_completed";
      provider: AgentProvider;
      plan: ProviderPlanCompleted;
      turnId?: string;
    }
  | {
      type: "provider_question_requested";
      provider: AgentProvider;
      question: ProviderQuestionProjection;
      turnId?: string;
    }
  | {
      type: "provider_question_resolved";
      provider: AgentProvider;
      interactionId: string;
      status: "answered" | "dismissed" | "expired";
      turnId?: string;
    }
  | {
      type: "attention_required";
      provider: AgentProvider;
      reason: "finished" | "error" | "permission";
      timestamp: string;
    }
) & {
  /**
   * Provider-native turn correlation id. `turnId` remains the daemon stream
   * lifecycle id, which may be synthesized before a provider returns its own
   * id. Loop authority uses this field only to fence native runtime-tool calls.
   */
  providerTurnId?: string;
};

export function getAgentStreamEventTurnId(event: AgentStreamEvent): string | undefined {
  return "turnId" in event ? event.turnId : undefined;
}

export function getAgentStreamEventProviderTurnId(event: AgentStreamEvent): string | undefined {
  return event.providerTurnId;
}

export type AgentPermissionRequestKind = "tool" | "plan" | "question" | "mode" | "other";

export type AgentPermissionUpdate = AgentMetadata;

export interface AgentPermissionAction {
  id: string;
  label: string;
  behavior: "allow" | "deny";
  variant?: "primary" | "secondary" | "danger";
  intent?: "implement" | "implement_resume" | "dismiss";
}

export interface AgentPermissionRequest {
  id: string;
  provider: AgentProvider;
  name: string;
  kind: AgentPermissionRequestKind;
  title?: string;
  description?: string;
  input?: AgentMetadata;
  detail?: ToolCallDetail;
  suggestions?: AgentPermissionUpdate[];
  actions?: AgentPermissionAction[];
  metadata?: AgentMetadata;
}

export type AgentPermissionResponse =
  | {
      behavior: "allow";
      selectedActionId?: string;
      updatedInput?: AgentMetadata;
      updatedPermissions?: AgentPermissionUpdate[];
    }
  | {
      behavior: "deny";
      selectedActionId?: string;
      message?: string;
      interrupt?: boolean;
    };

export interface AgentRunResult {
  sessionId: string;
  finalText: string;
  usage?: AgentUsage;
  timeline: AgentTimelineItem[];
  canceled?: boolean;
}

export interface AgentRuntimeInfo {
  provider: AgentProvider;
  sessionId: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
  modeId?: string | null;
  extra?: AgentMetadata;
}

export type AgentSlashCommandKind = "command" | "skill";

/**
 * Represents a slash command available in an agent session.
 * Commands are executed by sending them as prompts with / prefix.
 */
export interface AgentSlashCommand {
  name: string;
  description: string;
  argumentHint: string;
  kind?: AgentSlashCommandKind;
}

export interface ListImportableSessionsOptions {
  limit?: number;
  /**
   * Optional cwd hint. Providers that can cheaply pre-filter importable
   * sessions by working directory should do so before doing expensive work.
   */
  cwd?: string;
}

export interface ImportableProviderSession {
  providerHandleId: string;
  cwd: string;
  title: string | null;
  firstPromptPreview: string | null;
  lastPromptPreview: string | null;
  lastActivityAt: Date;
}

export interface ImportProviderSessionInput {
  providerHandleId: string;
  cwd: string;
}

export interface ImportProviderSessionContext {
  config: AgentSessionConfig;
  storedConfig: AgentSessionConfig;
  launchContext?: AgentLaunchContext;
}

export interface ImportedTimelineEntry {
  item: AgentTimelineItem;
  timestamp?: string;
}

export interface ImportedProviderSession {
  session: HarnessThread;
  config: AgentSessionConfig;
  persistence: AgentPersistenceHandle;
  timeline: ImportedTimelineEntry[];
}

export interface AgentSessionConfig {
  provider: AgentProvider;
  cwd: string;
  /**
   * Provider-agnostic system/developer instruction string.
   * Mapped by each provider to its native instruction field.
   */
  systemPrompt?: string;
  /**
   * Daemon-level instructions appended at runtime. This is deliberately not
   * persisted into agent config so daemon setting changes apply cleanly.
   */
  daemonAppendSystemPrompt?: string;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
  title?: string | null;
  approvalPolicy?: string;
  sandboxMode?: string;
  networkAccess?: boolean;
  webSearch?: boolean;
  extra?: AgentMetadata & {
    codex?: AgentMetadata;
    claude?: Partial<ClaudeAgentOptions>;
  };
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Internal agents are hidden from listings and don't trigger notifications.
   * They are used for ephemeral system tasks like commit/PR generation.
   */
  internal?: boolean;
}

export interface AgentLaunchContext {
  agentId?: string;
  env?: Record<string, string>;
  /**
   * Runtime-only internal Thoth tools. This must never be persisted into
   * AgentSessionConfig; providers may adapt it to their native tool surface.
   */
  thothTools?: ThothToolCatalog;
}

export interface AgentCreateSessionOptions {
  /**
   * Whether the provider should leave a durable native session behind.
   * Defaults to true. Providers that cannot honor false should no-op.
   */
  persistSession?: boolean;
}

/**
 * Returned by respondToPermission when the permission resolution requires
 * a follow-up turn (e.g. Codex plan approval → implementation).
 */
export interface AgentPermissionResult {
  followUpPrompt?: AgentPromptInput;
}

export interface AgentProviderRunModeResult {
  capability: ProviderPlanCapability;
  nativeModeId: string | null;
}

export interface HarnessExecutionCapability {
  run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult>;
  startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<{ turnId: string }>;
  subscribe(callback: (event: AgentStreamEvent) => void): () => void;
  streamHistory(): AsyncGenerator<AgentStreamEvent>;
}

export interface HarnessThreadCatalogCapability {
  getRuntimeInfo(): Promise<AgentRuntimeInfo>;
  getAvailableModes(): Promise<AgentMode[]>;
  getCurrentMode(): Promise<string | null>;
  listCommands?(): Promise<AgentSlashCommand[]>;
}

export interface HarnessProviderControlCapability {
  setMode(modeId: string): Promise<void | AgentProviderNotice>;
  getProviderRunModeCapability?(): Promise<ProviderPlanCapability>;
  applyProviderRunMode?(mode: ProviderRunMode): Promise<AgentProviderRunModeResult>;
  setModel?(modelId: string | null): Promise<void>;
  setThinkingOption?(thinkingOptionId: string | null): Promise<void | AgentProviderNotice>;
  setFeature?(featureId: string, value: unknown): Promise<void>;
}

export interface HarnessPermissionCapability {
  getPendingPermissions(): AgentPermissionRequest[];
  respondToPermission(
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void>;
  respondToProviderQuestion?(
    interactionId: string,
    resolution: ProviderQuestionResolution,
  ): Promise<void>;
}

export interface HarnessThreadLifecycleCapability {
  describePersistence(): AgentPersistenceHandle | null;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface HarnessRewindCapability {
  revertConversation?(input: { anchor: ProviderMessageAnchorReceipt }): Promise<void>;
  revertFiles?(input: { anchor: ProviderMessageAnchorReceipt }): Promise<void>;
  revertBoth?(input: { anchor: ProviderMessageAnchorReceipt }): Promise<void>;
  listRewindAnchors?(): Promise<ProviderMessageAnchorReceipt[]>;
}

export interface HarnessThread
  extends
    HarnessExecutionCapability,
    HarnessThreadCatalogCapability,
    HarnessProviderControlCapability,
    HarnessPermissionCapability,
    HarnessThreadLifecycleCapability,
    HarnessRewindCapability {
  readonly provider: AgentProvider;
  readonly id: string | null;
  readonly capabilities: AgentCapabilityFlags;
  readonly features?: AgentFeature[];
  tryHandleOutOfBand?(prompt: AgentPromptInput): {
    run(ctx: { emit: (event: AgentStreamEvent) => void }): Promise<void>;
  } | null;
}

export interface ProviderControlLaunchContext {
  env?: Record<string, string>;
}

export type FetchCatalogOptions = (
  | {
      scope: "global";
      force: boolean;
    }
  | {
      scope: "workspace";
      cwd: string;
      force: boolean;
    }
) & {
  timeoutMs?: number;
  launchContext?: ProviderControlLaunchContext;
};

export interface ProviderCatalog {
  models: AgentModelDefinition[];
  modes: AgentMode[];
  defaultModeId?: string | null;
  planCapability?: import("@thoth/protocol/provider-control").ProviderPlanCapability;
}

export interface AgentResumeSessionOptions {
  /**
   * Hydrate persisted history without activating the provider session. This is
   * used for archived agents so opening history remains a read-only operation.
   */
  historyOnly?: boolean;
}

export interface HarnessAvailabilityCapability {
  isAvailable(): Promise<boolean>;
  getDiagnostic?(): Promise<{ diagnostic: string }>;
}

export interface HarnessCatalogCapability {
  fetchCatalog(options: FetchCatalogOptions): Promise<ProviderCatalog>;
  resolveCreateConfig?(input: ResolveAgentCreateConfigInput): ResolveAgentCreateConfigResult;
  isCreateConfigUnattended?(input: AgentCreateConfigUnattendedInput): boolean;
  listCommands?(
    config: AgentSessionConfig,
    launchContext?: ProviderControlLaunchContext,
  ): Promise<AgentSlashCommand[]>;
  listFeatures?(
    config: AgentSessionConfig,
    launchContext?: ProviderControlLaunchContext,
  ): Promise<AgentFeature[]>;
}

export interface HarnessNativeSessionCapability {
  listImportableSessions?(
    options?: ListImportableSessionsOptions,
  ): Promise<ImportableProviderSession[]>;
  importSession?(
    input: ImportProviderSessionInput,
    context: ImportProviderSessionContext,
  ): Promise<ImportedProviderSession>;
  archiveNativeSession?(
    handle: AgentPersistenceHandle,
    launchContext?: ProviderControlLaunchContext,
  ): Promise<void>;
  unarchiveNativeSession?(
    handle: AgentPersistenceHandle,
    launchContext?: ProviderControlLaunchContext,
  ): Promise<void>;
}

export interface HarnessThreadFactoryCapability {
  createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
    options?: AgentCreateSessionOptions,
  ): Promise<HarnessThread>;
  resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
    options?: AgentResumeSessionOptions,
  ): Promise<HarnessThread>;
}

export interface HarnessAdapter
  extends
    HarnessAvailabilityCapability,
    HarnessCatalogCapability,
    HarnessNativeSessionCapability,
    HarnessThreadFactoryCapability {
  readonly provider: AgentProvider;
  readonly harnessCapabilities: HarnessCapabilities;
  readonly capabilities: AgentCapabilityFlags;
  shutdown?(): Promise<void>;
}
