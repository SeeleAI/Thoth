import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import {
  AGENT_LIFECYCLE_STATUSES,
  type AgentLifecycleStatus,
} from "@thoth/protocol/agent-lifecycle";
import {
  getParentAgentIdFromLabels,
  isDelegatedAgent,
  PARENT_AGENT_ID_LABEL,
} from "@thoth/protocol/agent-labels";
import type { Logger } from "pino";
import { z } from "zod";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import type {
  HarnessApprovalRequest,
  HarnessApprovalResolution,
  HarnessCapabilities,
  HarnessExecutionDescriptor,
  HarnessExecutionEvent,
  HarnessExecutionInput,
  HarnessRuntimeToolBinding,
  HarnessThreadDescriptor,
  HarnessThreadInput,
  LegacyHarnessThreadInspection,
  RuntimeAttachmentReceipt,
  RuntimeBundle,
} from "@thoth/drivers/harness";
import type {
  AgentProviderControl,
  ProviderPlanCapability,
  ProviderRunMode,
  ProviderRunModeReceipt,
} from "@thoth/protocol/provider-control";

import {
  getAgentStreamEventTurnId,
  getAgentStreamEventProviderTurnId,
  type AgentCapabilityFlags,
  type HarnessAdapter,
  type AgentCreateSessionOptions,
  type AgentFeature,
  type AgentLaunchContext,
  type AgentSlashCommand,
  type AgentMode,
  type AgentPermissionRequest,
  type AgentPermissionResponse,
  type AgentPermissionResult,
  type AgentPersistenceHandle,
  type AgentProviderNotice,
  type AgentPromptInput,
  type AgentProvider,
  type ProviderMessageAnchorReceipt,
  type ProviderRewindScope,
  type AgentRunOptions,
  type AgentRunResult,
  type HarnessThread,
  type AgentSessionConfig,
  type AgentStreamEvent,
  type AgentTimelineItem,
  type AgentUsage,
  type AgentRuntimeInfo,
  type ImportedTimelineEntry,
  type ImportableProviderSession,
  type ListImportableSessionsOptions,
} from "@thoth/drivers/agent-runtime";
import { buildArchivedAgentRecord, type ArchivedStoredAgentRecord } from "./agent-archive.js";
import type { StoredAgentRecord, AgentRegistry } from "./agent-storage.js";
import {
  InMemoryAgentTimelineStore,
  type SeedAgentTimelineOptions,
} from "./agent-timeline-store.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
} from "@thoth/drivers/internal/server/agent/agent-timeline-store-types";
import {
  AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS,
  AgentStreamCoalescer,
} from "./agent-stream-coalescer.js";
import { ForegroundRunState, type ForegroundTurnWaiter } from "./foreground-run-state.js";
import { invokeRewindCapability, type RewindMode } from "./rewind/rewind.js";
import { isSystemInjectedEnvelope } from "./agent-prompt.js";
import { stripInternalThothMcpServer, withRuntimeThothMcpServer } from "./runtime-mcp-config.js";
import { resolveCreateAgentTitles } from "./create-agent-title.js";
import {
  readThothRuntimeToolsConfig,
  withThothRuntimeTools,
  type ThothRuntimeToolScope,
} from "./thoth-runtime-tools-config.js";
import type { ThothToolCatalogFactory } from "@thoth/drivers/agent-runtime";
import type { ForegroundThothSessionProvisioner } from "./foreground-thoth-session-provisioner.js";
import type { ToolGateway } from "../workspace-authority/tool-gateway.js";
import { limitAgentTimelineItemContent } from "./agent-timeline-content.js";

const RELOAD_SESSION_CLOSE_TIMEOUT_MS = 3_000;
const INTERRUPT_SESSION_TIMEOUT_MS = 2_000;
const HARNESS_TOOL_SCOPES = new Set<ThothRuntimeToolScope>([
  "clarify",
  "clarify_audit",
  "contract_audit",
  "loop_planexec",
  "loop_review",
]);
const STORED_AGENT_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: false,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

type TimeoutResult = "completed" | "timed_out";

export class ExecutionServiceShuttingDownError extends Error {
  constructor() {
    super("Execution service is shutting down");
    this.name = "ExecutionServiceShuttingDownError";
  }
}

export class ProviderUnavailableError extends Error {
  readonly code = "provider_unavailable";

  constructor(
    readonly provider: AgentProvider,
    message: string,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

interface PreparedSessionConfig {
  storedConfig: AgentSessionConfig;
  launchConfig: AgentSessionConfig;
}

interface NormalizeConfigOptions {
  resolveDefaultModel?: boolean;
  allowDefaultModeCatalogLookup?: boolean;
}

interface TimeoutOptions {
  operation: Promise<void>;
  timeoutMs: number;
  onLateError?: (error: unknown) => void;
}

interface ManagedHarnessThread {
  descriptor: HarnessThreadDescriptor;
  input: HarnessThreadInput;
  agentId: string;
  bundle: RuntimeBundle | null;
  tools: HarnessRuntimeToolBinding | null;
  receipt: RuntimeAttachmentReceipt | null;
}

interface ManagedHarnessExecution {
  descriptor: HarnessExecutionDescriptor;
  threadId: string;
  events: HarnessExecutionEvent[];
  subscribers: Set<(event: HarnessExecutionEvent) => void>;
  running: boolean;
  settled: Promise<void>;
  resolveSettled: () => void;
  mode: ProviderRunMode;
  planParts: string[];
  planReady: boolean;
}

interface ManagedHarnessApproval {
  threadId: string;
  executionId: string;
  request: HarnessApprovalRequest;
  synthetic: boolean;
  plan: string | null;
}

function readHarnessToolScope(binding: HarnessRuntimeToolBinding): ThothRuntimeToolScope {
  const catalog = asHarnessRecord(binding.catalog);
  const scope = readHarnessString(catalog?.scope);
  if (!scope || !HARNESS_TOOL_SCOPES.has(scope as ThothRuntimeToolScope)) {
    throw new Error(`Unsupported RuntimeBundle phase scope: ${String(catalog?.scope)}`);
  }
  return scope as ThothRuntimeToolScope;
}

function toHarnessPrompt(input: unknown): AgentPromptInput {
  if (typeof input === "string" || Array.isArray(input)) return input as AgentPromptInput;
  throw new Error("Harness execution prompt must be provider-neutral text or content blocks");
}

function asHarnessRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readHarnessString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readHarnessPlan(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asHarnessRecord(value);
  if (!record) return "";
  if (record.type === "assistant_message") return readHarnessString(record.text) ?? "";
  const detail = asHarnessRecord(record.detail);
  if (detail?.type === "plan") return readHarnessString(detail.text) ?? "";
  const input = asHarnessRecord(record.input);
  const metadata = asHarnessRecord(record.metadata);
  return (
    readHarnessString(record.plan) ??
    readHarnessString(input?.plan) ??
    readHarnessString(metadata?.planText) ??
    readHarnessString(record.text) ??
    ""
  );
}

function toHarnessApproval(request: Record<string, unknown> | null): HarnessApprovalRequest {
  const id = readHarnessString(request?.id);
  if (!id) throw new Error("Provider approval request is missing its identity");
  const providerKind = readHarnessString(request?.kind);
  const kind: HarnessApprovalRequest["kind"] =
    providerKind === "plan"
      ? "implement"
      : providerKind === "command" ||
          providerKind === "file" ||
          providerKind === "tool" ||
          providerKind === "mode"
        ? providerKind
        : providerKind === "question"
          ? "question"
          : "permission";
  return {
    id,
    kind,
    title:
      readHarnessString(request?.title) ?? readHarnessString(request?.name) ?? "Provider approval",
    description: readHarnessString(request?.description),
    displayed: request ?? {},
    autoApproveEligible: kind !== "question",
  };
}

function syntheticHarnessPlanApproval(executionId: string, plan: string): HarnessApprovalRequest {
  return {
    id: `harness-plan-${executionId}`,
    kind: "implement",
    title: "Implement plan",
    description: "The provider completed its native Plan and is ready to implement it.",
    displayed: { plan },
    autoApproveEligible: true,
  };
}

function buildHarnessImplementationPrompt(plan: string): string {
  return [
    "Implement the approved native plan now in this same provider thread.",
    "Preserve the approved task contract, inspect current workspace reality, and verify the result.",
    plan ? `Approved plan:\n${plan}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatProviderList(providers: readonly string[]): string {
  return providers.length > 0 ? providers.join(", ") : "none";
}

function buildStoredAgentConfig(record: StoredAgentRecord): AgentSessionConfig {
  const config: AgentSessionConfig = {
    provider: record.provider,
    cwd: record.cwd,
  };
  if (!record.config) {
    return config;
  }
  if (record.config.modeId != null) config.modeId = record.config.modeId;
  if (record.config.model != null) config.model = record.config.model;
  if (record.config.thinkingOptionId != null) {
    config.thinkingOptionId = record.config.thinkingOptionId;
  }
  if (record.config.featureValues != null) {
    config.featureValues = record.config.featureValues;
  }
  if (record.config.extra != null) config.extra = record.config.extra;
  if (record.config.systemPrompt != null) {
    config.systemPrompt = record.config.systemPrompt;
  }
  if (record.config.mcpServers != null) config.mcpServers = record.config.mcpServers;
  return stripInternalThothMcpServer(config);
}

export { AGENT_LIFECYCLE_STATUSES, type AgentLifecycleStatus };
export type {
  AgentTimelineCursor,
  AgentTimelineFetchDirection,
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineWindow,
} from "@thoth/drivers/internal/server/agent/agent-timeline-store-types";

export type ExecutionServiceEvent =
  | { type: "agent_state"; agent: ManagedAgent }
  | {
      type: "agent_stream";
      agentId: string;
      event: AgentStreamEvent;
      seq?: number;
      epoch?: string;
      timestamp?: string;
    };

export type AgentSubscriber = (event: ExecutionServiceEvent) => void;

export interface SubscribeOptions {
  agentId?: string;
  replayState?: boolean;
}

interface HydrateTimelineOptions {
  force?: boolean;
  broadcast?: boolean;
}

export type ImportablePersistedAgentQueryOptions = ListImportableSessionsOptions & {
  /**
   * When set, only providers in this set are scanned, in addition to the
   * built-in importable allowlist + enabled + non-derived rules.
   */
  providerFilter?: Set<string>;
};

export interface ManagedImportableProviderSession extends ImportableProviderSession {
  provider: AgentProvider;
}

export type AgentAttentionCallback = (params: {
  agentId: string;
  provider: AgentProvider;
  reason: "finished" | "error" | "permission";
}) => void;

export type AgentArchivedCallback = (agentId: string) => Promise<void> | void;

export interface ProviderAvailability {
  provider: AgentProvider;
  available: boolean;
  error: string | null;
}

interface ExecutionRescueTimeouts {
  reloadSessionCloseMs?: number;
  interruptSessionMs?: number;
}

interface ProviderEnabledFlag {
  enabled: boolean;
  derivedFromProviderId?: string | null;
  defaultModeId?: string | null;
  source?: "builtin" | "custom";
  loadAdapter?: () => Promise<HarnessAdapter>;
}
type ProviderEnabledMap = Partial<Record<AgentProvider, ProviderEnabledFlag>>;
type ProviderAdapterMap = Partial<Record<AgentProvider, HarnessAdapter>>;

export interface ExecutionServiceOptions {
  adapters?: ProviderAdapterMap;
  providerDefinitions?: ProviderEnabledMap;
  idFactory?: () => string;
  registry?: AgentRegistry;
  onAgentAttention?: AgentAttentionCallback;
  onWorkspaceStateMayHaveChanged?: (params: { cwd: string }) => void;
  durableTimelineStore?: AgentTimelineStore;
  thothHome?: string;
  terminalManager?: TerminalManager | null;
  mcpBaseUrl?: string;
  mcpAuthToken?: string;
  thothToolsEnabled?: boolean;
  thothToolCatalogFactory?: ThothToolCatalogFactory;
  foregroundThothSessionProvisioner?: ForegroundThothSessionProvisioner;
  appendSystemPrompt?: string;
  agentStreamCoalesceWindowMs?: number;
  rescueTimeouts?: ExecutionRescueTimeouts;
  logger: Logger;
}

export interface WaitForAgentOptions {
  signal?: AbortSignal;
  waitForActive?: boolean;
}

export interface WaitForAgentResult {
  status: AgentLifecycleStatus;
  permission: AgentPermissionRequest | null;
  lastMessage: string | null;
}

export interface WaitForAgentStartOptions {
  signal?: AbortSignal;
}

type AttentionState =
  | { requiresAttention: false }
  | {
      requiresAttention: true;
      attentionReason: "finished" | "error" | "permission";
      attentionTimestamp: Date;
    };

function resolveInitialAttention(input: AttentionState | undefined): AttentionState {
  if (input == null || !input.requiresAttention) {
    return { requiresAttention: false };
  }
  return {
    requiresAttention: true,
    attentionReason: input.attentionReason,
    attentionTimestamp: new Date(input.attentionTimestamp),
  };
}

interface StreamEventFlags {
  shouldDispatchEvent: boolean;
  shouldNotifyWaiters: boolean;
}

interface HandleStreamEventOptions {
  fromHistory?: boolean;
}

interface ManagedAgentBase {
  id: string;
  provider: AgentProvider;
  cwd: string;
  /**
   * Workspace this agent belongs to, stamped at creation. Independent of cwd:
   * cwd answers "where does it run", workspaceId answers "which workspace owns it".
   * Null/undefined for legacy agents created before ownership stamping.
   */
  workspaceId?: string;
  capabilities: AgentCapabilityFlags;
  planCapability?: ProviderPlanCapability;
  providerRunMode: ProviderRunMode;
  providerControlRevision: number;
  config: AgentSessionConfig;
  runtimeInfo?: AgentRuntimeInfo;
  createdAt: Date;
  updatedAt: Date;
  availableModes: AgentMode[];
  features?: AgentFeature[];
  currentModeId: string | null;
  pendingPermissions: Map<string, AgentPermissionRequest>;
  bufferedPermissionResolutions: Map<
    string,
    Extract<AgentStreamEvent, { type: "permission_resolved" }>
  >;
  inFlightPermissionResponses: Set<string>;
  pendingReplacement: boolean;
  persistence: AgentPersistenceHandle | null;
  historyPrimed: boolean;
  lastUserMessageAt: Date | null;
  lastUsage?: AgentUsage;
  lastError?: string;
  attention: AttentionState;
  foregroundTurnWaiters: Set<ForegroundTurnWaiter>;
  finalizedForegroundTurnIds: Set<string>;
  unsubscribeSession: (() => void) | null;
  /**
   * Internal agents are hidden from listings and don't trigger notifications.
   */
  internal?: boolean;
  /**
   * User-defined labels for categorizing agents (e.g., { surface: "workspace" }).
   */
  labels: Record<string, string>;
}

type ManagedAgentWithSession = ManagedAgentBase & {
  session: HarnessThread;
};

type ManagedAgentInitializing = ManagedAgentWithSession & {
  lifecycle: "initializing";
  activeForegroundTurnId: null;
};

type ManagedAgentIdle = ManagedAgentWithSession & {
  lifecycle: "idle";
  activeForegroundTurnId: null;
};

type ManagedAgentRunning = ManagedAgentWithSession & {
  lifecycle: "running";
  activeForegroundTurnId: string | null;
};

type ManagedAgentError = ManagedAgentWithSession & {
  lifecycle: "error";
  activeForegroundTurnId: null;
  lastError: string;
};

type ManagedAgentClosed = ManagedAgentBase & {
  lifecycle: "closed";
  session: null;
  activeForegroundTurnId: null;
};

export type ManagedAgent =
  | ManagedAgentInitializing
  | ManagedAgentIdle
  | ManagedAgentRunning
  | ManagedAgentError
  | ManagedAgentClosed;

export interface AgentMetricsSnapshot {
  total: number;
  byLifecycle: Record<string, number>;
  withActiveForegroundTurn: number;
  timelineStats: {
    totalItems: number;
    maxItemsPerAgent: number;
  };
}

export interface IdleAgentRuntimeCollectionOptions {
  cutoff: Date;
  protectedAgentIds?: ReadonlySet<string> | Iterable<string>;
}

export interface IdleAgentRuntimeCollectionResult {
  examinedAgentCount: number;
  eligibleAgentCount: number;
  releasedAgentIds: string[];
}

interface AgentRuntimeResidencyIndex {
  parentByAgentId: ReadonlyMap<string, string>;
}

interface AgentTreeResidency {
  effectiveActivityAtMs: number;
  hasActiveChildRuntime: boolean;
}

type ActiveManagedAgent =
  | ManagedAgentInitializing
  | ManagedAgentIdle
  | ManagedAgentRunning
  | ManagedAgentError;

type LiveManagedAgent = ActiveManagedAgent;
type AgentLabelPatch = Record<string, string | null>;

interface WriteLabelsResult {
  record: StoredAgentRecord | null;
  live: boolean;
}

interface AgentMetadataPatch {
  title?: string;
  labels?: AgentLabelPatch;
}

const SYSTEM_ERROR_PREFIX = "[System Error]";

function shouldSuppressProviderUserTimelineItem(item: AgentTimelineItem): boolean {
  return item.type === "user_message" && isSystemInjectedEnvelope(item.text);
}

function isStableDaemonUserRow(row: AgentTimelineRow): boolean {
  return (
    row.item.type === "user_message" &&
    typeof row.item.messageId === "string" &&
    row.item.messageId.trim().length > 0
  );
}

function attachPersistenceCwd(
  handle: AgentPersistenceHandle | null,
  cwd: string,
): AgentPersistenceHandle | null {
  if (!handle) {
    return null;
  }
  return {
    ...handle,
    metadata: {
      ...handle.metadata,
      cwd,
    },
  };
}

interface SubscriptionRecord {
  callback: AgentSubscriber;
  agentId: string | null;
}

const BUSY_STATUSES: Set<AgentLifecycleStatus> = new Set(["initializing", "running"]);
const AgentIdSchema = z.guid();

function isAgentBusy(status: AgentLifecycleStatus): boolean {
  return BUSY_STATUSES.has(status);
}

function isTurnTerminalEvent(event: AgentStreamEvent): boolean {
  return (
    event.type === "turn_completed" ||
    event.type === "turn_failed" ||
    event.type === "turn_canceled"
  );
}

function abortMessage(reason: unknown, fallbackMessage: string): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return fallbackMessage;
}

function createAbortError(signal: AbortSignal | undefined, fallbackMessage: string): Error {
  const message = abortMessage(signal?.reason, fallbackMessage);
  return Object.assign(new Error(message), { name: "AbortError" });
}

function validateAgentId(agentId: string, source: string): string {
  const result = AgentIdSchema.safeParse(agentId);
  if (!result.success) {
    throw new Error(`${source}: agentId must be a UUID`);
  }
  return result.data;
}

function applyLabelPatch(
  labels: Record<string, string>,
  patch: AgentLabelPatch,
): Record<string, string> {
  const nextLabels = { ...labels };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete nextLabels[key];
    } else {
      nextLabels[key] = value;
    }
  }
  return nextLabels;
}

function buildExplicitTimelineSeedForRegister(
  now: Date,
  options:
    | {
        timeline?: AgentTimelineItem[];
        timelineRows?: AgentTimelineRow[];
        timelineNextSeq?: number;
        createdAt?: Date;
        updatedAt?: Date;
      }
    | undefined,
): SeedAgentTimelineOptions | null {
  const hasTimeline = Boolean(options?.timeline?.length);
  const hasTimelineRows = Boolean(options?.timelineRows?.length);
  const hasTimelineNextSeq = options?.timelineNextSeq !== undefined;
  if (!hasTimeline && !hasTimelineRows && !hasTimelineNextSeq) {
    return null;
  }
  return {
    items: options?.timeline,
    rows: options?.timelineRows,
    nextSeq: options?.timelineNextSeq,
    timestamp: (options?.updatedAt ?? options?.createdAt ?? now).toISOString(),
  };
}

function buildImportedTimelineRows(entries: readonly ImportedTimelineEntry[]): AgentTimelineRow[] {
  const rows: AgentTimelineRow[] = [];
  for (const entry of entries) {
    if (entry.item.type === "user_message" && isSystemInjectedEnvelope(entry.item.text)) {
      continue;
    }
    rows.push({
      seq: rows.length + 1,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      item: entry.item,
    });
  }
  return rows;
}

function resolveImportedAgentTitle(
  config: AgentSessionConfig,
  timelineRows: readonly AgentTimelineRow[],
): string | null {
  const initialPrompt = getFirstUserMessageTextFromRows(timelineRows);
  if (!initialPrompt) {
    return null;
  }
  const { explicitTitle, provisionalTitle } = resolveCreateAgentTitles({
    configTitle: config.title,
    initialPrompt,
  });
  return explicitTitle ?? provisionalTitle ?? null;
}

function getFirstUserMessageTextFromRows(rows: readonly AgentTimelineRow[]): string | null {
  for (const row of rows) {
    const item = row.item;
    if (item.type !== "user_message") {
      continue;
    }
    const text = item.text.trim();
    if (text) {
      return text;
    }
  }
  return null;
}

export class ExecutionService {
  private readonly adapters = new Map<AgentProvider, HarnessAdapter>();
  private readonly adapterLoads = new Map<AgentProvider, Promise<HarnessAdapter>>();
  private readonly providerDefinitions = new Map<AgentProvider, ProviderEnabledFlag>();
  private readonly harnessThreads = new Map<string, ManagedHarnessThread>();
  private readonly harnessExecutions = new Map<string, ManagedHarnessExecution>();
  private readonly harnessApprovals = new Map<string, ManagedHarnessApproval>();
  private readonly agents = new Map<string, LiveManagedAgent>();
  /**
   * Provider sessions can be pruned or archived independently of Thoth. Keep a
   * read-only projection for their locally journaled timeline instead of making
   * history retrieval depend on provider resume succeeding.
   */
  private readonly historyOnlyAgents = new Map<string, ManagedAgentClosed>();
  private readonly timelineStore = new InMemoryAgentTimelineStore();
  private readonly agentsAwaitingInitialSnapshotPersist = new Set<string>();
  private readonly sessionEventTails = new Map<string, Promise<void>>();
  private readonly canonicalMessageByProviderTurn = new Map<
    string,
    { agentId: string; canonicalMessageId: string }
  >();
  private readonly foregroundRuns = new ForegroundRunState();
  private readonly subscribers = new Set<SubscriptionRecord>();
  private readonly idFactory: () => string;
  private readonly registry?: AgentRegistry;
  private readonly durableTimelineStore?: AgentTimelineStore;
  private readonly previousStatuses = new Map<string, AgentLifecycleStatus>();
  private readonly backgroundTasks = new Set<Promise<void>>();
  private readonly agentRegistrationTasks = new Set<Promise<void>>();
  private readonly agentCloseTasks = new Map<string, Promise<void>>();
  private agentTreeLifecycleTail: Promise<void> = Promise.resolve();
  private readonly agentStreamCoalescer: AgentStreamCoalescer;
  private mcpBaseUrl: string | null;
  private readonly mcpAuthToken: string | null;
  private thothToolsEnabled = true;
  private thothToolCatalogFactory: ThothToolCatalogFactory | null = null;
  private foregroundThothSessionProvisioner: ForegroundThothSessionProvisioner | null = null;
  private toolGateway: ToolGateway | null = null;
  private appendSystemPrompt: string;
  private onAgentAttention?: AgentAttentionCallback;
  private onAgentArchived?: AgentArchivedCallback;
  private onWorkspaceStateMayHaveChanged?: (params: { cwd: string }) => void;
  private logger: Logger;
  private readonly rescueTimeouts: Required<ExecutionRescueTimeouts>;
  private acceptingAgentRegistrations = true;

  constructor(options: ExecutionServiceOptions) {
    this.idFactory = options?.idFactory ?? (() => randomUUID());
    this.registry = options?.registry;
    this.durableTimelineStore = options?.durableTimelineStore;
    this.onAgentAttention = options?.onAgentAttention;
    this.onWorkspaceStateMayHaveChanged = options?.onWorkspaceStateMayHaveChanged;
    this.mcpBaseUrl = options?.mcpBaseUrl ?? null;
    this.mcpAuthToken = options?.mcpAuthToken ?? null;
    this.configureThothTools(options);
    this.appendSystemPrompt = options.appendSystemPrompt ?? "";
    this.logger = options.logger.child({ module: "agent", component: "execution-service" });
    this.rescueTimeouts = {
      reloadSessionCloseMs:
        options.rescueTimeouts?.reloadSessionCloseMs ?? RELOAD_SESSION_CLOSE_TIMEOUT_MS,
      interruptSessionMs:
        options.rescueTimeouts?.interruptSessionMs ?? INTERRUPT_SESSION_TIMEOUT_MS,
    };
    this.agentStreamCoalescer = new AgentStreamCoalescer({
      windowMs: options.agentStreamCoalesceWindowMs ?? AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS,
      timers: { setTimeout, clearTimeout },
      onFlush: ({ agentId, item, provider, turnId }) => {
        const event = this.recordAndDispatchTimelineItem(agentId, item, provider, turnId);
        this.notifyForegroundTurnWaiters(agentId, event);
      },
    });
    this.updateProviderRegistry({
      providerDefinitions: options.providerDefinitions ?? {},
      adapters: options.adapters ?? {},
    });
  }

  prepareForShutdown(): void {
    this.acceptingAgentRegistrations = false;
  }

  private configureThothTools(options: ExecutionServiceOptions): void {
    this.thothToolsEnabled = options.thothToolsEnabled ?? true;
    this.thothToolCatalogFactory = options.thothToolCatalogFactory ?? null;
    this.foregroundThothSessionProvisioner = options.foregroundThothSessionProvisioner ?? null;
  }

  registerAdapter(provider: AgentProvider, adapter: HarnessAdapter): void {
    this.adapters.set(provider, adapter);
  }

  updateProviderRegistry(input: {
    providerDefinitions: ProviderEnabledMap;
    adapters: ProviderAdapterMap;
  }): void {
    this.providerDefinitions.clear();
    this.adapterLoads.clear();
    for (const [provider, definition] of Object.entries(input.providerDefinitions)) {
      if (definition) {
        this.providerDefinitions.set(provider, definition);
      }
    }
    this.adapters.clear();
    for (const [provider, adapter] of Object.entries(input.adapters)) {
      if (adapter) {
        this.adapters.set(provider, adapter);
        if (!this.providerDefinitions.has(provider)) {
          this.providerDefinitions.set(provider, {
            enabled: true,
            derivedFromProviderId: null,
            source: "custom",
            loadAdapter: async () => adapter,
          });
        }
      }
    }
  }

  getRegisteredProviderIds(): AgentProvider[] {
    return Array.from(this.providerDefinitions.keys());
  }

  async getHarnessCapabilities(adapterId: AgentProvider): Promise<HarnessCapabilities> {
    return (await this.loadAdapter(adapterId)).harnessCapabilities;
  }

  async createHarnessThread(
    adapterId: AgentProvider,
    input: HarnessThreadInput,
  ): Promise<HarnessThreadDescriptor> {
    this.assertAcceptingAgentRegistrations();
    const descriptor: HarnessThreadDescriptor = {
      id: `provider-thread-${randomUUID()}`,
      nativeHandle: null,
      adapterId,
      persistence: { agentId: randomUUID() },
    };
    this.harnessThreads.set(descriptor.id, {
      descriptor,
      input,
      agentId: descriptor.persistence!.agentId as string,
      bundle: null,
      tools: null,
      receipt: null,
    });
    return descriptor;
  }

  async resumeHarnessThread(
    adapterId: AgentProvider,
    input: {
      descriptor: HarnessThreadDescriptor;
      workspaceId: string;
      workspacePath: string;
    },
  ): Promise<HarnessThreadDescriptor> {
    this.assertAcceptingAgentRegistrations();
    if (input.descriptor.adapterId !== adapterId) {
      throw new Error("Provider thread belongs to a different HarnessAdapter");
    }
    const current = this.harnessThreads.get(input.descriptor.id);
    if (current) return current.descriptor;
    const persistence = input.descriptor.persistence ?? {};
    const agentId = typeof persistence.agentId === "string" ? persistence.agentId : null;
    const profile = asHarnessRecord(persistence.profile);
    if (!agentId || !profile) throw new Error("Provider thread persistence is incomplete");
    this.harnessThreads.set(input.descriptor.id, {
      descriptor: input.descriptor,
      input: {
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        profile,
        internal: true,
      },
      agentId,
      bundle: null,
      tools: null,
      receipt: null,
    });
    return input.descriptor;
  }

  async attachHarnessRuntimeBundle(
    adapterId: AgentProvider,
    input: {
      thread: HarnessThreadDescriptor;
      bundle: RuntimeBundle;
      tools: HarnessRuntimeToolBinding;
    },
  ): Promise<RuntimeAttachmentReceipt> {
    const thread = this.requireHarnessThread(adapterId, input.thread.id);
    const scope = readHarnessToolScope(input.tools);
    const receipt: RuntimeAttachmentReceipt = {
      id: `runtime-attachment-${randomUUID()}`,
      adapterId,
      threadId: thread.descriptor.id,
      bundleId: input.bundle.id,
      bundleDigest: input.bundle.digest,
      instructionAttachment: "system",
      toolAttachment: input.tools.transport,
      attachedAt: new Date().toISOString(),
    };
    thread.bundle = input.bundle;
    thread.tools = input.tools;
    thread.receipt = receipt;
    thread.descriptor.persistence = {
      ...thread.descriptor.persistence,
      agentId: thread.agentId,
      profile: thread.input.profile,
      workspaceId: thread.input.workspaceId,
      workspacePath: thread.input.workspacePath,
      bundleId: input.bundle.id,
      bundleDigest: input.bundle.digest,
      toolScope: scope,
    };
    return receipt;
  }

  async prepareHarnessRunMode(
    adapterId: AgentProvider,
    input: { thread: HarnessThreadDescriptor; mode: ProviderRunMode },
  ): Promise<ProviderRunModeReceipt> {
    const thread = this.requireHarnessThread(adapterId, input.thread.id);
    await this.ensureHarnessAgent(thread);
    const result = await this.prepareAgentRunMode(thread.agentId, input.mode);
    const failure =
      input.mode === "plan" && result.capability.kind !== "native" ? result.capability : null;
    return {
      id: `provider-mode-${randomUUID()}`,
      requestedMode: input.mode,
      status: failure ? failure.kind : "applied",
      nativeModeId: result.nativeModeId,
      reason: failure?.reason ?? null,
      appliedAt: new Date().toISOString(),
    };
  }

  async startHarnessExecution(
    adapterId: AgentProvider,
    input: { thread: HarnessThreadDescriptor; execution: HarnessExecutionInput },
  ): Promise<HarnessExecutionDescriptor> {
    const thread = this.requireHarnessThread(adapterId, input.thread.id);
    await this.ensureHarnessAgent(thread);
    return this.startHarnessRun(thread, input.execution);
  }

  async continueHarnessExecution(
    adapterId: AgentProvider,
    input: { thread: HarnessThreadDescriptor; execution: HarnessExecutionInput },
  ): Promise<HarnessExecutionDescriptor> {
    const thread = this.requireHarnessThread(adapterId, input.thread.id);
    await this.ensureHarnessAgent(thread);
    const previous = this.harnessExecutions.get(input.execution.executionId);
    if (previous) {
      if (previous.threadId !== thread.descriptor.id) {
        throw new Error(
          `Execution ${input.execution.executionId} belongs to a different provider thread`,
        );
      }
      await previous.settled;
    }
    return this.startHarnessRun(thread, input.execution);
  }

  async resolveHarnessApproval(
    adapterId: AgentProvider,
    input: {
      thread: HarnessThreadDescriptor;
      execution: HarnessExecutionDescriptor;
      approvalId: string;
      decision: "allow" | "deny" | "implement";
    },
  ): Promise<HarnessApprovalResolution> {
    const thread = this.requireHarnessThread(adapterId, input.thread.id);
    const execution = this.harnessExecutions.get(input.execution.id);
    const approval = this.harnessApprovals.get(input.approvalId);
    if (
      !execution ||
      execution.threadId !== thread.descriptor.id ||
      !approval ||
      approval.threadId !== thread.descriptor.id ||
      approval.executionId !== input.execution.id
    ) {
      throw new Error(`Harness approval ${input.approvalId} is not pending for this execution`);
    }

    let followUpPrompt: unknown | null = null;
    if (approval.synthetic) {
      if (input.decision !== "deny") {
        followUpPrompt = buildHarnessImplementationPrompt(approval.plan ?? "");
      }
    } else {
      const result = await this.respondToPermission(thread.agentId, input.approvalId, {
        behavior: input.decision === "deny" ? "deny" : "allow",
        ...(input.decision === "implement" ? { selectedActionId: "implement" } : {}),
      });
      followUpPrompt = result?.followUpPrompt ?? null;
    }

    let runModeReceipt: ProviderRunModeReceipt | null = null;
    if (approval.request.kind === "implement" && input.decision !== "deny") {
      runModeReceipt = await this.prepareHarnessRunMode(adapterId, {
        thread: input.thread,
        mode: "default",
      });
      if (followUpPrompt === null && approval.plan) {
        followUpPrompt = buildHarnessImplementationPrompt(approval.plan);
      }
    }
    this.harnessApprovals.delete(input.approvalId);
    return {
      approvalId: input.approvalId,
      decision: input.decision,
      followUpPrompt,
      runModeReceipt,
    };
  }

  async interruptHarnessExecution(
    adapterId: AgentProvider,
    execution: HarnessExecutionDescriptor,
  ): Promise<void> {
    const state = this.harnessExecutions.get(execution.id);
    if (!state) throw new Error(`Execution ${execution.id} is not active`);
    const thread = this.requireHarnessThread(adapterId, state.threadId);
    try {
      const interrupted = await this.cancelAgentRun(thread.agentId);
      if (!interrupted && state.running) {
        throw new Error(`Provider did not confirm interruption for ${execution.id}`);
      }
    } finally {
      for (const [approvalId, approval] of this.harnessApprovals) {
        if (approval.executionId === execution.id) this.harnessApprovals.delete(approvalId);
      }
    }
  }

  subscribeHarnessEvents(
    adapterId: AgentProvider,
    execution: HarnessExecutionDescriptor,
    callback: (event: HarnessExecutionEvent) => void,
    cursor?: string,
  ): () => void {
    const state = this.harnessExecutions.get(execution.id);
    if (!state) throw new Error(`Execution ${execution.id} is not registered`);
    this.requireHarnessThread(adapterId, state.threadId);
    const cursorIndex = cursor ? Number.parseInt(cursor, 10) : 0;
    for (const event of state.events.slice(Number.isFinite(cursorIndex) ? cursorIndex : 0)) {
      callback(event);
    }
    state.subscribers.add(callback);
    return () => state.subscribers.delete(callback);
  }

  async describeHarnessPersistence(
    adapterId: AgentProvider,
    descriptor: HarnessThreadDescriptor,
  ): Promise<Record<string, unknown> | null> {
    const thread = this.requireHarnessThread(adapterId, descriptor.id);
    const agent = this.getAgent(thread.agentId);
    return {
      ...thread.descriptor.persistence,
      ...(agent?.persistence ? { providerHandle: agent.persistence } : {}),
    };
  }

  async archiveHarnessThread(
    adapterId: AgentProvider,
    descriptor: HarnessThreadDescriptor,
  ): Promise<void> {
    const thread = this.requireHarnessThread(adapterId, descriptor.id);
    if (this.getAgent(thread.agentId)) await this.archiveAgent(thread.agentId);
  }

  async deleteHarnessThread(
    adapterId: AgentProvider,
    descriptor: HarnessThreadDescriptor,
  ): Promise<void> {
    const thread = this.requireHarnessThread(adapterId, descriptor.id);
    if (this.getAgent(thread.agentId)) await this.closeAgent(thread.agentId);
    this.harnessThreads.delete(descriptor.id);
  }

  inspectLegacyHarnessThread(input: {
    legacyRoot: string;
    metadata: Record<string, unknown>;
  }): LegacyHarnessThreadInspection {
    const nativeHandle = readHarnessString(input.metadata.nativeHandle);
    return { resumable: nativeHandle !== null, nativeHandle, metadata: input.metadata };
  }

  async adoptNativeHarnessThread(
    adapterId: AgentProvider,
    input: {
      inspection: LegacyHarnessThreadInspection;
      workspaceId: string;
      workspacePath: string;
    },
  ): Promise<HarnessThreadDescriptor | null> {
    const handle = input.inspection.metadata.providerHandle as AgentPersistenceHandle | undefined;
    if (!input.inspection.resumable || !handle) return null;
    const agentId = randomUUID();
    const agent = await this.resumeAgentFromPersistence(handle, undefined, agentId, {
      workspaceId: input.workspaceId,
      labels: { surface: "background-task" },
    });
    const descriptor: HarnessThreadDescriptor = {
      id: `provider-thread-${randomUUID()}`,
      adapterId,
      nativeHandle: agent.persistence?.nativeHandle ?? agent.persistence?.sessionId ?? null,
      persistence: {
        agentId,
        providerHandle: agent.persistence,
        profile: input.inspection.metadata.profile ?? {},
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
      },
    };
    this.harnessThreads.set(descriptor.id, {
      descriptor,
      input: {
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        profile: asHarnessRecord(input.inspection.metadata.profile) ?? {},
        internal: true,
      },
      agentId,
      bundle: null,
      tools: null,
      receipt: null,
    });
    return descriptor;
  }

  verifyHarnessResume(descriptor: HarnessThreadDescriptor): boolean {
    const thread = this.harnessThreads.get(descriptor.id);
    return thread ? Boolean(this.getAgent(thread.agentId)) : false;
  }

  private requireHarnessThread(adapterId: string, threadId: string): ManagedHarnessThread {
    const thread = this.harnessThreads.get(threadId);
    if (!thread || thread.descriptor.adapterId !== adapterId) {
      throw new Error(`Provider thread ${threadId} is not owned by adapter ${adapterId}`);
    }
    return thread;
  }

  private async ensureHarnessAgent(thread: ManagedHarnessThread): Promise<void> {
    if (this.getAgent(thread.agentId)) return;
    if (!thread.bundle || !thread.tools || !thread.receipt) {
      throw new Error(`Provider thread ${thread.descriptor.id} has no RuntimeBundle receipt`);
    }
    const profile = thread.input.profile as Partial<AgentSessionConfig>;
    const config = withThothRuntimeTools(
      {
        ...profile,
        provider: thread.descriptor.adapterId,
        cwd: thread.input.workspacePath,
        internal: true,
        systemPrompt: [profile.systemPrompt, thread.bundle.instructions]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .join("\n\n"),
      } as AgentSessionConfig,
      { enabled: true, scope: readHarnessToolScope(thread.tools) },
    );
    const providerHandle = thread.descriptor.persistence?.providerHandle as
      | AgentPersistenceHandle
      | null
      | undefined;
    const labels = { surface: "background-task", providerThreadId: thread.descriptor.id };
    const agent = providerHandle
      ? await this.resumeAgentFromPersistence(providerHandle, config, thread.agentId, {
          workspaceId: thread.input.workspaceId,
          labels,
        })
      : await this.createAgent(config, thread.agentId, {
          labels,
          workspaceId: thread.input.workspaceId,
          persistSession: true,
          persistInternal: true,
        });
    thread.descriptor.nativeHandle =
      agent.persistence?.nativeHandle ?? agent.persistence?.sessionId ?? null;
    thread.descriptor.persistence = {
      ...thread.descriptor.persistence,
      providerHandle: agent.persistence,
    };
  }

  private startHarnessRun(
    thread: ManagedHarnessThread,
    execution: HarnessExecutionInput,
  ): HarnessExecutionDescriptor {
    const descriptor: HarnessExecutionDescriptor = {
      id: execution.executionId,
      threadId: thread.descriptor.id,
      nativeTurnId: null,
    };
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolvePromise) => {
      resolveSettled = resolvePromise;
    });
    const state: ManagedHarnessExecution = {
      descriptor,
      threadId: thread.descriptor.id,
      events: [],
      subscribers: new Set(),
      running: true,
      settled,
      resolveSettled,
      mode: execution.runMode,
      planParts: [],
      planReady: false,
    };
    this.harnessExecutions.set(descriptor.id, state);
    void this.consumeHarnessEvents(
      state,
      this.streamAgent(thread.agentId, toHarnessPrompt(execution.prompt)),
    );
    return descriptor;
  }

  private async consumeHarnessEvents(
    state: ManagedHarnessExecution,
    events: AsyncGenerator<AgentStreamEvent>,
  ): Promise<void> {
    try {
      for await (const payload of events) {
        if (payload.type === "turn_started") {
          state.descriptor.nativeTurnId = payload.providerTurnId ?? payload.turnId ?? null;
        }
        this.publishHarnessEvent(state, payload);
      }
    } catch (error) {
      this.publishHarnessEvent(state, {
        type: "turn_failed",
        provider: "harness",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      state.running = false;
      state.resolveSettled();
    }
  }

  private publishHarnessEvent(state: ManagedHarnessExecution, payload: AgentStreamEvent): void {
    const event: HarnessExecutionEvent = {
      id: `execution-event-${randomUUID()}`,
      executionId: state.descriptor.id,
      nativeCursor: String(state.events.length + 1),
      occurredAt: new Date().toISOString(),
      payload,
    };
    for (const normalized of this.normalizeHarnessEvent(state, event)) {
      state.events.push(normalized);
      for (const subscriber of state.subscribers) subscriber(normalized);
    }
  }

  private normalizeHarnessEvent(
    state: ManagedHarnessExecution,
    event: HarnessExecutionEvent,
  ): HarnessExecutionEvent[] {
    const payload = asHarnessRecord(event.payload);
    const type = readHarnessString(payload?.type);
    if (type === "timeline") {
      const plan = readHarnessPlan(payload?.item);
      if (plan) state.planParts.push(plan);
    }
    if (type === "permission_requested") {
      const request = asHarnessRecord(payload?.request);
      if (readHarnessString(request?.kind) === "question") {
        return [{ ...event, control: { type: "provider_question", request: payload?.request } }];
      }
      const approval = toHarnessApproval(request);
      const plan =
        approval.kind === "implement"
          ? readHarnessPlan(approval.displayed) || state.planParts.join("\n\n")
          : null;
      this.harnessApprovals.set(approval.id, {
        threadId: state.threadId,
        executionId: state.descriptor.id,
        request: approval,
        synthetic: false,
        plan,
      });
      if (approval.kind === "implement") {
        state.planReady = Boolean(plan);
        if (!plan) this.harnessApprovals.delete(approval.id);
        return [
          {
            ...event,
            control: plan
              ? { type: "plan_ready", plan, approval }
              : {
                  type: "plan_invalid",
                  reason: "Native Plan completed without usable plan content.",
                },
          },
        ];
      }
      return [{ ...event, control: { type: "approval_requested", approval } }];
    }
    if (type === "turn_completed" && state.mode === "plan" && !state.planReady) {
      const plan = state.planParts
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n\n");
      if (!plan) {
        return [
          {
            ...event,
            control: {
              type: "plan_invalid",
              reason: "Native Plan completed without usable plan content.",
            },
          },
        ];
      }
      const approval = syntheticHarnessPlanApproval(state.descriptor.id, plan);
      state.planReady = true;
      this.harnessApprovals.set(approval.id, {
        threadId: state.threadId,
        executionId: state.descriptor.id,
        request: approval,
        synthetic: true,
        plan,
      });
      return [
        {
          id: `${event.id}:plan-ready`,
          executionId: event.executionId,
          nativeCursor: event.nativeCursor,
          occurredAt: event.occurredAt,
          payload: { type: "harness_plan_ready" },
          control: { type: "plan_ready", plan, approval },
        },
        event,
      ];
    }
    return [event];
  }

  setAgentAttentionCallback(callback: AgentAttentionCallback): void {
    this.onAgentAttention = callback;
  }

  setAgentArchivedCallback(callback: AgentArchivedCallback): void {
    this.onAgentArchived = callback;
  }

  setMcpBaseUrl(url: string | null): void {
    this.mcpBaseUrl = url;
  }

  setThothToolsEnabled(enabled: boolean): void {
    this.thothToolsEnabled = enabled;
  }

  setThothToolCatalogFactory(factory: ThothToolCatalogFactory | null): void {
    this.thothToolCatalogFactory = factory;
  }

  setForegroundThothSessionProvisioner(
    provisioner: ForegroundThothSessionProvisioner | null,
  ): void {
    this.foregroundThothSessionProvisioner = provisioner;
  }

  setToolGateway(gateway: ToolGateway): void {
    this.toolGateway = gateway;
  }

  /**
   * Capability token the daemon's own MCP clients must present to the Agent MCP
   * endpoint when a daemon password is configured. Read by the per-client
   * session to authenticate its own MCP connection. Stays in the daemon — never
   * sent to remote clients.
   */
  getMcpAuthToken(): string | null {
    return this.mcpAuthToken;
  }

  setAppendSystemPrompt(prompt: string | null | undefined): void {
    this.appendSystemPrompt = prompt ?? "";
  }

  public getMetricsSnapshot(): AgentMetricsSnapshot {
    const byLifecycle: Record<string, number> = {};
    let withActiveForegroundTurn = 0;
    let totalItems = 0;
    let maxItemsPerAgent = 0;

    for (const agent of this.agents.values()) {
      byLifecycle[agent.lifecycle] = (byLifecycle[agent.lifecycle] ?? 0) + 1;

      if (agent.activeForegroundTurnId !== null) {
        withActiveForegroundTurn++;
      }

      if (!this.timelineStore.has(agent.id)) {
        continue;
      }

      const len = this.timelineStore.getItems(agent.id).length;
      totalItems += len;
      if (len > maxItemsPerAgent) {
        maxItemsPerAgent = len;
      }
    }

    return {
      total: this.agents.size,
      byLifecycle,
      withActiveForegroundTurn,
      timelineStats: {
        totalItems,
        maxItemsPerAgent,
      },
    };
  }

  private touchUpdatedAt(agent: ManagedAgent): Date {
    const nowMs = Date.now();
    const previousMs = agent.updatedAt.getTime();
    const nextMs = nowMs > previousMs ? nowMs : previousMs + 1;
    const next = new Date(nextMs);
    agent.updatedAt = next;
    return next;
  }

  private nextStoredUpdatedAt(record: StoredAgentRecord): string {
    const previousMs = Date.parse(record.updatedAt);
    const nowMs = Date.now();
    const nextMs = nowMs > previousMs ? nowMs : previousMs + 1;
    return new Date(nextMs).toISOString();
  }

  hasInFlightRun(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    return (
      agent.lifecycle === "running" ||
      Boolean(agent.activeForegroundTurnId) ||
      this.foregroundRuns.hasPendingRun(agentId)
    );
  }

  async waitForAgentClose(agentId: string): Promise<void> {
    while (true) {
      const closeTask = this.agentCloseTasks.get(agentId);
      if (!closeTask) {
        return;
      }
      await closeTask.catch(() => undefined);
    }
  }

  private runAgentTreeLifecycleOperation<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.agentTreeLifecycleTail.then(operation);
    this.agentTreeLifecycleTail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async collectIdleAgentRuntimes(
    options: IdleAgentRuntimeCollectionOptions,
  ): Promise<IdleAgentRuntimeCollectionResult> {
    return this.runAgentTreeLifecycleOperation(() =>
      this.collectIdleAgentRuntimesInternal(options),
    );
  }

  private async collectIdleAgentRuntimesInternal(
    options: IdleAgentRuntimeCollectionOptions,
  ): Promise<IdleAgentRuntimeCollectionResult> {
    await this.drainQueuedSessionEvents();
    this.agentStreamCoalescer.flushAll();
    await this.flush();

    const protectedAgentIds = new Set(options.protectedAgentIds ?? []);
    const examinedAgentCount = this.agents.size;
    const residencyIndex = await this.buildAgentRuntimeResidencyIndex();
    const candidateIds = [...this.agents.values()]
      .filter((agent) =>
        this.isIdleRuntimeCollectionCandidate(
          agent,
          options.cutoff,
          protectedAgentIds,
          residencyIndex,
        ),
      )
      .map((agent) => agent.id)
      .sort((left, right) => {
        const depthDifference =
          this.getManagedAgentTreeDepth(right, residencyIndex) -
          this.getManagedAgentTreeDepth(left, residencyIndex);
        return depthDifference || left.localeCompare(right);
      });
    const releasedAgentIds: string[] = [];

    for (const agentId of candidateIds) {
      let released = false;
      const { task, started } = this.startAgentCloseTask(agentId, async () => {
        let refreshedResidencyIndex = await this.buildAgentRuntimeResidencyIndex();
        await this.drainQueuedSessionEventsForAgentTree(agentId, refreshedResidencyIndex);
        refreshedResidencyIndex = await this.buildAgentRuntimeResidencyIndex();
        const current = this.agents.get(agentId);
        if (
          !current ||
          !this.isIdleRuntimeCollectionCandidate(
            current,
            options.cutoff,
            protectedAgentIds,
            refreshedResidencyIndex,
          )
        ) {
          return;
        }
        await this.releaseIdleAgentRuntime(current);
        released = true;
      });
      await task;
      if (started && released) {
        releasedAgentIds.push(agentId);
      }
    }

    return {
      examinedAgentCount,
      eligibleAgentCount: candidateIds.length,
      releasedAgentIds,
    };
  }

  private isIdleRuntimeCollectionCandidate(
    agent: LiveManagedAgent,
    cutoff: Date,
    protectedAgentIds: ReadonlySet<string>,
    residencyIndex: AgentRuntimeResidencyIndex,
  ): boolean {
    const residency = this.getAgentTreeResidency(agent, residencyIndex);
    return (
      agent.lifecycle === "idle" &&
      !agent.internal &&
      agent.persistence !== null &&
      residency.effectiveActivityAtMs <= cutoff.getTime() &&
      !residency.hasActiveChildRuntime &&
      !protectedAgentIds.has(agent.id) &&
      !agent.pendingReplacement &&
      agent.activeForegroundTurnId === null &&
      agent.pendingPermissions.size === 0 &&
      agent.inFlightPermissionResponses.size === 0 &&
      agent.bufferedPermissionResolutions.size === 0 &&
      !this.foregroundRuns.hasPendingRun(agent.id) &&
      !this.sessionEventTails.has(agent.id)
    );
  }

  private async buildAgentRuntimeResidencyIndex(): Promise<AgentRuntimeResidencyIndex> {
    const parentByAgentId = new Map<string, string>();
    if (this.registry) {
      for (const record of await this.registry.list()) {
        const parentAgentId = getParentAgentIdFromLabels(record.labels);
        if (parentAgentId) {
          parentByAgentId.set(record.id, parentAgentId);
        }
      }
    }
    for (const agent of this.agents.values()) {
      const parentAgentId = getParentAgentIdFromLabels(agent.labels);
      if (parentAgentId) {
        parentByAgentId.set(agent.id, parentAgentId);
      } else {
        parentByAgentId.delete(agent.id);
      }
    }
    return { parentByAgentId };
  }

  private getManagedAgentTreeDepth(
    agentId: string,
    residencyIndex: AgentRuntimeResidencyIndex,
  ): number {
    let depth = 0;
    let currentAgentId = agentId;
    const visited = new Set([agentId]);
    while (true) {
      const parentAgentId = residencyIndex.parentByAgentId.get(currentAgentId);
      if (!parentAgentId || visited.has(parentAgentId)) {
        return depth;
      }
      visited.add(parentAgentId);
      currentAgentId = parentAgentId;
      depth += 1;
    }
  }

  private isManagedAgentDescendant(
    agentId: string,
    ancestorAgentId: string,
    residencyIndex: AgentRuntimeResidencyIndex,
  ): boolean {
    let currentAgentId = agentId;
    const visited = new Set([agentId]);
    while (true) {
      const parentAgentId = residencyIndex.parentByAgentId.get(currentAgentId);
      if (!parentAgentId || visited.has(parentAgentId)) {
        return false;
      }
      if (parentAgentId === ancestorAgentId) {
        return true;
      }
      visited.add(parentAgentId);
      currentAgentId = parentAgentId;
    }
  }

  private getAgentTreeResidency(
    rootAgent: LiveManagedAgent,
    residencyIndex: AgentRuntimeResidencyIndex,
  ): AgentTreeResidency {
    let effectiveActivityAtMs = rootAgent.updatedAt.getTime();
    let hasActiveChildRuntime = false;

    for (const candidate of this.agents.values()) {
      const isRoot = candidate.id === rootAgent.id;
      if (!isRoot && !this.isManagedAgentDescendant(candidate.id, rootAgent.id, residencyIndex)) {
        continue;
      }

      const providerNativeChildren = this.getRunningProviderNativeChildren(candidate.id);
      const hasActiveManagedRuntime = !isRoot && this.isManagedRuntimeActive(candidate);
      if (!hasActiveManagedRuntime && providerNativeChildren.length === 0) {
        continue;
      }

      hasActiveChildRuntime = true;
      effectiveActivityAtMs = Math.max(effectiveActivityAtMs, candidate.updatedAt.getTime());
      for (const child of providerNativeChildren) {
        effectiveActivityAtMs = Math.max(effectiveActivityAtMs, child.timestampMs);
      }
    }

    return { effectiveActivityAtMs, hasActiveChildRuntime };
  }

  private isManagedRuntimeActive(agent: LiveManagedAgent): boolean {
    if (agent.lifecycle === "error") {
      return false;
    }
    return (
      agent.lifecycle === "initializing" ||
      agent.lifecycle === "running" ||
      agent.activeForegroundTurnId !== null ||
      agent.pendingReplacement ||
      agent.pendingPermissions.size > 0 ||
      agent.inFlightPermissionResponses.size > 0 ||
      agent.bufferedPermissionResolutions.size > 0 ||
      this.foregroundRuns.hasPendingRun(agent.id) ||
      this.sessionEventTails.has(agent.id)
    );
  }

  private getRunningProviderNativeChildren(agentId: string): Array<{
    item: Extract<AgentTimelineItem, { type: "tool_call" }>;
    timestampMs: number;
  }> {
    if (!this.timelineStore.has(agentId)) {
      return [];
    }

    const latestByCallId = new Map<
      string,
      {
        item: Extract<AgentTimelineItem, { type: "tool_call" }>;
        timestampMs: number;
      }
    >();
    for (const row of this.timelineStore.getRows(agentId)) {
      if (row.item.type !== "tool_call" || row.item.detail.type !== "sub_agent") {
        continue;
      }
      latestByCallId.set(row.item.callId, {
        item: row.item,
        timestampMs: Date.parse(row.timestamp),
      });
    }
    return [...latestByCallId.values()].filter((entry) => entry.item.status === "running");
  }

  private cancelRunningProviderNativeChildren(agent: LiveManagedAgent): void {
    const runningChildren = this.getRunningProviderNativeChildren(agent.id);
    if (runningChildren.length === 0) {
      return;
    }

    this.touchUpdatedAt(agent);
    for (const { item } of runningChildren) {
      const canceledItem: Extract<AgentTimelineItem, { type: "tool_call" }> = {
        ...item,
        status: "canceled",
        error: null,
      };
      const row = this.recordTimeline(agent.id, canceledItem);
      this.dispatchStream(
        agent.id,
        {
          type: "timeline",
          item: canceledItem,
          provider: agent.provider,
          ...(agent.activeForegroundTurnId ? { turnId: agent.activeForegroundTurnId } : {}),
        },
        {
          seq: row.seq,
          epoch: this.timelineStore.getEpoch(agent.id),
          timestamp: row.timestamp,
        },
      );
    }
  }

  private getLiveAgentTreeIds(
    rootAgentId: string,
    residencyIndex: AgentRuntimeResidencyIndex,
  ): Set<string> {
    const ids = new Set([rootAgentId]);
    for (const agent of this.agents.values()) {
      if (this.isManagedAgentDescendant(agent.id, rootAgentId, residencyIndex)) {
        ids.add(agent.id);
      }
    }
    return ids;
  }

  private async drainQueuedSessionEventsForAgentTree(
    rootAgentId: string,
    residencyIndex: AgentRuntimeResidencyIndex,
  ): Promise<void> {
    const treeAgentIds = this.getLiveAgentTreeIds(rootAgentId, residencyIndex);
    while (true) {
      const pending = [...treeAgentIds]
        .map((agentId) => this.sessionEventTails.get(agentId))
        .filter((task): task is Promise<void> => task !== undefined);
      if (pending.length === 0) {
        break;
      }
      await Promise.allSettled(pending);
    }
    for (const agentId of treeAgentIds) {
      this.agentStreamCoalescer.flushFor(agentId);
    }
  }

  private async drainQueuedSessionEvents(): Promise<void> {
    while (this.sessionEventTails.size > 0) {
      await Promise.allSettled([...this.sessionEventTails.values()]);
    }
  }

  private async releaseIdleAgentRuntime(agent: LiveManagedAgent): Promise<void> {
    const harnessThread = agent.session;
    const closedAgent = this.prepareAgentForClosure(agent, "idle runtime released");
    this.touchUpdatedAt(closedAgent);
    this.historyOnlyAgents.set(closedAgent.id, closedAgent);
    await this.persistSnapshot(closedAgent);
    this.emitClosedAgent(closedAgent, { persist: false });

    try {
      await harnessThread.close();
    } catch (error) {
      this.logger.warn(
        { err: error, agentId: closedAgent.id, provider: closedAgent.provider },
        "Provider runtime close failed after durable idle release",
      );
    }
  }

  private startAgentCloseTask(
    agentId: string,
    operation: () => Promise<void>,
  ): { task: Promise<void>; started: boolean } {
    const existing = this.agentCloseTasks.get(agentId);
    if (existing) {
      return { task: existing, started: false };
    }

    const task = operation();
    this.agentCloseTasks.set(agentId, task);
    const clear = () => {
      if (this.agentCloseTasks.get(agentId) === task) {
        this.agentCloseTasks.delete(agentId);
      }
    };
    void task.then(clear, clear);
    return { task, started: true };
  }

  subscribe(callback: AgentSubscriber, options?: SubscribeOptions): () => void {
    const targetAgentId =
      options?.agentId == null ? null : validateAgentId(options.agentId, "subscribe");
    const record: SubscriptionRecord = {
      callback,
      agentId: targetAgentId,
    };
    this.subscribers.add(record);

    if (options?.replayState !== false) {
      if (record.agentId) {
        const agent = this.agents.get(record.agentId);
        if (agent) {
          callback({
            type: "agent_state",
            agent: { ...agent },
          });
        }
      } else {
        // For global subscribers, skip internal agents during replay
        for (const agent of this.agents.values()) {
          if (agent.internal) {
            continue;
          }
          callback({
            type: "agent_state",
            agent: { ...agent },
          });
        }
      }
    }

    return () => {
      this.subscribers.delete(record);
    };
  }

  listAgents(): ManagedAgent[] {
    return [...this.agents.values(), ...this.historyOnlyAgents.values()]
      .filter((agent) => !agent.internal)
      .map((agent) => Object.assign({}, agent));
  }

  /**
   * Returns internal agents for daemon-owned orchestration only. They intentionally remain hidden
   * from the user-facing listAgents() API.
   */
  listInternalAgentsByLabels(labels: Readonly<Record<string, string>>): ManagedAgent[] {
    const expected = Object.entries(labels);
    return Array.from(this.agents.values())
      .filter(
        (agent) => agent.internal && expected.every(([key, value]) => agent.labels[key] === value),
      )
      .map((agent) => Object.assign({}, agent));
  }

  /**
   * Repair a daemon-owned session that was persisted before its internal
   * visibility bit existed. Callers must already own the authority mapping;
   * this only changes user-surface visibility and never changes the provider
   * session itself.
   */
  markAgentInternal(agentId: string): boolean {
    return this.setAgentInternal(agentId, true);
  }

  /**
   * Changes only the local UI visibility projection for a live agent. Durable
   * callers must update their stored record separately before a future resume.
   */
  setAgentInternal(agentId: string, internal: boolean): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }
    agent.internal = internal;
    return true;
  }

  async listImportableSessions(
    options?: ImportablePersistedAgentQueryOptions,
  ): Promise<ManagedImportableProviderSession[]> {
    const providerEntries = (
      await Promise.all(
        this.getConfiguredProviderIds().map(async (provider) =>
          this.isProviderImportable(provider, options?.providerFilter)
            ? ([provider, await this.loadAdapter(provider)] as const)
            : null,
        ),
      )
    ).filter(
      (entry): entry is readonly [AgentProvider, HarnessAdapter] =>
        entry !== null &&
        entry[1].capabilities.supportsSessionListing === true &&
        Boolean(entry[1].listImportableSessions),
    );
    const sessionLists = await Promise.all(
      providerEntries.map(async ([provider, client]) => {
        try {
          return (
            await client.listImportableSessions!({
              limit: options?.limit,
              cwd: options?.cwd,
            })
          ).map((session) => Object.assign(session, { provider }));
        } catch (error) {
          this.logger.warn(
            { err: error, provider },
            "Failed to list importable sessions for provider",
          );
          return [];
        }
      }),
    );
    const sessions: ManagedImportableProviderSession[] = sessionLists.flat();

    const limit = options?.limit ?? 20;
    return sessions
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
      .slice(0, limit);
  }

  private isProviderImportable(
    provider: AgentProvider,
    providerFilter: Set<string> | undefined,
  ): boolean {
    if (this.providerDefinitions.get(provider)?.enabled === false) {
      return false;
    }
    if (providerFilter && !providerFilter.has(provider)) {
      return false;
    }
    return true;
  }

  async listProviderAvailability(): Promise<ProviderAvailability[]> {
    return Promise.all(
      this.getConfiguredProviderIds().map((provider) => this.getProviderAvailability(provider)),
    );
  }

  getProviderCapabilities(provider: AgentProvider): AgentCapabilityFlags | null {
    return this.adapters.get(provider)?.capabilities ?? null;
  }

  getProviderHarnessCapabilities(provider: AgentProvider): HarnessCapabilities | null {
    return this.adapters.get(provider)?.harnessCapabilities ?? null;
  }

  async getProviderAvailability(provider: AgentProvider): Promise<ProviderAvailability> {
    if (!this.providerDefinitions.has(provider)) {
      return {
        provider,
        available: false,
        error: `No adapter registered for provider '${provider}'`,
      };
    }

    try {
      const available = await (await this.loadAdapter(provider)).isAvailable();
      return {
        provider,
        available,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ err: error, provider }, "Failed to check provider availability");
      return {
        provider,
        available: false,
        error: message,
      };
    }
  }

  async listDraftCommands(config: AgentSessionConfig): Promise<AgentSlashCommand[]> {
    const normalizedConfig = await this.normalizeConfig(config, {
      resolveDefaultModel: false,
      allowDefaultModeCatalogLookup: false,
    });
    const client = await this.loadAdapter(normalizedConfig.provider);
    if (!normalizedConfig.model) {
      return [];
    }
    const available = await client.isAvailable();
    if (!available) {
      throw new Error(
        `Provider '${normalizedConfig.provider}' is not available. Please ensure the CLI is installed.`,
      );
    }

    return await this.withProviderControlLaunchContext(
      normalizedConfig.provider,
      async (launchContext) => {
        if (client.listCommands) {
          return await client.listCommands(normalizedConfig, launchContext);
        }

        const session = await client.createSession(normalizedConfig, launchContext, {
          persistSession: false,
        });
        try {
          if (!session.listCommands) {
            throw new Error(
              `Provider '${normalizedConfig.provider}' does not support listing commands`,
            );
          }
          return await session.listCommands();
        } finally {
          try {
            await session.close();
          } catch (error) {
            this.logger.warn(
              { err: error, provider: normalizedConfig.provider },
              "Failed to close draft command listing session",
            );
          }
        }
      },
    );
  }

  async listDraftFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
    const normalizedConfig = await this.normalizeConfig(config, {
      resolveDefaultModel: false,
      allowDefaultModeCatalogLookup: false,
    });
    const client = await this.loadAdapter(normalizedConfig.provider);
    if (!normalizedConfig.model) {
      return [];
    }
    const available = await client.isAvailable();
    if (!available) {
      throw new Error(
        `Provider '${normalizedConfig.provider}' is not available. Please ensure the CLI is installed.`,
      );
    }

    return await this.withProviderControlLaunchContext(
      normalizedConfig.provider,
      async (launchContext) => {
        if (client.listFeatures) {
          return await client.listFeatures(normalizedConfig, launchContext);
        }

        const session = await client.createSession(normalizedConfig, launchContext, {
          persistSession: false,
        });
        try {
          return session.features ?? [];
        } finally {
          try {
            await session.close();
          } catch (error) {
            this.logger.warn(
              { err: error, provider: normalizedConfig.provider },
              "Failed to close draft feature listing session",
            );
          }
        }
      },
    );
  }

  getAgent(id: string): ManagedAgent | null {
    const agent = this.agents.get(id) ?? this.historyOnlyAgents.get(id);
    return agent ? { ...agent } : null;
  }

  /** True only when the agent has a live provider session that can accept a new turn. */
  hasRunnableSession(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  getTimeline(id: string): AgentTimelineItem[] {
    this.requireTimelineAgent(id);
    return this.timelineStore.getItems(id);
  }

  async getTimelineRows(id: string): Promise<AgentTimelineRow[]> {
    this.requireTimelineAgent(id);
    if (this.durableTimelineStore) {
      return await this.durableTimelineStore.getCommittedRows(id);
    }
    return this.timelineStore.getRows(id);
  }

  fetchTimeline(id: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult {
    this.requireTimelineAgent(id);
    return this.timelineStore.fetch(id, options);
  }

  fetchFullTimeline(id: string): AgentTimelineFetchResult {
    this.requireTimelineAgent(id);
    return this.timelineStore.fetchAll(id, { direction: "tail" });
  }

  /**
   * Restores a timeline-only snapshot after provider resume fails. This is
   * intentionally not a runnable agent: sending, interrupting and permission
   * APIs continue to require a live provider session.
   */
  async restoreHistoryOnlyAgent(record: StoredAgentRecord): Promise<ManagedAgent | null> {
    const existing = this.getAgent(record.id);
    if (existing) {
      return existing;
    }
    if (!this.durableTimelineStore) {
      return null;
    }

    const durableTimeline = await this.durableTimelineStore.fetchAllCommitted(record.id);
    if (durableTimeline.rows.length === 0) {
      return null;
    }

    this.timelineStore.initialize(record.id, {
      epoch: durableTimeline.epoch,
      nextSeq: durableTimeline.window.nextSeq,
      rows: durableTimeline.rows,
    });
    const historyOnly: ManagedAgentClosed = {
      id: record.id,
      provider: record.provider,
      cwd: record.cwd,
      workspaceId: record.workspaceId,
      session: null,
      capabilities: STORED_AGENT_CAPABILITIES,
      providerRunMode: record.providerRunMode,
      providerControlRevision: record.providerControlRevision,
      config: buildStoredAgentConfig(record),
      runtimeInfo: record.runtimeInfo
        ? {
            provider: record.runtimeInfo.provider,
            sessionId: record.runtimeInfo.sessionId,
            ...(record.runtimeInfo.model !== undefined ? { model: record.runtimeInfo.model } : {}),
            ...(record.runtimeInfo.thinkingOptionId !== undefined
              ? { thinkingOptionId: record.runtimeInfo.thinkingOptionId }
              : {}),
            ...(record.runtimeInfo.modeId !== undefined
              ? { modeId: record.runtimeInfo.modeId }
              : {}),
            ...(record.runtimeInfo.extra ? { extra: record.runtimeInfo.extra } : {}),
          }
        : undefined,
      lifecycle: "closed",
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.lastActivityAt ?? record.updatedAt),
      availableModes: [],
      currentModeId: record.lastModeId ?? null,
      pendingPermissions: new Map(),
      bufferedPermissionResolutions: new Map(),
      inFlightPermissionResponses: new Set(),
      pendingReplacement: false,
      activeForegroundTurnId: null,
      foregroundTurnWaiters: new Set(),
      finalizedForegroundTurnIds: new Set(),
      unsubscribeSession: null,
      persistence: record.persistence ?? null,
      historyPrimed: true,
      lastUserMessageAt: record.lastUserMessageAt ? new Date(record.lastUserMessageAt) : null,
      lastUsage: undefined,
      lastError: record.lastError ?? undefined,
      attention: { requiresAttention: false },
      internal: record.internal,
      labels: record.labels,
    };
    this.historyOnlyAgents.set(record.id, historyOnly);
    this.previousStatuses.set(record.id, historyOnly.lifecycle);
    return { ...historyOnly };
  }

  createAgent(
    config: AgentSessionConfig,
    agentId?: string,
    options?: {
      labels?: Record<string, string>;
      initialPrompt?: string;
      env?: Record<string, string>;
      persistSession?: boolean;
      persistInternal?: boolean;
      initialTitle?: string | null;
      workspaceId?: string;
      providerRunMode?: ProviderRunMode;
      providerControlRevision?: number;
    },
  ): Promise<ManagedAgent> {
    return this.trackAgentRegistrationOperation(
      this.runAgentTreeLifecycleOperation(() => this.createAgentInternal(config, agentId, options)),
    );
  }

  private async createAgentInternal(
    config: AgentSessionConfig,
    agentId?: string,
    options?: {
      labels?: Record<string, string>;
      initialPrompt?: string;
      env?: Record<string, string>;
      persistSession?: boolean;
      persistInternal?: boolean;
      initialTitle?: string | null;
      workspaceId?: string;
      providerRunMode?: ProviderRunMode;
      providerControlRevision?: number;
    },
  ): Promise<ManagedAgent> {
    this.assertAcceptingAgentRegistrations();
    const resolvedAgentId = validateAgentId(agentId ?? this.idFactory(), "createAgent");
    const { storedConfig, launchConfig } = await this.prepareSessionConfig(config, resolvedAgentId);
    this.requireEnabledProvider(storedConfig.provider);
    const client = await this.requireAvailableAdapter({
      provider: storedConfig.provider,
    });
    const launchContext = await this.buildLaunchContext(
      resolvedAgentId,
      client,
      launchConfig,
      options?.env,
    );
    const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
    const createOptions = this.buildCreateSessionOptions(options);
    const session = await client.createSession(providerLaunchConfig, launchContext, createOptions);
    const managed = await this.registerSession(session, storedConfig, resolvedAgentId, {
      labels: options?.labels,
      initialTitle: options?.initialTitle,
      workspaceId: options?.workspaceId,
      providerRunMode: options?.providerRunMode,
      providerControlRevision: options?.providerControlRevision,
    });
    if (options?.persistInternal && managed.internal && this.registry) {
      await this.registry.applySnapshot(managed, {
        title: options.initialTitle ?? null,
        internal: true,
      });
    }
    return managed;
  }

  private buildCreateSessionOptions(options?: {
    persistSession?: boolean;
  }): AgentCreateSessionOptions | undefined {
    return options?.persistSession === undefined
      ? undefined
      : { persistSession: options.persistSession };
  }

  // Reconstruct an agent from provider persistence. Callers should explicitly
  // hydrate timeline history after resume.
  resumeAgentFromPersistence(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    agentId?: string,
    options?: {
      createdAt?: Date;
      updatedAt?: Date;
      lastUserMessageAt?: Date | null;
      labels?: Record<string, string>;
      workspaceId?: string;
      historyOnly?: boolean;
      providerRunMode?: ProviderRunMode;
      providerControlRevision?: number;
    },
  ): Promise<ManagedAgent> {
    return this.trackAgentRegistrationOperation(
      this.runAgentTreeLifecycleOperation(async () => {
        if (agentId) {
          await this.waitForAgentClose(agentId);
        }
        return await this.resumeAgentFromPersistenceInternal(handle, overrides, agentId, options);
      }),
    );
  }

  private async resumeAgentFromPersistenceInternal(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    agentId?: string,
    options?: {
      createdAt?: Date;
      updatedAt?: Date;
      lastUserMessageAt?: Date | null;
      labels?: Record<string, string>;
      workspaceId?: string;
      historyOnly?: boolean;
      providerRunMode?: ProviderRunMode;
      providerControlRevision?: number;
    },
  ): Promise<ManagedAgent> {
    this.assertAcceptingAgentRegistrations();
    this.requireEnabledProvider(handle.provider);
    const resolvedAgentId = validateAgentId(
      agentId ?? this.idFactory(),
      "resumeAgentFromPersistence",
    );
    const metadata = (handle.metadata ?? {}) as Partial<AgentSessionConfig>;
    const mergedConfig = {
      ...metadata,
      ...overrides,
      provider: handle.provider,
    } as AgentSessionConfig;
    const { storedConfig, launchConfig } = await this.prepareSessionConfig(
      mergedConfig,
      resolvedAgentId,
    );

    const client = await this.loadAdapter(handle.provider);
    const available = await client.isAvailable();
    if (!available) {
      throw new Error(
        `Provider '${handle.provider}' is not available. Please ensure the CLI is installed.`,
      );
    }
    const launchContext = await this.buildLaunchContext(resolvedAgentId, client, launchConfig);
    const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
    const session = await client.resumeSession(handle, providerLaunchConfig, launchContext, {
      historyOnly: options?.historyOnly === true,
    });
    return this.registerSession(session, storedConfig, resolvedAgentId, options);
  }

  importProviderSession(input: {
    provider: AgentProvider;
    providerHandleId: string;
    cwd: string;
    workspaceId: string;
    labels?: Record<string, string>;
  }): Promise<ManagedAgent> {
    return this.trackAgentRegistrationOperation(
      this.runAgentTreeLifecycleOperation(() => this.importProviderSessionInternal(input)),
    );
  }

  private async importProviderSessionInternal(input: {
    provider: AgentProvider;
    providerHandleId: string;
    cwd: string;
    workspaceId: string;
    labels?: Record<string, string>;
  }): Promise<ManagedAgent> {
    this.assertAcceptingAgentRegistrations();
    const resolvedAgentId = validateAgentId(this.idFactory(), "importProviderSession");
    this.requireEnabledProvider(input.provider);

    const client = await this.requireAvailableAdapter({ provider: input.provider });
    if (!client.importSession) {
      throw new Error(`Provider '${input.provider}' does not support importing sessions`);
    }

    const { storedConfig, launchConfig } = await this.prepareSessionConfig(
      {
        provider: input.provider,
        cwd: input.cwd,
      },
      resolvedAgentId,
    );
    const launchContext = await this.buildLaunchContext(resolvedAgentId, client, launchConfig);
    const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
    const imported = await client.importSession(
      {
        providerHandleId: input.providerHandleId,
        cwd: input.cwd,
      },
      { config: providerLaunchConfig, storedConfig, launchContext },
    );
    let handedToRegistration = false;
    try {
      const importedConfig = await this.normalizeConfig(
        stripInternalThothMcpServer({
          ...storedConfig,
          ...imported.config,
          extra: {
            ...(storedConfig.extra ?? {}),
            ...(imported.config.extra ?? {}),
            // Provisioned runtime tools are a daemon launch contract. Provider import metadata
            // may omit unknown extra fields, but that must not make the already-mounted thread
            // look incapable on its first Thoth turn.
            ...(storedConfig.extra?.thothRuntimeTools
              ? { thothRuntimeTools: storedConfig.extra.thothRuntimeTools }
              : {}),
          },
        }),
      );
      const timelineRows = buildImportedTimelineRows(imported.timeline);
      const initialTitle = resolveImportedAgentTitle(importedConfig, timelineRows);

      handedToRegistration = true;
      return this.registerSession(imported.session, importedConfig, resolvedAgentId, {
        labels: input.labels,
        workspaceId: input.workspaceId,
        timelineRows,
        timelineNextSeq: timelineRows.length + 1,
        persistence: imported.persistence,
        historyPrimed: true,
        initialTitle,
        publishWhenReady: true,
      });
    } finally {
      if (!handedToRegistration) {
        await this.closeUnregisteredSession(imported.session);
      }
    }
  }

  // Hot-reload an active agent session with config overrides. By default the
  // in-memory timeline is preserved across config swaps. When `rehydrateFromDisk`
  // is set, the timeline is wiped so a
  // new epoch is minted and provider history is re-streamed — this is what the
  // user-facing "Reload agent" action wants when the on-disk session was
  // mutated outside Thoth.
  reloadAgentSession(
    agentId: string,
    overrides?: Partial<AgentSessionConfig>,
    options?: { rehydrateFromDisk?: boolean },
  ): Promise<ManagedAgent> {
    return this.trackAgentRegistrationOperation(
      this.runAgentTreeLifecycleOperation(() =>
        this.reloadAgentSessionInternal(agentId, overrides, options),
      ),
    );
  }

  private async reloadAgentSessionInternal(
    agentId: string,
    overrides?: Partial<AgentSessionConfig>,
    options?: { rehydrateFromDisk?: boolean },
  ): Promise<ManagedAgent> {
    this.assertAcceptingAgentRegistrations();
    let existing = this.requireSessionAgent(agentId);
    if (this.hasInFlightRun(agentId)) {
      await this.cancelAgentRun(agentId);
      existing = this.requireSessionAgent(agentId);
    }
    const rehydrateFromDisk = options?.rehydrateFromDisk ?? false;
    const preservedHistoryPrimed = existing.historyPrimed;
    const preservedLastUsage = existing.lastUsage;
    const preservedLastError = existing.lastError;
    const preservedAttention = existing.attention;
    const handle = existing.persistence;
    const provider = handle?.provider ?? existing.provider;
    const client = await this.loadAdapter(provider);
    const refreshConfig = {
      ...existing.config,
      ...overrides,
      provider,
    } as AgentSessionConfig;
    const { storedConfig, launchConfig } = await this.prepareSessionConfig(refreshConfig, agentId);
    const launchContext = await this.buildLaunchContext(agentId, client, launchConfig);
    const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);

    const session = handle
      ? await client.resumeSession(handle, providerLaunchConfig, launchContext)
      : await client.createSession(providerLaunchConfig, launchContext);

    let handedToRegistration = false;
    try {
      this.assertAcceptingAgentRegistrations();
      const residencyIndex = await this.buildAgentRuntimeResidencyIndex();
      await this.drainQueuedSessionEventsForAgentTree(agentId, residencyIndex);
      this.cancelRunningProviderNativeChildren(existing);
      const closedExisting = this.prepareAgentForClosure(existing, "agent reloaded");
      try {
        await this.persistSnapshot(closedExisting);
      } finally {
        await this.closeReloadedSession(existing.session, agentId);
      }

      if (rehydrateFromDisk) {
        // Wipe both durable and in-memory timeline so registerSession mints a
        // new epoch and hydrateTimelineFromProvider re-streams the freshly read
        // provider history into an empty timeline.
        await this.deleteCommittedTimeline(agentId);
        this.timelineStore.delete(agentId);
      }

      // Preserve existing labels and timeline during reload.
      handedToRegistration = true;
      return this.registerSession(session, storedConfig, agentId, {
        labels: existing.labels,
        workspaceId: existing.workspaceId,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
        lastUserMessageAt: existing.lastUserMessageAt,
        historyPrimed: rehydrateFromDisk ? false : preservedHistoryPrimed,
        lastUsage: preservedLastUsage,
        lastError: preservedLastError,
        attention: preservedAttention,
        providerRunMode: existing.providerRunMode,
        providerControlRevision: existing.providerControlRevision,
      });
    } finally {
      if (!handedToRegistration) {
        await this.closeUnregisteredSession(session);
      }
    }
  }

  private async closeReloadedSession(session: HarnessThread, agentId: string): Promise<void> {
    try {
      const result = await this.waitWithTimeout({
        operation: session.close(),
        timeoutMs: this.rescueTimeouts.reloadSessionCloseMs,
        onLateError: (error) => {
          this.logger.warn(
            { err: error, agentId },
            "Previous session close failed after refresh timeout",
          );
        },
      });

      if (result === "timed_out") {
        this.logger.warn(
          { agentId, timeoutMs: this.rescueTimeouts.reloadSessionCloseMs },
          "Timed out closing previous session during refresh",
        );
      }
    } catch (error) {
      this.logger.warn({ err: error, agentId }, "Failed to close previous session during refresh");
    }
  }

  private async waitWithTimeout(options: TimeoutOptions): Promise<TimeoutResult> {
    let didTimeOut = false;
    let timer: NodeJS.Timeout | null = null;
    const operation = options.operation
      .then((): TimeoutResult => "completed")
      .catch((error) => {
        if (didTimeOut) {
          options.onLateError?.(error);
          return "timed_out" as const;
        }
        throw error;
      });

    try {
      return await Promise.race([
        operation,
        new Promise<TimeoutResult>((resolvePromise) => {
          timer = setTimeout(() => {
            didTimeOut = true;
            resolvePromise("timed_out");
          }, options.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async closeAgent(agentId: string): Promise<void> {
    await this.runAgentTreeLifecycleOperation(async () => {
      const { task } = this.startAgentCloseTask(agentId, () => this.closeAgentInternal(agentId));
      await task;
    });
  }

  private async closeAgentInternal(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      if (this.historyOnlyAgents.has(agentId)) {
        return;
      }
      this.requireAgent(agentId);
      return;
    }
    const residencyIndex = await this.buildAgentRuntimeResidencyIndex();
    await this.drainQueuedSessionEventsForAgentTree(agentId, residencyIndex);
    this.cancelRunningProviderNativeChildren(agent);
    this.logger.trace(
      {
        agentId,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: agent.activeForegroundTurnId ?? undefined,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        pendingPermissions: agent.pendingPermissions.size,
      },
      "execution.service.close.start",
    );
    const closedAgent = this.prepareAgentForClosure(agent, "agent closed");
    let closeError: unknown;
    try {
      await agent.session.close();
    } catch (error) {
      closeError = error;
    }
    this.timelineStore.delete(agentId);
    await this.persistSnapshot(closedAgent);
    this.emitClosedAgent(closedAgent, { persist: false });
    this.logger.trace(
      {
        agentId,
        provider: closedAgent.provider,
        sessionId: closedAgent.persistence?.sessionId ?? undefined,
      },
      "execution.service.close.complete",
    );
    if (closeError) {
      throw closeError;
    }
  }

  async archiveAgent(agentId: string): Promise<{ archivedAt: string }> {
    const agent = this.requireAgent(agentId);
    if (!this.registry) {
      throw new Error("Agent storage is not configured");
    }

    await this.registry.applySnapshot(agent, {
      internal: agent.internal,
    });
    const stored = await this.registry.get(agentId);
    if (!stored) {
      throw new Error(`Agent ${agentId} not found in storage after snapshot`);
    }

    const { archivedAt } = await this.markRecordArchived(stored);
    agent.updatedAt = new Date(archivedAt);
    await this.closeAgent(agentId);

    await this.cascadeArchiveChildren(agentId);

    return { archivedAt };
  }

  // Children created via the MCP `create_agent` tool carry the parent-agent-id
  // label pointing back at the caller. Archiving the parent cascades to those
  // children so subagent fleets don't outlive their orchestrator. Detached
  // handoff agents omit this label, so they stand outside the cascade.
  private async cascadeArchiveChildren(parentAgentId: string): Promise<void> {
    const registry = this.registry;
    if (!registry) {
      return;
    }
    const records = await registry.list();
    for (const record of records) {
      if (record.archivedAt) {
        continue;
      }
      if (record.labels?.[PARENT_AGENT_ID_LABEL] !== parentAgentId) {
        continue;
      }
      if (this.agents.has(record.id)) {
        await this.archiveAgent(record.id);
      } else {
        await this.markRecordArchived(record);
        await this.cascadeArchiveChildren(record.id);
      }
    }
  }

  private async markRecordArchived(record: StoredAgentRecord): Promise<ArchivedStoredAgentRecord> {
    const registry = this.requireRegistry();
    const archivedAt = new Date().toISOString();
    const archivedRecord = buildArchivedAgentRecord(record, { archivedAt, updatedAt: archivedAt });

    await registry.upsert(archivedRecord);

    await this.archiveNativeSessionBestEffort(record.provider, record.persistence);

    if (this.agents.has(record.id)) {
      this.notifyAgentState(record.id);
    } else if (!archivedRecord.internal) {
      this.dispatchArchivedStoredAgent(archivedRecord);
    }

    await this.fireAgentArchived(record.id);

    return archivedRecord;
  }

  private async fireAgentArchived(agentId: string): Promise<void> {
    const callback = this.onAgentArchived;
    if (!callback) {
      return;
    }
    try {
      await callback(agentId);
    } catch (error) {
      this.logger.warn({ err: error, agentId }, "onAgentArchived callback failed");
    }
  }

  private dispatchArchivedStoredAgent(record: StoredAgentRecord): void {
    const updatedAt = new Date(record.updatedAt);
    this.dispatch({
      type: "agent_state",
      agent: {
        id: record.id,
        provider: record.provider,
        cwd: record.cwd,
        workspaceId: record.workspaceId,
        session: null,
        capabilities: STORED_AGENT_CAPABILITIES,
        providerRunMode: record.providerRunMode,
        providerControlRevision: record.providerControlRevision,
        config: buildStoredAgentConfig(record),
        runtimeInfo: undefined,
        lifecycle: "closed",
        createdAt: new Date(record.createdAt),
        updatedAt,
        availableModes: [],
        features: record.features,
        currentModeId: record.lastModeId ?? null,
        pendingPermissions: new Map(),
        bufferedPermissionResolutions: new Map(),
        inFlightPermissionResponses: new Set(),
        pendingReplacement: false,
        activeForegroundTurnId: null,
        foregroundTurnWaiters: new Set(),
        finalizedForegroundTurnIds: new Set(),
        unsubscribeSession: null,
        persistence: record.persistence ?? null,
        historyPrimed: true,
        lastUserMessageAt: record.lastUserMessageAt ? new Date(record.lastUserMessageAt) : null,
        lastUsage: undefined,
        lastError: record.lastError ?? undefined,
        attention: { requiresAttention: false },
        internal: record.internal,
        labels: record.labels,
      },
    });
  }

  async setAgentMode(agentId: string, modeId: string): Promise<AgentProviderNotice | null> {
    const agent = this.requireSessionAgent(agentId);
    const notice = (await agent.session.setMode(modeId)) ?? null;
    const currentMode = (await agent.session.getCurrentMode()) ?? modeId;
    agent.config.modeId = currentMode ?? undefined;
    agent.currentModeId = currentMode;
    // Update runtimeInfo to reflect the new mode
    if (agent.runtimeInfo) {
      agent.runtimeInfo = { ...agent.runtimeInfo, modeId: currentMode };
    }
    this.touchUpdatedAt(agent);
    this.emitState(agent);
    return notice;
  }

  async getAgentPlanCapability(agentId: string): Promise<ProviderPlanCapability> {
    const agent = this.requireSessionAgent(agentId);
    if (agent.planCapability && agent.planCapability.kind !== "unavailable") {
      return agent.planCapability;
    }
    return await this.refreshAgentPlanCapability(agentId);
  }

  async refreshAgentPlanCapability(
    agentId: string,
    options?: { emit?: boolean; persist?: boolean },
  ): Promise<ProviderPlanCapability> {
    const agent = this.requireSessionAgent(agentId);
    let capability: ProviderPlanCapability;
    try {
      capability = agent.session.getProviderRunModeCapability
        ? await agent.session.getProviderRunModeCapability()
        : (this.adapters.get(agent.provider)?.harnessCapabilities.plan ?? {
            kind: "unsupported" as const,
            reason: "Provider session does not expose native Plan.",
          });
    } catch (error) {
      capability = {
        kind: "unavailable",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    agent.planCapability = capability;
    this.touchUpdatedAt(agent);
    if (options?.persist !== false) {
      await this.persistSnapshot(agent);
    }
    if (options?.emit !== false) {
      this.emitState(agent, { persist: false });
    }
    return capability;
  }

  getAgentProviderControl(agentId: string): AgentProviderControl {
    const agent = this.requireAgent(agentId);
    return {
      runMode: agent.providerRunMode,
      planCapability:
        agent.planCapability ??
        ({ kind: "unavailable", reason: "Provider session capability is not loaded." } as const),
      revision: agent.providerControlRevision,
    };
  }

  async applyAgentProviderControl(input: {
    agentId: string;
    runMode: ProviderRunMode;
    revision: number;
  }): Promise<AgentProviderControl> {
    const agent = this.requireSessionAgent(input.agentId);
    const capability =
      input.runMode === "plan"
        ? await this.getAgentPlanCapability(input.agentId)
        : (agent.planCapability ?? (await this.refreshAgentPlanCapability(input.agentId)));
    if (input.runMode === "plan" && capability.kind !== "native") {
      throw new Error(capability.reason);
    }
    agent.providerRunMode = input.runMode;
    agent.providerControlRevision = input.revision;
    this.touchUpdatedAt(agent);
    await this.persistSnapshot(agent);
    this.emitState(agent, { persist: false });
    return this.getAgentProviderControl(input.agentId);
  }

  async prepareAgentRunMode(
    agentId: string,
    mode: ProviderRunMode,
  ): Promise<{ capability: ProviderPlanCapability; nativeModeId: string | null }> {
    const agent = this.requireSessionAgent(agentId);
    const capability = await this.getAgentPlanCapability(agentId);
    if (mode === "plan" && capability.kind !== "native") {
      return { capability, nativeModeId: null };
    }
    if (!agent.session.applyProviderRunMode) {
      if (mode === "plan") {
        return {
          capability: {
            kind: "unsupported",
            reason: "Provider session does not implement native Plan control.",
          },
          nativeModeId: null,
        };
      }
      return { capability, nativeModeId: agent.currentModeId };
    }
    const result = await agent.session.applyProviderRunMode(mode);
    agent.planCapability = result.capability;
    const runtimeInfo = await agent.session.getRuntimeInfo().catch(() => null);
    if (runtimeInfo) {
      agent.runtimeInfo = runtimeInfo;
      agent.currentModeId = runtimeInfo.modeId ?? agent.currentModeId;
    }
    this.touchUpdatedAt(agent);
    await this.persistSnapshot(agent);
    this.emitState(agent, { persist: false });
    return result;
  }

  async setAgentModel(agentId: string, modelId: string | null): Promise<void> {
    const agent = this.requireSessionAgent(agentId);
    const normalizedModelId =
      typeof modelId === "string" && modelId.trim().length > 0 ? modelId : null;

    if (agent.session.setModel) {
      await agent.session.setModel(normalizedModelId);
    }

    agent.config.model = normalizedModelId ?? undefined;
    if (agent.runtimeInfo) {
      agent.runtimeInfo = { ...agent.runtimeInfo, model: normalizedModelId };
    }
    this.touchUpdatedAt(agent);
    this.emitState(agent);
  }

  async setAgentThinkingOption(
    agentId: string,
    thinkingOptionId: string | null,
  ): Promise<AgentProviderNotice | null> {
    const agent = this.requireSessionAgent(agentId);
    const normalizedThinkingOptionId =
      typeof thinkingOptionId === "string" && thinkingOptionId.trim().length > 0
        ? thinkingOptionId
        : null;

    let notice: AgentProviderNotice | null = null;
    if (agent.session.setThinkingOption) {
      notice = (await agent.session.setThinkingOption(normalizedThinkingOptionId)) ?? null;
    }

    agent.config.thinkingOptionId = normalizedThinkingOptionId ?? undefined;
    if (agent.runtimeInfo) {
      agent.runtimeInfo = {
        ...agent.runtimeInfo,
        thinkingOptionId: normalizedThinkingOptionId,
      };
    }
    this.touchUpdatedAt(agent);
    this.emitState(agent);
    return notice;
  }

  async setAgentFeature(agentId: string, featureId: string, value: unknown): Promise<void> {
    const agent = this.requireAgent(agentId);

    if (!agent.session.setFeature) {
      throw new Error("Agent session does not support setting features");
    }

    await agent.session.setFeature(featureId, value);
    agent.config.featureValues = { ...agent.config.featureValues, [featureId]: value };
    this.touchUpdatedAt(agent);
    this.emitState(agent);
  }

  async setTitle(agentId: string, title: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return;
    }
    if (
      this.agentsAwaitingInitialSnapshotPersist.has(agent.id) &&
      this.registry &&
      (await this.registry.get(agent.id)) === null
    ) {
      return;
    }
    this.touchUpdatedAt(agent);
    await this.persistSnapshot(agent, { title: normalizedTitle });
    this.emitState(agent, { persist: false });
  }

  async setLabels(agentId: string, labels: Record<string, string>): Promise<void> {
    const agent = this.requireAgent(agentId);
    await this.writeLabels(agent.id, labels);
  }

  private async writeLabels(agentId: string, patch: AgentLabelPatch): Promise<WriteLabelsResult> {
    const liveAgent = this.agents.get(agentId);
    if (liveAgent) {
      liveAgent.labels = applyLabelPatch(liveAgent.labels, patch);
      this.touchUpdatedAt(liveAgent);
      await this.persistSnapshot(liveAgent);
      this.emitState(liveAgent, { persist: false });
      const record = this.registry ? await this.registry.get(agentId) : null;
      return { record, live: true };
    }

    const nextRecord = await this.writeStoredMetadata(agentId, { labels: patch });
    return { record: nextRecord, live: false };
  }

  private async writeStoredMetadata(
    agentId: string,
    patch: AgentMetadataPatch,
  ): Promise<StoredAgentRecord> {
    const registry = this.requireRegistry();
    const record = await registry.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const nextRecord = {
      ...record,
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.labels ? { labels: applyLabelPatch(record.labels, patch.labels) } : {}),
      updatedAt: this.nextStoredUpdatedAt(record),
    };
    await registry.upsert(nextRecord);
    return nextRecord;
  }

  async detachAgent(agentId: string): Promise<{
    record: StoredAgentRecord;
    live: boolean;
    previousParentAgentId: string | null;
  }> {
    const registry = this.requireRegistry();
    const liveAgent = this.agents.get(agentId);
    if (liveAgent) {
      const previousParentAgentId = getParentAgentIdFromLabels(liveAgent.labels);
      if (!previousParentAgentId) {
        await this.persistSnapshot(liveAgent);
        const record = await registry.get(agentId);
        if (!record) {
          throw new Error(`Agent not found in storage after detach: ${agentId}`);
        }
        return { record, live: true, previousParentAgentId: null };
      }

      const { record } = await this.writeLabels(agentId, { [PARENT_AGENT_ID_LABEL]: null });
      if (!record) {
        throw new Error(`Agent not found in storage after detach: ${agentId}`);
      }
      return { record, live: true, previousParentAgentId };
    }

    const record = await registry.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const previousParentAgentId = getParentAgentIdFromLabels(record.labels);
    if (!previousParentAgentId) {
      return { record, live: false, previousParentAgentId: null };
    }

    const result = await this.writeLabels(agentId, { [PARENT_AGENT_ID_LABEL]: null });
    if (!result.record) {
      throw new Error(`Agent not found in storage after detach: ${agentId}`);
    }
    return { record: result.record, live: false, previousParentAgentId };
  }

  notifyAgentState(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent || agent.internal) {
      return;
    }
    this.touchUpdatedAt(agent);
    this.emitState(agent);
  }

  async clearAgentAttention(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (agent.attention.requiresAttention) {
      agent.attention = { requiresAttention: false };
      await this.persistSnapshot(agent);
      this.emitState(agent, { persist: false });
    }
  }

  async archiveSnapshot(agentId: string, archivedAt: string): Promise<StoredAgentRecord> {
    const registry = this.requireRegistry();
    const liveAgent = this.getAgent(agentId);
    if (liveAgent) {
      await this.persistSnapshot(liveAgent, {
        internal: liveAgent.internal,
      });
    }

    const record = await registry.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const nextRecord = buildArchivedAgentRecord(record, { archivedAt });
    await registry.upsert(nextRecord);

    await this.archiveNativeSessionBestEffort(record.provider, record.persistence);

    if (this.agents.has(agentId)) {
      this.notifyAgentState(agentId);
    } else if (!nextRecord.internal) {
      this.dispatchArchivedStoredAgent(nextRecord);
    }

    await this.fireAgentArchived(agentId);

    return nextRecord;
  }

  async unarchiveSnapshot(agentId: string): Promise<boolean> {
    const registry = this.requireRegistry();
    const record = await registry.get(agentId);
    if (!record || !record.archivedAt) {
      return false;
    }

    await this.unarchiveNativeSession(record.provider, record.persistence);

    await registry.upsert({
      ...record,
      archivedAt: null,
      updatedAt: new Date().toISOString(),
    });

    if (this.getAgent(agentId)) {
      this.notifyAgentState(agentId);
    }
    return true;
  }

  async unarchiveSnapshotByHandle(handle: AgentPersistenceHandle): Promise<void> {
    const registry = this.requireRegistry();
    const records = await registry.list();
    const matched = records.find(
      (record) =>
        record.persistence?.provider === handle.provider &&
        record.persistence?.sessionId === handle.sessionId,
    );
    if (!matched) {
      return;
    }

    await this.unarchiveSnapshot(matched.id);
  }

  async updateAgentMetadata(
    agentId: string,
    updates: {
      title?: string;
      labels?: Record<string, string>;
    },
  ): Promise<void> {
    const liveAgent = this.getAgent(agentId);
    if (liveAgent) {
      if (updates.title) {
        await this.setTitle(agentId, updates.title);
      }
      if (updates.labels) {
        await this.writeLabels(agentId, updates.labels);
      }
      return;
    }

    await this.writeStoredMetadata(agentId, updates);
  }

  async runAgent(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<AgentRunResult> {
    const events = this.streamAgent(agentId, prompt, options);
    const timeline: AgentTimelineItem[] = [];
    let finalText = "";
    let usage: AgentUsage | undefined;
    let canceled = false;

    for await (const event of events) {
      if (event.type === "timeline") {
        timeline.push(event.item);
      } else if (event.type === "turn_completed") {
        usage = event.usage;
      } else if (event.type === "turn_failed") {
        throw new Error(this.formatTurnFailedMessage(event));
      } else if (event.type === "turn_canceled") {
        canceled = true;
      }
    }

    finalText = this.getLastAssistantMessageFromTimeline(timeline) ?? "";

    const agent = this.requireAgent(agentId);
    const sessionId = agent.persistence?.sessionId;
    if (!sessionId) {
      throw new Error(`Agent ${agentId} has no persistence.sessionId after run completed`);
    }
    return {
      sessionId,
      finalText,
      usage,
      timeline,
      canceled,
    };
  }

  /**
   * Try to run a prompt out-of-band — i.e. without allocating a foreground turn
   * and without canceling any active turn. Returns true when the session
   * accepted the prompt as a side-effect command (e.g. /goal pause). Events
   * emitted by the handler flow through dispatchStream so they persist and
   * broadcast like normal timeline events.
   */
  tryRunOutOfBand(agentId: string, prompt: AgentPromptInput): boolean {
    const agent = this.requireSessionAgent(agentId);
    const handler = agent.session.tryHandleOutOfBand?.(prompt);
    if (!handler) {
      return false;
    }
    const dispatch = (event: AgentStreamEvent): void => {
      // Persist timeline items so they show up in fetchAgentTimeline; broadcast
      // for live subscribers. Other event types are broadcast only.
      if (event.type === "timeline") {
        this.touchUpdatedAt(agent);
        const normalizedEvent = {
          ...event,
          item: limitAgentTimelineItemContent(event.item),
        };
        const row = this.recordTimeline(agent.id, normalizedEvent.item);
        this.dispatchStream(agent.id, normalizedEvent, {
          seq: row.seq,
          epoch: this.timelineStore.getEpoch(agent.id),
          timestamp: row.timestamp,
        });
        return;
      }
      this.dispatchStream(agent.id, event, { timestamp: new Date().toISOString() });
    };
    void (async () => {
      try {
        await handler.run({ emit: dispatch });
      } catch (error) {
        const text = error instanceof Error ? error.message : "Out-of-band command failed";
        dispatch({
          type: "timeline",
          provider: agent.provider,
          item: { type: "assistant_message", text: `[Error] ${text}` },
        });
      }
    })();
    return true;
  }

  async appendTimelineItem(agentId: string, item: AgentTimelineItem): Promise<void> {
    const agent = this.requireAgent(agentId);
    this.touchUpdatedAt(agent);
    const normalizedItem = limitAgentTimelineItemContent(item);
    const row = this.recordTimeline(agentId, normalizedItem);
    const event: AgentStreamEvent = {
      type: "timeline",
      item: normalizedItem,
      provider: agent.provider,
      ...(agent.activeForegroundTurnId ? { turnId: agent.activeForegroundTurnId } : {}),
    };
    this.dispatchStream(agentId, event, {
      seq: row.seq,
      epoch: this.timelineStore.getEpoch(agentId),
      timestamp: row.timestamp,
    });
    this.notifyForegroundTurnWaiters(agentId, event);
    await this.persistSnapshot(agent);
  }

  async emitLiveTimelineItem(agentId: string, item: AgentTimelineItem): Promise<void> {
    const agent = this.requireAgent(agentId);
    this.touchUpdatedAt(agent);
    this.dispatchStream(
      agentId,
      {
        type: "timeline",
        item: limitAgentTimelineItemContent(item),
        provider: agent.provider,
      },
      {
        epoch: this.timelineStore.getEpoch(agentId),
        timestamp: new Date().toISOString(),
      },
    );
  }

  streamAgent(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    const existingAgent = this.requireSessionAgent(agentId);
    this.logger.trace(
      {
        agentId,
        provider: existingAgent.provider,
        sessionId: existingAgent.persistence?.sessionId ?? undefined,
        turnId: existingAgent.activeForegroundTurnId ?? undefined,
        lifecycle: existingAgent.lifecycle,
        activeForegroundTurnId: existingAgent.activeForegroundTurnId,
        hasPendingForegroundRun: this.foregroundRuns.hasPendingRun(agentId),
        promptType: typeof prompt === "string" ? "string" : "structured",
        hasRunOptions: Boolean(options),
      },
      "execution.service.stream.request",
    );
    if (existingAgent.activeForegroundTurnId || this.foregroundRuns.hasPendingRun(agentId)) {
      this.logger.trace(
        {
          agentId,
          provider: existingAgent.provider,
          sessionId: existingAgent.persistence?.sessionId ?? undefined,
          turnId: existingAgent.activeForegroundTurnId ?? undefined,
          lifecycle: existingAgent.lifecycle,
          hasPendingForegroundRun: this.foregroundRuns.hasPendingRun(agentId),
        },
        "execution.service.stream.reject",
      );
      throw new Error(`Agent ${agentId} already has an active run`);
    }

    const agent = existingAgent;
    agent.pendingReplacement = false;
    agent.lastError = undefined;

    const pendingRun = this.foregroundRuns.createPendingRun(agentId);

    const streamForwarder = async function* streamForwarder(this: ExecutionService) {
      let turnId: string;
      let turnStream: ReturnType<ForegroundRunState["createTurnStream"]> | null = null;
      try {
        const result = await agent.session.startTurn(prompt, options);
        turnId = result.turnId;
        if (options?.messageId) {
          this.canonicalMessageByProviderTurn.set(turnId, {
            agentId,
            canonicalMessageId: options.messageId,
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Failed to start turn";
        await this.handleStreamEvent(agent, {
          type: "turn_failed",
          provider: agent.provider,
          error: errorMsg,
        });
        this.finalizeForegroundTurn(agent);
        this.foregroundRuns.settlePendingRun(agentId, pendingRun.token);
        throw error;
      }

      pendingRun.started = true;
      agent.activeForegroundTurnId = turnId;
      agent.lifecycle = "running";
      this.touchUpdatedAt(agent);
      this.emitState(agent);
      this.logger.trace(
        {
          agentId,
          provider: agent.provider,
          sessionId: agent.persistence?.sessionId ?? undefined,
          turnId,
          lifecycle: agent.lifecycle,
          activeForegroundTurnId: agent.activeForegroundTurnId,
        },
        "execution.service.stream.start",
      );

      turnStream = this.foregroundRuns.createTurnStream(turnId);
      this.foregroundRuns.addWaiter(agent, turnStream.waiter);

      try {
        for await (const event of turnStream.events(isTurnTerminalEvent)) {
          yield event;
        }
      } finally {
        if (turnStream) {
          this.foregroundRuns.deleteWaiter(agent, turnStream.waiter);
        }
        this.foregroundRuns.settlePendingRun(agentId, pendingRun.token);
        if (!agent.activeForegroundTurnId) {
          await this.refreshRuntimeInfo(agent);
        }
      }
    }.call(this);

    return streamForwarder;
  }

  private finalizeForegroundTurn(agent: ActiveManagedAgent, turnId?: string): void {
    const mutableAgent = agent;
    if (turnId) {
      this.foregroundRuns.rememberFinalizedTurn(mutableAgent, turnId);
    }
    mutableAgent.activeForegroundTurnId = null;
    const terminalError = mutableAgent.lastError;
    const shouldHoldBusyForReplacement = mutableAgent.pendingReplacement && !terminalError;
    let nextLifecycle: "running" | "error" | "idle";
    if (shouldHoldBusyForReplacement) {
      nextLifecycle = "running";
    } else if (terminalError) {
      nextLifecycle = "error";
    } else {
      nextLifecycle = "idle";
    }
    mutableAgent.lifecycle = nextLifecycle;
    const persistenceHandle =
      mutableAgent.session.describePersistence() ??
      (mutableAgent.runtimeInfo?.sessionId
        ? { provider: mutableAgent.provider, sessionId: mutableAgent.runtimeInfo.sessionId }
        : null);
    if (persistenceHandle) {
      mutableAgent.persistence = attachPersistenceCwd(persistenceHandle, mutableAgent.cwd);
    }
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: mutableAgent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: mutableAgent.lifecycle,
        terminalError,
        pendingReplacement: mutableAgent.pendingReplacement,
      },
      "execution.service.finalize",
    );
    if (!shouldHoldBusyForReplacement) {
      this.touchUpdatedAt(mutableAgent);
      this.emitState(mutableAgent);
    }
  }

  replaceAgentRun(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    const snapshot = this.requireAgent(agentId);
    if (
      snapshot.lifecycle !== "running" &&
      !snapshot.activeForegroundTurnId &&
      !this.foregroundRuns.hasPendingRun(agentId)
    ) {
      return this.streamAgent(agentId, prompt, options);
    }

    const agent = this.requireSessionAgent(agentId);
    agent.pendingReplacement = true;
    agent.lifecycle = "running";
    this.touchUpdatedAt(agent);
    this.emitState(agent);

    return async function* replaceRunForwarder(this: ExecutionService) {
      try {
        await this.cancelAgentRun(agentId);
        const nextRun = this.streamAgent(agentId, prompt, options);
        for await (const event of nextRun) {
          yield event;
        }
      } catch (error) {
        const latest = this.agents.get(agentId);
        if (latest) {
          const latestActive = latest;
          latestActive.pendingReplacement = false;
          if (!latestActive.activeForegroundTurnId && latestActive.lifecycle === "running") {
            (latestActive as ActiveManagedAgent).lifecycle = "idle";
            this.touchUpdatedAt(latestActive);
            this.emitState(latestActive);
          }
        }
        throw error;
      }
    }.call(this);
  }

  async waitForAgentRunStart(agentId: string, options?: WaitForAgentStartOptions): Promise<void> {
    const snapshot = this.getAgent(agentId);
    if (!snapshot) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const pendingRun = this.foregroundRuns.getPendingRun(agentId);
    if ((snapshot.lifecycle === "running" || pendingRun?.started) && !snapshot.pendingReplacement) {
      return;
    }

    if (!snapshot.activeForegroundTurnId && !pendingRun && !snapshot.pendingReplacement) {
      throw new Error(`Agent ${agentId} has no pending run`);
    }

    if (options?.signal?.aborted) {
      throw createAbortError(options.signal, "wait_for_agent_start aborted");
    }

    await new Promise<void>((resolvePromise, reject) => {
      if (options?.signal?.aborted) {
        reject(createAbortError(options.signal, "wait_for_agent_start aborted"));
        return;
      }

      let unsubscribe: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;

      const cleanup = () => {
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch {
            // ignore cleanup errors
          }
          unsubscribe = null;
        }
        if (abortHandler && options?.signal) {
          try {
            options.signal.removeEventListener("abort", abortHandler);
          } catch {
            // ignore cleanup errors
          }
          abortHandler = null;
        }
      };

      const finishOk = () => {
        cleanup();
        resolvePromise();
      };

      const finishErr = (error: unknown) => {
        cleanup();
        reject(error);
      };

      if (options?.signal) {
        abortHandler = () =>
          finishErr(createAbortError(options.signal, "wait_for_agent_start aborted"));
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      const checkCurrentState = () => {
        const current = this.getAgent(agentId);
        if (!current) {
          finishErr(new Error(`Agent ${agentId} not found`));
          return true;
        }

        const currentPendingRun = this.foregroundRuns.getPendingRun(agentId);
        if (
          (current.lifecycle === "running" || currentPendingRun?.started) &&
          !current.pendingReplacement
        ) {
          finishOk();
          return true;
        }

        if (current.lifecycle === "error" && !currentPendingRun?.started) {
          finishErr(new Error(current.lastError ?? `Agent ${agentId} failed to start`));
          return true;
        }

        if (!currentPendingRun && !current.activeForegroundTurnId && !current.pendingReplacement) {
          finishErr(new Error(`Agent ${agentId} run finished before starting`));
          return true;
        }

        return false;
      };

      unsubscribe = this.subscribe(
        (event) => {
          if (event.type !== "agent_state" || event.agent.id !== agentId) {
            return;
          }
          checkCurrentState();
        },
        { agentId, replayState: false },
      );

      checkCurrentState();
    });
  }

  async respondToPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    const agent = this.requireAgent(agentId);
    agent.inFlightPermissionResponses.add(requestId);

    try {
      const result = await agent.session.respondToPermission(requestId, response);
      agent.pendingPermissions.delete(requestId);

      try {
        await this.refreshSessionState(agent);
      } catch {
        // Ignore refresh errors - state sync after permission approval is best effort.
      }

      this.touchUpdatedAt(agent);
      await this.persistSnapshot(agent);
      this.emitState(agent);

      const bufferedResolution = agent.bufferedPermissionResolutions.get(requestId);
      if (bufferedResolution) {
        agent.bufferedPermissionResolutions.delete(requestId);
        this.dispatchStream(agent.id, bufferedResolution, { timestamp: new Date().toISOString() });
      }

      return result;
    } finally {
      agent.inFlightPermissionResponses.delete(requestId);
      agent.bufferedPermissionResolutions.delete(requestId);
    }
  }

  async cancelAgentRun(agentId: string): Promise<boolean> {
    const agent = this.requireSessionAgent(agentId);
    const pendingRun = this.foregroundRuns.getPendingRun(agentId);
    const foregroundTurnId = agent.activeForegroundTurnId;
    const hasForegroundTurn = Boolean(foregroundTurnId);
    const isAutonomousRunning = agent.lifecycle === "running" && !hasForegroundTurn && !pendingRun;

    if (!hasForegroundTurn && !isAutonomousRunning && !pendingRun) {
      return false;
    }

    await this.interruptSession(agent.session, agentId);

    // The interrupt will produce a turn_canceled/turn_failed event via subscribe(),
    // which flows through the session event dispatcher and settles the foreground turn waiter.
    // Wait briefly for the event to propagate if there's an active foreground turn.
    if (foregroundTurnId) {
      const waiter = Array.from(agent.foregroundTurnWaiters).find(
        (candidate) => candidate.turnId === foregroundTurnId,
      );
      const timeout = new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2000));
      if (waiter) {
        await Promise.race([waiter.settledPromise, timeout]);
      } else if (agent.activeForegroundTurnId === foregroundTurnId) {
        await Promise.race([
          new Promise<void>((resolvePromise) => {
            const unsubscribe = this.subscribe(
              (event) => {
                if (
                  event.type === "agent_state" &&
                  event.agent.id === agentId &&
                  !event.agent.activeForegroundTurnId
                ) {
                  unsubscribe();
                  resolvePromise();
                }
              },
              { agentId, replayState: false },
            );
          }),
          timeout,
        ]);
      }
      // The waiter settling wakes up the streamForwarder generator, but its
      // finally block (which deletes the pendingForegroundRun) runs asynchronously.
      // Wait for the pending run to be fully cleaned up so the next streamAgent
      // call doesn't see a stale entry and reject with "already has an active run".
      if (pendingRun && !pendingRun.settled) {
        await Promise.race([pendingRun.settledPromise, timeout]);
      }
    } else if (pendingRun) {
      const timeout = new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2000));
      await Promise.race([pendingRun.settledPromise, timeout]);
    }

    // If the foreground turn is still stuck after the timeout, force-dispatch a
    // synthetic turn_canceled so the normal event pipeline cleans up
    // activeForegroundTurnId, settles waiters, and unblocks the streamForwarder.
    if (foregroundTurnId && agent.activeForegroundTurnId === foregroundTurnId) {
      this.logger.warn(
        { agentId, foregroundTurnId },
        "cancelAgentRun: foreground turn still active after timeout, force-canceling",
      );
      void this.dispatchSessionEvent(agent, {
        type: "turn_canceled",
        provider: agent.provider,
        reason: "interrupted",
        turnId: foregroundTurnId,
      });
      // The synthetic event unblocks the streamForwarder generator, whose finally
      // block settles the pending foreground run asynchronously. Wait for it.
      const staleRun = this.foregroundRuns.getPendingRun(agentId);
      if (staleRun && !staleRun.settled) {
        await staleRun.settledPromise;
      }
    }

    // Clear any pending permissions that weren't cleaned up by handleStreamEvent.
    if (agent.pendingPermissions.size > 0) {
      for (const [requestId] of agent.pendingPermissions) {
        this.dispatchStream(
          agent.id,
          {
            type: "permission_resolved",
            provider: agent.provider,
            requestId,
            resolution: { behavior: "deny", message: "Interrupted" },
          },
          { timestamp: new Date().toISOString() },
        );
      }
      agent.pendingPermissions.clear();
      this.touchUpdatedAt(agent);
      this.emitState(agent);
    }

    return true;
  }

  private async interruptSession(session: HarnessThread, agentId: string): Promise<void> {
    try {
      const result = await this.waitWithTimeout({
        operation: session.interrupt(),
        timeoutMs: this.rescueTimeouts.interruptSessionMs,
        onLateError: (error) => {
          this.logger.warn(
            { err: error, agentId },
            "Session interrupt failed after timeout during cancel",
          );
        },
      });

      if (result === "timed_out") {
        this.logger.warn(
          { agentId, timeoutMs: this.rescueTimeouts.interruptSessionMs },
          "Timed out interrupting session during cancel",
        );
      }
    } catch (error) {
      this.logger.error({ err: error, agentId }, "Failed to interrupt session");
    }
  }

  getPendingPermissions(agentId: string): AgentPermissionRequest[] {
    const agent = this.requireSessionAgent(agentId);
    return Array.from(agent.pendingPermissions.values());
  }

  private peekPendingPermission(agent: ManagedAgent): AgentPermissionRequest | null {
    const iterator = agent.pendingPermissions.values().next();
    return iterator.done ? null : iterator.value;
  }

  /**
   * Hydrates the timeline from provider history if the agent's durable
   * timeline is empty (e.g., imported agents that have provider history
   * on disk but no persisted timeline rows). No-ops if already hydrated.
   */
  async hydrateTimelineFromProvider(
    agentId: string,
    options?: HydrateTimelineOptions,
  ): Promise<void> {
    const agent = this.requireSessionAgent(agentId);
    await this.hydrateTimelineFromLegacyProviderHistory(agent, options);
  }

  async rewind(agentId: string, messageId: string, mode: RewindMode): Promise<void> {
    const agent = this.requireSessionAgent(agentId);
    const hadActiveRun =
      Boolean(agent.activeForegroundTurnId) || this.foregroundRuns.hasPendingRun(agentId);
    if (hadActiveRun) {
      await this.cancelAgentRun(agentId);
    }

    const lock = this.foregroundRuns.createPendingRun(agentId);
    try {
      const nativeAnchor = await this.resolveProviderRewindAnchor(agent, messageId, mode);
      this.logger.info(
        { agentId, provider: agent.provider, messageId, mode },
        "agent.rewind.start",
      );
      await invokeRewindCapability(agent.session, { anchor: nativeAnchor, mode });
      if (mode !== "files") {
        await this.truncateCanonicalTimelineForRewind(agentId, messageId);
        await this.hydrateTimelineFromProvider(agentId, { force: true, broadcast: true });
      }
      await this.refreshRuntimeInfo(agent);
      await this.persistSnapshot(agent);
      this.logger.info(
        { agentId, provider: agent.provider, messageId, mode },
        "agent.rewind.complete",
      );
    } catch (error) {
      this.logger.warn(
        { err: error, agentId, provider: agent.provider, messageId, mode },
        "agent.rewind.failed",
      );
      throw error;
    } finally {
      this.foregroundRuns.settlePendingRun(agentId, lock.token);
    }
  }

  private async resolveProviderRewindAnchor(
    agent: ActiveManagedAgent,
    canonicalMessageId: string,
    scope: RewindMode,
  ): Promise<ProviderMessageAnchorReceipt> {
    const persisted = await this.durableTimelineStore?.getProviderMessageAnchor?.(
      agent.id,
      canonicalMessageId,
      scope,
    );
    if (persisted) return persisted;
    if (!agent.session.listRewindAnchors) {
      throw new Error("The provider session cannot enumerate native rewind anchors.");
    }
    const canonicalRows = this.timelineStore
      .getRows(agent.id)
      .filter(
        (row) =>
          row.item.type === "user_message" &&
          typeof row.item.messageId === "string" &&
          row.item.messageId.length > 0,
      );
    const nativeAnchors = await agent.session.listRewindAnchors();
    const scopes = this.getProviderRewindScopes(agent);
    if (canonicalRows.length > 0 && canonicalRows.length !== nativeAnchors.length) {
      throw new Error(
        `The provider-native rewind anchors cannot be deterministically matched to ${canonicalRows.length} canonical user turns.`,
      );
    }
    for (let index = 0; index < canonicalRows.length; index += 1) {
      const item = canonicalRows[index]!.item;
      const receipt = nativeAnchors[index]!;
      if (item.type !== "user_message" || !item.messageId) continue;
      await this.durableTimelineStore?.bindProviderMessageAnchor?.(
        agent.id,
        item.messageId,
        receipt,
        scopes,
      );
    }
    const targetIndex = canonicalRows.findIndex(
      (row) => row.item.type === "user_message" && row.item.messageId === canonicalMessageId,
    );
    const resolved = targetIndex >= 0 ? nativeAnchors[targetIndex] : null;
    if (!resolved) {
      throw new Error(
        `The provider-native rewind anchor for message ${canonicalMessageId} is unavailable.`,
      );
    }
    return resolved;
  }

  private getProviderRewindScopes(agent: ActiveManagedAgent): ProviderRewindScope[] {
    const scopes: ProviderRewindScope[] = [];
    if (agent.capabilities.supportsRewindConversation && agent.session.revertConversation) {
      scopes.push("conversation");
    }
    if (agent.capabilities.supportsRewindFiles && agent.session.revertFiles) {
      scopes.push("files");
    }
    if (agent.capabilities.supportsRewindBoth && agent.session.revertBoth) {
      scopes.push("both");
    }
    return scopes;
  }

  private async truncateCanonicalTimelineForRewind(
    agentId: string,
    canonicalMessageId: string,
  ): Promise<void> {
    const rows = this.timelineStore.getRows(agentId);
    const targetIndex = rows.findIndex(
      (row) => row.item.type === "user_message" && row.item.messageId === canonicalMessageId,
    );
    if (targetIndex < 0) {
      if (rows.length === 0) return;
      throw new Error(`Canonical rewind message ${canonicalMessageId} was not found.`);
    }
    const retained = rows.slice(0, targetIndex);
    this.timelineStore.initialize(agentId, {
      rows: retained,
      nextSeq: retained.at(-1)?.seq !== undefined ? retained.at(-1)!.seq + 1 : 1,
    });
    if (this.durableTimelineStore?.truncateFromMessage) {
      await this.durableTimelineStore.truncateFromMessage(agentId, canonicalMessageId);
    }
  }

  async deleteCommittedTimeline(agentId: string): Promise<void> {
    if (!this.durableTimelineStore) {
      return;
    }
    await this.durableTimelineStore.deleteAgent(agentId);
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return null;
    }

    return await this.getLastAssistantMessageFromStores(agentId);
  }

  private getLastAssistantMessageFromTimeline(
    timeline: readonly AgentTimelineItem[],
  ): string | null {
    return this.getLastAssistantMessageSegmentFromTimeline(timeline)?.text ?? null;
  }

  private getLastAssistantMessageSegmentFromTimeline(
    timeline: readonly AgentTimelineItem[],
  ): { text: string; startsAtBeginning: boolean } | null {
    // Collect the last contiguous assistant messages (Claude streams chunks)
    const chunks: string[] = [];
    let startsAtBeginning = false;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i];
      if (item.type !== "assistant_message") {
        if (chunks.length) {
          break;
        }
        continue;
      }
      chunks.push(item.text);
      startsAtBeginning = i === 0;
    }

    if (!chunks.length) {
      return null;
    }

    return {
      text: chunks.toReversed().join(""),
      startsAtBeginning,
    };
  }

  private async getLastAssistantMessageFromStores(agentId: string): Promise<string | null> {
    const liveTimeline = this.timelineStore.getItems(agentId);
    const liveSegment = this.getLastAssistantMessageSegmentFromTimeline(liveTimeline);
    if (!this.durableTimelineStore) {
      return liveSegment?.text ?? null;
    }

    if (!liveSegment) {
      return await this.durableTimelineStore.getLastAssistantMessage(agentId);
    }

    if (!liveSegment.startsAtBeginning) {
      return liveSegment.text;
    }

    const lastDurableItem = await this.durableTimelineStore.getLastItem(agentId);
    if (lastDurableItem?.type !== "assistant_message") {
      return liveSegment.text;
    }

    const durableMessage = await this.durableTimelineStore.getLastAssistantMessage(agentId);
    return durableMessage ? `${durableMessage}${liveSegment.text}` : liveSegment.text;
  }

  private async getLastItemFromStores(agentId: string): Promise<AgentTimelineItem | null> {
    const lastLiveItem = this.timelineStore.getLastItem(agentId);
    if (lastLiveItem) {
      return lastLiveItem;
    }
    if (!this.durableTimelineStore) {
      return null;
    }
    return await this.durableTimelineStore.getLastItem(agentId);
  }

  async waitForAgentEvent(
    agentId: string,
    options?: WaitForAgentOptions,
  ): Promise<WaitForAgentResult> {
    const snapshot = this.getAgent(agentId);
    if (!snapshot) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const pendingForegroundRun = this.foregroundRuns.getPendingRun(agentId);
    const hasForegroundTurn =
      Boolean(snapshot.activeForegroundTurnId) || Boolean(pendingForegroundRun);

    const immediatePermission = this.peekPendingPermission(snapshot);
    if (immediatePermission) {
      return {
        status: snapshot.lifecycle,
        permission: immediatePermission,
        lastMessage: await this.getLastAssistantMessage(agentId),
      };
    }

    const initialStatus = snapshot.lifecycle;
    const initialBusy = isAgentBusy(initialStatus) || hasForegroundTurn;
    const waitForActive = options?.waitForActive ?? false;
    if (!waitForActive && !initialBusy) {
      return {
        status: initialStatus,
        permission: null,
        lastMessage: await this.getLastAssistantMessage(agentId),
      };
    }
    if (waitForActive && !initialBusy && !hasForegroundTurn) {
      return {
        status: initialStatus,
        permission: null,
        lastMessage: await this.getLastAssistantMessage(agentId),
      };
    }

    if (options?.signal?.aborted) {
      throw createAbortError(options.signal, "wait_for_agent aborted");
    }

    return await new Promise<WaitForAgentResult>((resolvePromise, reject) => {
      // Bug #1 Fix: Check abort signal AGAIN inside Promise constructor
      // to avoid race condition between pre-Promise check and abort listener registration
      if (options?.signal?.aborted) {
        reject(createAbortError(options.signal, "wait_for_agent aborted"));
        return;
      }

      let currentStatus: AgentLifecycleStatus = initialStatus;
      let hasStarted =
        isAgentBusy(initialStatus) ||
        Boolean(snapshot.activeForegroundTurnId) ||
        Boolean(pendingForegroundRun?.started);
      let terminalStatusOverride: AgentLifecycleStatus | null = null;
      let finished = false;

      // Bug #3 Fix: Declare unsubscribe and abortHandler upfront so cleanup can reference them
      let unsubscribe: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;

      const cleanup = () => {
        // Clean up subscription
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch {
            // ignore cleanup errors
          }
          unsubscribe = null;
        }

        // Clean up abort listener
        if (abortHandler && options?.signal) {
          try {
            options.signal.removeEventListener("abort", abortHandler);
          } catch {
            // ignore cleanup errors
          }
          abortHandler = null;
        }
      };

      const finish = (permission: AgentPermissionRequest | null) => {
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        void this.getLastAssistantMessage(agentId)
          .then((lastMessage) => {
            resolvePromise({
              status: currentStatus,
              permission,
              lastMessage,
            });
            return;
          })
          .catch(reject);
      };

      // Bug #3 Fix: Set up abort handler BEFORE subscription
      // to ensure cleanup handlers exist before callback can fire
      if (options?.signal) {
        abortHandler = () => {
          cleanup();
          reject(createAbortError(options.signal, "wait_for_agent aborted"));
        };
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      // Bug #3 Fix: Now subscribe with cleanup handlers already in place
      // This prevents race condition if callback fires synchronously with replayState: true
      unsubscribe = this.subscribe(
        (event) => {
          if (event.type === "agent_state") {
            currentStatus = event.agent.lifecycle;
            const pending = this.peekPendingPermission(event.agent);
            if (pending) {
              finish(pending);
              return;
            }
            if (isAgentBusy(event.agent.lifecycle)) {
              hasStarted = true;
              return;
            }
            if (!waitForActive || hasStarted) {
              if (terminalStatusOverride) {
                currentStatus = terminalStatusOverride;
              }
              finish(null);
            }
            return;
          }

          if (event.type === "agent_stream") {
            if (event.event.type === "permission_requested") {
              finish(event.event.request);
              return;
            }
            if (event.event.type === "turn_failed") {
              hasStarted = true;
              terminalStatusOverride = "error";
              return;
            }
            if (event.event.type === "turn_completed") {
              hasStarted = true;
            }
            if (event.event.type === "turn_canceled") {
              hasStarted = true;
            }
          }
        },
        { agentId, replayState: true },
      );
    });
  }

  private async registerSession(
    session: HarnessThread,
    config: AgentSessionConfig,
    agentId: string,
    options?: {
      createdAt?: Date;
      updatedAt?: Date;
      lastUserMessageAt?: Date | null;
      labels?: Record<string, string>;
      timeline?: AgentTimelineItem[];
      timelineRows?: AgentTimelineRow[];
      timelineNextSeq?: number;
      persistence?: AgentPersistenceHandle;
      historyPrimed?: boolean;
      lastUsage?: AgentUsage;
      lastError?: string;
      attention?: AttentionState;
      initialTitle?: string | null;
      publishWhenReady?: boolean;
      workspaceId?: string;
      providerRunMode?: ProviderRunMode;
      providerControlRevision?: number;
    },
  ): Promise<ManagedAgent> {
    let managed: ActiveManagedAgent | null = null;
    let displacedHistoryOnly: ManagedAgentClosed | undefined;
    try {
      this.assertAcceptingAgentRegistrations();
      const resolvedAgentId = validateAgentId(agentId, "registerSession");
      if (this.agents.has(resolvedAgentId)) {
        throw new Error(`Agent with id ${resolvedAgentId} already exists`);
      }
      displacedHistoryOnly = this.historyOnlyAgents.get(resolvedAgentId);
      this.historyOnlyAgents.delete(resolvedAgentId);
      const initialPersistedTitle = await this.resolveInitialPersistedTitle(
        resolvedAgentId,
        config,
        options?.initialTitle ?? null,
      );

      if (options?.workspaceId) {
        this.durableTimelineStore?.bindAgentWorkspace(resolvedAgentId, options.workspaceId);
      }

      const now = new Date();
      const { durableTimelineHasRows } = await this.initializeAgentTimelineForRegister({
        agentId: resolvedAgentId,
        now,
        options,
      });

      managed = this.buildManagedAgentForRegister({
        resolvedAgentId,
        session,
        config,
        now,
        durableTimelineHasRows,
        options,
      });

      this.assertAcceptingAgentRegistrations();
      this.agents.set(resolvedAgentId, managed);
      this.previousStatuses.set(resolvedAgentId, managed.lifecycle);
      await this.refreshRuntimeInfo(managed, { emit: !options?.publishWhenReady });
      this.assertAgentRegistrationActive(managed);
      await this.persistSnapshot(managed, {
        title: initialPersistedTitle,
      });
      this.assertAgentRegistrationActive(managed);
      if (!options?.publishWhenReady) {
        this.emitState(managed, { persist: false });
      }

      await this.refreshSessionState(managed, { emit: !options?.publishWhenReady });
      this.assertAgentRegistrationActive(managed);
      managed.lifecycle = "idle";
      await this.persistSnapshot(managed);
      this.assertAgentRegistrationActive(managed);
      this.emitState(managed, { persist: false });
      this.subscribeToSession(managed);
      return { ...managed };
    } catch (error) {
      await this.cleanupFailedAgentRegistration(session, managed, error);
      if (displacedHistoryOnly && !this.agents.has(displacedHistoryOnly.id)) {
        this.historyOnlyAgents.set(displacedHistoryOnly.id, displacedHistoryOnly);
      }
      throw error;
    }
  }

  private assertAcceptingAgentRegistrations(): void {
    if (!this.acceptingAgentRegistrations) {
      throw new ExecutionServiceShuttingDownError();
    }
  }

  private assertAgentRegistrationActive(agent: ActiveManagedAgent): void {
    if (!this.acceptingAgentRegistrations || this.agents.get(agent.id) !== agent) {
      throw new ExecutionServiceShuttingDownError();
    }
  }

  private async cleanupFailedAgentRegistration(
    session: HarnessThread,
    managed: ActiveManagedAgent | null,
    registrationError: unknown,
  ): Promise<void> {
    if (!managed) {
      await this.closeUnregisteredSession(session);
      return;
    }

    if (this.agents.get(managed.id) !== managed) {
      // Another lifecycle owner already removed this exact registration and owns its close.
      return;
    }

    const closed = this.prepareAgentForClosure(managed, "agent registration failed");
    await this.closeUnregisteredSession(session);
    try {
      await this.persistSnapshot(closed);
    } catch (cleanupError) {
      this.logger.warn(
        { err: cleanupError, registrationError, agentId: managed.id },
        "Failed to persist closed snapshot after agent registration failure",
      );
    }
    this.emitClosedAgent(closed, { persist: false });
  }

  private async closeUnregisteredSession(session: HarnessThread): Promise<void> {
    try {
      await session.close();
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to close unregistered provider session");
    }
  }

  private async initializeAgentTimelineForRegister(params: {
    agentId: string;
    now: Date;
    options:
      | {
          timeline?: AgentTimelineItem[];
          timelineRows?: AgentTimelineRow[];
          timelineNextSeq?: number;
          persistence?: AgentPersistenceHandle;
          createdAt?: Date;
          updatedAt?: Date;
        }
      | undefined;
  }): Promise<{ durableTimelineHasRows: boolean }> {
    const { agentId, now, options } = params;
    const explicitTimelineSeed = buildExplicitTimelineSeedForRegister(now, options);
    const shouldSeedFromDurable =
      !explicitTimelineSeed &&
      !this.timelineStore.has(agentId) &&
      this.durableTimelineStore !== undefined;
    const durableTimelineSeed = shouldSeedFromDurable
      ? await this.loadCommittedTimelineSeed(agentId, now)
      : null;
    const durableTimelineHasRows =
      durableTimelineSeed != null && (durableTimelineSeed.nextSeq ?? 1) > 1;
    const timelineSeed = explicitTimelineSeed ?? durableTimelineSeed;
    if (timelineSeed || !this.timelineStore.has(agentId)) {
      this.timelineStore.initialize(agentId, timelineSeed ?? { timestamp: now.toISOString() });
    }
    if (options?.timelineRows?.length) {
      this.enqueueDurableTimelineBulkInsert(agentId, options.timelineRows);
    }
    return { durableTimelineHasRows };
  }

  private buildManagedAgentForRegister(params: {
    resolvedAgentId: string;
    session: HarnessThread;
    config: AgentSessionConfig;
    now: Date;
    durableTimelineHasRows: boolean;
    options:
      | {
          createdAt?: Date;
          updatedAt?: Date;
          lastUserMessageAt?: Date | null;
          labels?: Record<string, string>;
          historyPrimed?: boolean;
          lastUsage?: AgentUsage;
          lastError?: string;
          attention?: AttentionState;
          persistence?: AgentPersistenceHandle;
          workspaceId?: string;
          providerRunMode?: ProviderRunMode;
          providerControlRevision?: number;
        }
      | undefined;
  }): ActiveManagedAgent {
    const { resolvedAgentId, session, config, now, durableTimelineHasRows, options } = params;
    return {
      id: resolvedAgentId,
      provider: config.provider,
      cwd: config.cwd,
      workspaceId: options?.workspaceId,
      session,
      capabilities: session.capabilities,
      providerRunMode: options?.providerRunMode ?? "default",
      providerControlRevision: options?.providerControlRevision ?? 0,
      config,
      runtimeInfo: undefined,
      lifecycle: "initializing",
      createdAt: options?.createdAt ?? now,
      updatedAt: options?.updatedAt ?? now,
      availableModes: [],
      currentModeId: null,
      pendingPermissions: new Map<string, AgentPermissionRequest>(),
      bufferedPermissionResolutions: new Map(),
      inFlightPermissionResponses: new Set(),
      pendingReplacement: false,
      activeForegroundTurnId: null,
      foregroundTurnWaiters: new Set<ForegroundTurnWaiter>(),
      finalizedForegroundTurnIds: new Set<string>(),
      unsubscribeSession: null,
      persistence: attachPersistenceCwd(
        options?.persistence ?? session.describePersistence(),
        config.cwd,
      ),
      historyPrimed: options?.historyPrimed ?? durableTimelineHasRows,
      lastUserMessageAt: options?.lastUserMessageAt ?? null,
      lastUsage: options?.lastUsage,
      lastError: options?.lastError,
      attention: resolveInitialAttention(options?.attention),
      internal: config.internal ?? false,
      labels: options?.labels ?? {},
    } as ActiveManagedAgent;
  }

  private async loadCommittedTimelineSeed(
    agentId: string,
    now: Date,
  ): Promise<SeedAgentTimelineOptions> {
    if (!this.durableTimelineStore) {
      return { timestamp: now.toISOString() };
    }

    const durableTimeline = await this.durableTimelineStore.fetchAllCommitted(agentId);
    return {
      epoch: durableTimeline.epoch,
      nextSeq: durableTimeline.window.nextSeq,
      rows: durableTimeline.rows,
      timestamp: now.toISOString(),
    };
  }

  private prepareAgentForClosure(
    agent: LiveManagedAgent,
    cancelReason: string,
  ): ManagedAgentClosed {
    this.agentStreamCoalescer.flushAndDiscard(agent.id);
    this.agents.delete(agent.id);
    this.previousStatuses.delete(agent.id);
    if (agent.unsubscribeSession) {
      agent.unsubscribeSession();
      agent.unsubscribeSession = null;
    }
    this.foregroundRuns.cancelWaiters(agent, (turnId) => ({
      type: "turn_canceled",
      provider: agent.provider,
      reason: cancelReason,
      turnId,
    }));
    this.foregroundRuns.settlePendingRun(agent.id);
    return {
      ...agent,
      lifecycle: "closed",
      session: null,
      activeForegroundTurnId: null,
    };
  }

  private emitClosedAgent(agent: ManagedAgentClosed, options?: { persist?: boolean }): void {
    this.emitState(agent, options);
  }
  private subscribeToSession(agent: ActiveManagedAgent): void {
    if (agent.unsubscribeSession) {
      return;
    }
    const agentId = agent.id;
    const unsubscribe = agent.session.subscribe((event: AgentStreamEvent) => {
      this.enqueueSessionEvent(agentId, event);
    });
    agent.unsubscribeSession = unsubscribe;
  }

  private enqueueSessionEvent(agentId: string, event: AgentStreamEvent): void {
    this.logger.trace(
      {
        agentId,
        provider: event.provider,
        sessionId: this.agents.get(agentId)?.persistence?.sessionId ?? undefined,
        turnId: getAgentStreamEventTurnId(event),
        event,
      },
      "execution.service.enqueue",
    );
    const previous = this.sessionEventTails.get(agentId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const current = this.agents.get(agentId);
        if (!current) {
          return;
        }
        if (current.session == null) {
          return;
        }
        this.logger.trace(
          {
            agentId,
            provider: event.provider,
            sessionId: current.persistence?.sessionId ?? undefined,
            turnId: getAgentStreamEventTurnId(event),
            event,
          },
          "execution.service.dequeue",
        );
        await this.dispatchSessionEvent(current, event);
        return;
      })
      .catch((err) => {
        this.logger.error(
          { err, agentId, eventType: event.type },
          "Failed to process session event",
        );
      });

    this.sessionEventTails.set(agentId, next);
    this.trackBackgroundTask(next);
    void next.finally(() => {
      if (this.sessionEventTails.get(agentId) === next) {
        this.sessionEventTails.delete(agentId);
      }
    });
  }

  private async dispatchSessionEvent(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
  ): Promise<void> {
    const turnId = getAgentStreamEventTurnId(event);
    const matchingWaiters = this.foregroundRuns.getMatchingWaiters(agent, turnId);
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        matchingWaiterCount: matchingWaiters.length,
        event,
      },
      "execution.service.dispatch_session_event",
    );

    const shouldNotifyWaiters = await this.handleStreamEvent(agent, event);

    if (!shouldNotifyWaiters) {
      return;
    }

    this.foregroundRuns.notifyWaiters(matchingWaiters, event, {
      terminal: isTurnTerminalEvent(event),
    });
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        notifiedWaiterCount: matchingWaiters.length,
        terminal: isTurnTerminalEvent(event),
        event,
      },
      "execution.service.notify_waiters",
    );
  }

  private async resolveInitialPersistedTitle(
    agentId: string,
    config: AgentSessionConfig,
    fallbackTitle: string | null,
  ): Promise<string | null> {
    const existing = await this.registry?.get(agentId);
    if (existing) {
      return existing.title ?? null;
    }
    const explicitTitle =
      typeof config.title === "string" && config.title.trim().length > 0
        ? config.title.trim()
        : null;
    return explicitTitle ?? fallbackTitle;
  }

  private async persistSnapshot(
    agent: ManagedAgent,
    options?: { title?: string | null; internal?: boolean },
  ): Promise<void> {
    if (!this.registry) {
      return;
    }
    // Don't persist internal agents - they're ephemeral system tasks
    if (agent.internal) {
      return;
    }
    await this.registry.applySnapshot(agent, options);
  }

  private requireRegistry(): AgentRegistry {
    if (!this.registry) {
      throw new Error("Agent storage unavailable");
    }
    return this.registry;
  }

  private async refreshSessionState(
    agent: ActiveManagedAgent,
    options?: { emit?: boolean },
  ): Promise<void> {
    try {
      const modes = await agent.session.getAvailableModes();
      agent.availableModes = modes;
    } catch {
      agent.availableModes = [];
    }

    try {
      agent.currentModeId = await agent.session.getCurrentMode();
    } catch {
      agent.currentModeId = null;
    }

    try {
      const pending = agent.session.getPendingPermissions();
      agent.pendingPermissions = new Map(pending.map((request) => [request.id, request]));
    } catch {
      agent.pendingPermissions.clear();
    }

    this.syncFeaturesFromSession(agent);
    await this.refreshAgentPlanCapability(agent.id, {
      emit: options?.emit,
      persist: false,
    });
    await this.refreshRuntimeInfo(agent, options);
  }

  private async refreshRuntimeInfo(
    agent: ActiveManagedAgent,
    options?: { emit?: boolean },
  ): Promise<void> {
    try {
      const newInfo = await agent.session.getRuntimeInfo();
      const changed =
        newInfo.model !== agent.runtimeInfo?.model ||
        newInfo.thinkingOptionId !== agent.runtimeInfo?.thinkingOptionId ||
        newInfo.sessionId !== agent.runtimeInfo?.sessionId ||
        newInfo.modeId !== agent.runtimeInfo?.modeId;
      agent.runtimeInfo = newInfo;
      if (!agent.persistence && newInfo.sessionId) {
        agent.persistence = attachPersistenceCwd(
          { provider: agent.provider, sessionId: newInfo.sessionId },
          agent.cwd,
        );
      }
      // Emit state if runtimeInfo changed so clients get the updated model
      if (changed && options?.emit !== false) {
        this.emitState(agent);
      }
    } catch {
      // Keep existing runtimeInfo if refresh fails.
    }
  }

  private async hydrateTimelineFromLegacyProviderHistory(
    agent: ActiveManagedAgent,
    options?: HydrateTimelineOptions,
  ): Promise<void> {
    if (agent.historyPrimed && !options?.force) {
      return;
    }

    if (options?.force) {
      const historyEvents: Extract<AgentStreamEvent, { type: "timeline" }>[] = [];
      // Provider histories may serialize user prompts differently. Keep the daemon-owned,
      // message-id-backed user rows as the stable chronology for every visible provider.
      const retainedUserRows = this.timelineStore.getRows(agent.id).filter(isStableDaemonUserRow);
      let consumedUserAnchors = 0;
      for await (const event of agent.session.streamHistory()) {
        if (event.type === "timeline") {
          if (event.item.type === "user_message") {
            const anchor = retainedUserRows[consumedUserAnchors];
            if (anchor) {
              consumedUserAnchors += 1;
              historyEvents.push({
                ...event,
                item: anchor.item,
                timestamp: anchor.timestamp,
              });
              continue;
            }
          }
          if (shouldSuppressProviderUserTimelineItem(event.item)) {
            continue;
          }
          historyEvents.push(event);
        }
      }

      this.agentStreamCoalescer.flushAndDiscard(agent.id);
      await this.deleteCommittedTimeline(agent.id);
      this.timelineStore.delete(agent.id);
      this.timelineStore.initialize(agent.id, { timestamp: new Date().toISOString() });
      agent.historyPrimed = true;

      const replay = historyEvents.map((event) => ({
        event,
        timestamp: event.timestamp ?? new Date().toISOString(),
      }));
      for (const row of retainedUserRows.slice(consumedUserAnchors)) {
        const anchor = {
          event: { type: "timeline" as const, provider: agent.provider, item: row.item },
          timestamp: row.timestamp,
        };
        const insertionIndex = replay.findIndex(
          (candidate) => candidate.timestamp.localeCompare(row.timestamp) > 0,
        );
        if (insertionIndex < 0) {
          replay.push(anchor);
        } else {
          replay.splice(insertionIndex, 0, anchor);
        }
      }

      for (const { event, timestamp } of replay) {
        const normalizedEvent = {
          ...event,
          item: limitAgentTimelineItemContent(event.item),
        };
        const row = this.recordTimeline(agent.id, normalizedEvent.item, { timestamp });
        if (options?.broadcast) {
          this.dispatchStream(agent.id, normalizedEvent, {
            seq: row.seq,
            epoch: this.timelineStore.getEpoch(agent.id),
            timestamp: row.timestamp,
          });
        }
      }
      this.touchUpdatedAt(agent);
      this.emitState(agent);
      return;
    }

    agent.historyPrimed = true;
    try {
      for await (const event of agent.session.streamHistory()) {
        if (event.type !== "timeline") {
          continue;
        }
        if (shouldSuppressProviderUserTimelineItem(event.item)) {
          continue;
        }
        this.recordTimeline(
          agent.id,
          limitAgentTimelineItemContent(event.item),
          event.timestamp ? { timestamp: event.timestamp } : undefined,
        );
      }
    } catch {
      // ignore history failures
    }
  }

  private notifyForegroundTurnWaiters(agentId: string, event: AgentStreamEvent): void {
    const turnId = getAgentStreamEventTurnId(event);
    if (turnId == null) {
      return;
    }

    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    this.foregroundRuns.notifyAgentWaiters(agent, event);
    this.logger.trace(
      {
        agentId,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        event,
      },
      "execution.service.notify_waiters.coalesced",
    );
  }

  private async handleStreamEvent(
    agent: ActiveManagedAgent,
    incomingEvent: AgentStreamEvent,
    options?: HandleStreamEventOptions,
  ): Promise<boolean> {
    let event = incomingEvent;
    const eventTurnId = getAgentStreamEventTurnId(event);
    if (
      event.type === "timeline" &&
      this.toolGateway?.isParkedProviderTurn({
        agentId: agent.id,
        providerTurnId: getAgentStreamEventProviderTurnId(event) ?? eventTurnId,
      })
    ) {
      this.logger.debug(
        {
          agentId: agent.id,
          providerTurnId: getAgentStreamEventProviderTurnId(event) ?? eventTurnId,
        },
        "Suppressing timeline emitted after a foreground authority card parked the provider turn",
      );
      return false;
    }
    if (!options?.fromHistory && event.type === "timeline" && event.item.type === "user_message") {
      event = {
        ...event,
        item: await this.canonicalizeProviderUserMessage(agent, event, event.item),
      };
    }
    const isForegroundEvent = Boolean(eventTurnId && agent.activeForegroundTurnId === eventTurnId);
    this.traceHandleStreamEventStart(agent, event, eventTurnId, isForegroundEvent);
    if (
      eventTurnId &&
      isTurnTerminalEvent(event) &&
      this.foregroundRuns.hasFinalizedTurn(agent, eventTurnId)
    ) {
      return false;
    }

    // Only update timestamp for live events, not history replay
    if (!options?.fromHistory) {
      this.touchUpdatedAt(agent);
      if (this.agentStreamCoalescer.handle(agent.id, event)) {
        this.traceCoalescerBuffered(agent, event, eventTurnId);
        return false;
      }
      this.agentStreamCoalescer.flushFor(agent.id);
    }

    const flags: StreamEventFlags = { shouldDispatchEvent: true, shouldNotifyWaiters: true };

    const dispatchPromise = this.dispatchStreamEventByType({
      agent,
      event,
      options,
      isForegroundEvent,
      eventTurnId,
      flags,
    });
    if (dispatchPromise) {
      await dispatchPromise;
    }

    if (!options?.fromHistory && isForegroundEvent && isTurnTerminalEvent(event)) {
      this.finalizeForegroundTurn(agent, eventTurnId);
    }

    if (!options?.fromHistory && flags.shouldDispatchEvent) {
      this.dispatchStream(agent.id, event, { timestamp: new Date().toISOString() });
    }

    if (!options?.fromHistory && isTurnTerminalEvent(event)) {
      if (eventTurnId) {
        await this.captureOrderedProviderAnchor(agent, eventTurnId);
        this.canonicalMessageByProviderTurn.delete(eventTurnId);
      }
      this.toolGateway?.releaseParkedProviderTurn({
        agentId: agent.id,
        providerTurnId: getAgentStreamEventProviderTurnId(event) ?? eventTurnId,
      });
    }

    this.traceHandleStreamEventEnd(agent, event, eventTurnId, flags);

    return flags.shouldNotifyWaiters;
  }

  private async canonicalizeProviderUserMessage(
    agent: ActiveManagedAgent,
    event: Extract<AgentStreamEvent, { type: "timeline" }>,
    item: Extract<AgentTimelineItem, { type: "user_message" }>,
  ): Promise<Extract<AgentTimelineItem, { type: "user_message" }>> {
    const turnId = getAgentStreamEventTurnId(event);
    const binding = turnId ? this.canonicalMessageByProviderTurn.get(turnId) : null;
    if (!binding || binding.agentId !== agent.id) return item;
    const nativeAnchor = item.messageId;
    if (nativeAnchor) {
      await this.persistProviderMessageAnchor(agent, binding.canonicalMessageId, {
        version: 1,
        opaqueAnchor: nativeAnchor,
      });
    }
    return { ...item, messageId: binding.canonicalMessageId };
  }

  private async captureOrderedProviderAnchor(
    agent: ActiveManagedAgent,
    providerTurnId: string,
  ): Promise<void> {
    const binding = this.canonicalMessageByProviderTurn.get(providerTurnId);
    if (!binding || binding.agentId !== agent.id || !agent.session.listRewindAnchors) return;
    const scopes = this.getProviderRewindScopes(agent);
    if (scopes.length === 0) return;
    const existing = await this.durableTimelineStore?.getProviderMessageAnchor?.(
      agent.id,
      binding.canonicalMessageId,
      scopes[0]!,
    );
    if (existing) return;
    const canonicalRows = this.timelineStore
      .getRows(agent.id)
      .filter(
        (row) =>
          row.item.type === "user_message" &&
          typeof row.item.messageId === "string" &&
          row.item.messageId.length > 0,
      );
    const anchors = await agent.session.listRewindAnchors();
    if (canonicalRows.length !== anchors.length) return;
    const index = canonicalRows.findIndex(
      (row) =>
        row.item.type === "user_message" && row.item.messageId === binding.canonicalMessageId,
    );
    if (index < 0 || !anchors[index]) return;
    await this.persistProviderMessageAnchor(agent, binding.canonicalMessageId, anchors[index]);
  }

  private async persistProviderMessageAnchor(
    agent: ActiveManagedAgent,
    canonicalMessageId: string,
    receipt: ProviderMessageAnchorReceipt,
  ): Promise<void> {
    try {
      await this.durableTimelineStore?.bindProviderMessageAnchor?.(
        agent.id,
        canonicalMessageId,
        receipt,
        this.getProviderRewindScopes(agent),
      );
    } catch (error) {
      this.logger.warn(
        { err: error, agentId: agent.id, canonicalMessageId },
        "Failed to persist provider rewind anchor receipt",
      );
    }
  }

  private traceHandleStreamEventStart(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    turnId: string | undefined,
    isForegroundEvent: boolean,
  ): void {
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        isForegroundEvent,
        event,
      },
      "execution.service.handle_stream_event.start",
    );
  }

  private traceCoalescerBuffered(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    turnId: string | undefined,
  ): void {
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        event,
      },
      "execution.service.coalescer.buffer",
    );
  }

  private traceHandleStreamEventEnd(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    turnId: string | undefined,
    flags: StreamEventFlags,
  ): void {
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        shouldDispatchEvent: flags.shouldDispatchEvent,
        shouldNotifyWaiters: flags.shouldNotifyWaiters,
        event,
      },
      "execution.service.handle_stream_event.end",
    );
  }

  private dispatchStreamEventByType(params: {
    agent: ActiveManagedAgent;
    event: AgentStreamEvent;
    options: HandleStreamEventOptions | undefined;
    isForegroundEvent: boolean;
    eventTurnId: string | undefined;
    flags: StreamEventFlags;
  }): Promise<void> | undefined {
    const { agent, event, options, isForegroundEvent, eventTurnId, flags } = params;
    switch (event.type) {
      case "thread_started":
        this.onStreamThreadStarted(agent);
        return undefined;
      case "usage_updated":
        agent.lastUsage = event.usage;
        this.emitState(agent);
        return undefined;
      case "mode_changed":
        agent.currentModeId = event.currentModeId;
        agent.availableModes = event.availableModes;
        if (agent.runtimeInfo) {
          agent.runtimeInfo = { ...agent.runtimeInfo, modeId: event.currentModeId };
        }
        flags.shouldDispatchEvent = false;
        this.emitState(agent);
        return undefined;
      case "model_changed":
        agent.runtimeInfo = event.runtimeInfo;
        if (!agent.persistence && event.runtimeInfo.sessionId) {
          agent.persistence = attachPersistenceCwd(
            { provider: agent.provider, sessionId: event.runtimeInfo.sessionId },
            agent.cwd,
          );
        }
        agent.currentModeId = event.runtimeInfo.modeId ?? agent.currentModeId;
        flags.shouldDispatchEvent = false;
        this.emitState(agent);
        return undefined;
      case "thinking_option_changed":
        if (agent.runtimeInfo) {
          agent.runtimeInfo = {
            ...agent.runtimeInfo,
            thinkingOptionId: event.thinkingOptionId,
          };
        }
        flags.shouldDispatchEvent = false;
        this.emitState(agent);
        return undefined;
      case "timeline":
        return this.onStreamTimelineEvent({ agent, event, options, isForegroundEvent, flags });
      case "turn_completed":
        this.onStreamTurnCompleted({ agent, event, eventTurnId, isForegroundEvent });
        return undefined;
      case "turn_failed":
        return this.onStreamTurnFailed({
          agent,
          event,
          eventTurnId,
          isForegroundEvent,
          options,
        });
      case "turn_canceled":
        this.onStreamTurnCanceled({ agent, event, eventTurnId, isForegroundEvent, options });
        return undefined;
      case "turn_started":
        this.onStreamTurnStarted({ agent, eventTurnId, isForegroundEvent });
        return undefined;
      case "permission_requested":
        this.onStreamPermissionRequested(agent, event);
        return undefined;
      case "permission_resolved":
        this.onStreamPermissionResolved({ agent, event, options, flags });
        return undefined;
      default:
        return undefined;
    }
  }

  private onStreamThreadStarted(agent: ActiveManagedAgent): void {
    const previousSessionId = agent.persistence?.sessionId ?? null;
    const handle = agent.session.describePersistence();
    if (handle) {
      agent.persistence = attachPersistenceCwd(handle, agent.cwd);
      if (agent.persistence?.sessionId !== previousSessionId) {
        this.emitState(agent);
      }
    }
    void this.refreshRuntimeInfo(agent);
  }

  private async onStreamTimelineEvent(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "timeline" }>;
    options: { fromHistory?: boolean } | undefined;
    isForegroundEvent: boolean;
    flags: StreamEventFlags;
  }): Promise<void> {
    const { agent, event, options, flags } = params;

    if (shouldSuppressProviderUserTimelineItem(event.item)) {
      flags.shouldDispatchEvent = false;
      flags.shouldNotifyWaiters = false;
      return;
    }

    if (options?.fromHistory) {
      this.recordTimeline(
        agent.id,
        limitAgentTimelineItemContent(event.item),
        event.timestamp ? { timestamp: event.timestamp } : undefined,
      );
      flags.shouldDispatchEvent = false;
      flags.shouldNotifyWaiters = false;
      return;
    }

    const normalizedEvent = this.recordAndDispatchTimelineItem(
      agent.id,
      event.item,
      event.provider,
      event.turnId,
    );
    event.item = normalizedEvent.item;
    if (event.item.type === "user_message") {
      agent.lastUserMessageAt = new Date();
      this.emitState(agent);
    }
    flags.shouldDispatchEvent = false;
    flags.shouldNotifyWaiters = true;
  }

  private onStreamTurnCompleted(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "turn_completed" }>;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
  }): void {
    const { agent, event, eventTurnId, isForegroundEvent } = params;
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
      },
      "execution.service.turn.completed",
    );
    agent.lastUsage = event.usage;
    agent.lastError = undefined;
    if (!isForegroundEvent && agent.lifecycle !== "idle" && !agent.pendingReplacement) {
      (agent as ActiveManagedAgent).lifecycle = "idle";
      this.emitState(agent);
    }
    void this.refreshRuntimeInfo(agent);
  }

  private async onStreamTurnFailed(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "turn_failed" }>;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
    options: { fromHistory?: boolean } | undefined;
  }): Promise<void> {
    const { agent, event, eventTurnId, isForegroundEvent, options } = params;
    this.logger.warn(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        eventTurnId,
        error: event.error,
        code: event.code,
        diagnostic: event.diagnostic,
      },
      "handleStreamEvent: turn_failed",
    );
    if (!isForegroundEvent) {
      agent.lifecycle = "error";
    }
    agent.lastError = event.error;
    await this.appendSystemErrorTimelineMessage(
      agent,
      event.provider,
      this.formatTurnFailedMessage(event),
      options,
    );
    this.resolvePendingPermissionsForAgent(agent, event.provider, options, "Turn failed");
    if (!isForegroundEvent) {
      this.emitState(agent);
    }
  }

  private onStreamTurnCanceled(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "turn_canceled" }>;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
    options:
      | {
          fromHistory?: boolean;
        }
      | undefined;
  }): void {
    const { agent, event, eventTurnId, isForegroundEvent, options } = params;
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        eventTurnId,
      },
      "execution.service.turn.canceled",
    );
    if (!isForegroundEvent && !agent.pendingReplacement) {
      agent.lifecycle = "idle";
    }
    agent.lastError = undefined;
    this.resolvePendingPermissionsForAgent(agent, event.provider, options, "Interrupted");
    if (!isForegroundEvent) {
      this.emitState(agent);
    }
  }

  private onStreamTurnStarted(params: {
    agent: ActiveManagedAgent;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
  }): void {
    const { agent, eventTurnId, isForegroundEvent } = params;
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
      },
      "execution.service.turn.started",
    );
    if (!isForegroundEvent) {
      agent.lifecycle = "running";
      this.emitState(agent);
    }
  }

  private onStreamPermissionRequested(
    agent: ActiveManagedAgent,
    event: Extract<AgentStreamEvent, { type: "permission_requested" }>,
  ): void {
    const hadPendingPermissions = agent.pendingPermissions.size > 0;
    agent.pendingPermissions.set(event.request.id, event.request);
    if (!hadPendingPermissions && !agent.internal) {
      this.broadcastAgentAttention(agent, "permission");
    }
    this.emitState(agent);
  }

  private onStreamPermissionResolved(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "permission_resolved" }>;
    options: { fromHistory?: boolean } | undefined;
    flags: StreamEventFlags;
  }): void {
    const { agent, event, options, flags } = params;
    agent.pendingPermissions.delete(event.requestId);
    if (!options?.fromHistory && agent.inFlightPermissionResponses.has(event.requestId)) {
      agent.bufferedPermissionResolutions.set(event.requestId, event);
      flags.shouldDispatchEvent = false;
      return;
    }
    this.emitState(agent);
  }

  private resolvePendingPermissionsForAgent(
    agent: ActiveManagedAgent,
    provider: AgentProvider,
    options: { fromHistory?: boolean } | undefined,
    message: string,
  ): void {
    for (const [requestId] of agent.pendingPermissions) {
      agent.pendingPermissions.delete(requestId);
      if (!options?.fromHistory) {
        this.dispatchStream(agent.id, {
          type: "permission_resolved",
          provider,
          requestId,
          resolution: { behavior: "deny", message },
        });
      }
    }
  }

  private recordAndDispatchTimelineItem(
    agentId: string,
    item: AgentTimelineItem,
    provider: AgentProvider,
    turnId?: string,
  ): Extract<AgentStreamEvent, { type: "timeline" }> {
    const normalizedItem = limitAgentTimelineItemContent(item);
    const row = this.recordTimeline(agentId, normalizedItem);
    const event: Extract<AgentStreamEvent, { type: "timeline" }> = {
      type: "timeline",
      item: normalizedItem,
      provider,
      ...(turnId !== undefined ? { turnId } : {}),
    };
    this.dispatchStream(agentId, event, {
      seq: row.seq,
      epoch: this.timelineStore.getEpoch(agentId),
      timestamp: row.timestamp,
    });

    if (
      normalizedItem.type === "tool_call" &&
      normalizedItem.status === "completed" &&
      normalizedItem.detail?.type === "shell" &&
      commandMayHaveChangedExternalState(normalizedItem.detail.command)
    ) {
      const agent = this.agents.get(agentId);
      if (agent) {
        this.onWorkspaceStateMayHaveChanged?.({ cwd: agent.cwd });
      }
    }

    return event;
  }

  private async appendSystemErrorTimelineMessage(
    agent: ActiveManagedAgent,
    provider: AgentProvider,
    message: string,
    options?: { fromHistory?: boolean },
  ): Promise<void> {
    if (options?.fromHistory) {
      return;
    }

    const normalized = message.trim();
    if (!normalized) {
      return;
    }

    const text = `${SYSTEM_ERROR_PREFIX} ${normalized}`;
    const lastItem = await this.getLastItemFromStores(agent.id);
    if (lastItem?.type === "assistant_message" && lastItem.text === text) {
      return;
    }

    const item: AgentTimelineItem = { type: "assistant_message", text };
    const row = this.recordTimeline(agent.id, item);
    this.dispatchStream(
      agent.id,
      {
        type: "timeline",
        item,
        provider,
      },
      {
        seq: row.seq,
        epoch: this.timelineStore.getEpoch(agent.id),
        timestamp: row.timestamp,
      },
    );
  }

  private formatTurnFailedMessage(
    event: Extract<AgentStreamEvent, { type: "turn_failed" }>,
  ): string {
    const base = event.error.trim();
    const parts = [base.length > 0 ? base : "Provider run failed"];
    const code = event.code?.trim();
    if (code) {
      parts.push(`code: ${code}`);
    }
    const diagnostic = event.diagnostic?.trim();
    if (diagnostic && diagnostic !== base) {
      parts.push(diagnostic);
    }
    return parts.join("\n\n");
  }

  private recordTimeline(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): AgentTimelineRow {
    const row = this.timelineStore.append(agentId, item, options);
    this.enqueueDurableTimelineAppend(agentId, row);
    return row;
  }

  private emitState(agent: ManagedAgent, options?: { persist?: boolean }): void {
    // Keep attention as an edge-triggered unread signal, not a level signal.
    this.checkAndSetAttention(agent);
    if (options?.persist !== false) {
      this.enqueueBackgroundPersist(agent);
    }

    this.syncFeaturesFromSession(agent);

    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: agent.activeForegroundTurnId ?? undefined,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        pendingPermissions: agent.pendingPermissions.size,
        persist: options?.persist !== false,
      },
      "execution.service.emit_state",
    );

    this.dispatch({
      type: "agent_state",
      agent: { ...agent },
    });
  }

  private syncFeaturesFromSession(agent: ManagedAgent): void {
    if ("session" in agent && agent.session?.features) {
      agent.features = agent.session.features;
    }
  }

  private checkAndSetAttention(agent: ManagedAgent): void {
    const previousStatus = this.previousStatuses.get(agent.id);
    const currentStatus = agent.lifecycle;

    // Track the new status
    this.previousStatuses.set(agent.id, currentStatus);

    // Skip attention tracking for internal agents
    if (agent.internal) {
      return;
    }

    // Skip if already requires attention
    if (agent.attention.requiresAttention) {
      return;
    }

    // Check if agent transitioned from running to idle (finished)
    if (previousStatus === "running" && currentStatus === "idle") {
      agent.attention = {
        requiresAttention: true,
        attentionReason: "finished",
        attentionTimestamp: new Date(),
      };
      this.broadcastAgentAttention(agent, "finished");
      return;
    }

    // Check if agent entered error state
    if (previousStatus !== "error" && currentStatus === "error") {
      agent.attention = {
        requiresAttention: true,
        attentionReason: "error",
        attentionTimestamp: new Date(),
      };
      this.broadcastAgentAttention(agent, "error");
      return;
    }
  }

  private enqueueBackgroundPersist(agent: ManagedAgent): void {
    const task = this.persistSnapshot(agent).catch((err) => {
      this.logger.error({ err, agentId: agent.id }, "Failed to persist agent snapshot");
    });
    this.trackBackgroundTask(task);
  }

  private enqueueDurableTimelineAppend(agentId: string, row: AgentTimelineRow): void {
    if (!this.durableTimelineStore) {
      return;
    }
    const task = this.durableTimelineStore
      .bulkInsert(agentId, [row])
      .then(() => undefined)
      .catch((err) => {
        this.logger.error(
          { err, agentId, seq: row.seq, itemType: row.item.type },
          "Failed to append timeline row to durable store",
        );
      });
    this.trackBackgroundTask(task);
  }

  private enqueueDurableTimelineBulkInsert(
    agentId: string,
    rows: readonly AgentTimelineRow[],
  ): void {
    if (!this.durableTimelineStore || rows.length === 0) {
      return;
    }
    const task = this.durableTimelineStore.bulkInsert(agentId, rows).catch((err) => {
      this.logger.error(
        { err, agentId, rowCount: rows.length },
        "Failed to seed durable timeline store",
      );
    });
    this.trackBackgroundTask(task);
  }

  private trackBackgroundTask(task: Promise<void>): void {
    this.backgroundTasks.add(task);
    void task.finally(() => {
      this.backgroundTasks.delete(task);
    });
  }

  private trackAgentRegistrationOperation<T>(result: Promise<T>): Promise<T> {
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.agentRegistrationTasks.add(settled);
    void settled.then(() => {
      this.agentRegistrationTasks.delete(settled);
    });
    return result;
  }

  /**
   * Flush any background persistence work (best-effort).
   */
  async flush(): Promise<void> {
    await this.flushTasks({ includeAgentRegistrations: false });
  }

  /**
   * Drain registrations that crossed the synchronous shutdown fence. Each operation owns a
   * provider process/thread until it either installs it or closes it.
   */
  async flushForShutdown(): Promise<void> {
    await this.flushTasks({ includeAgentRegistrations: true });
  }

  private async flushTasks(options: { includeAgentRegistrations: boolean }): Promise<void> {
    this.agentStreamCoalescer.flushAll();
    // Drain tasks, including tasks spawned while awaiting.
    while (
      this.backgroundTasks.size > 0 ||
      (options.includeAgentRegistrations && this.agentRegistrationTasks.size > 0)
    ) {
      const pending = options.includeAgentRegistrations
        ? [...this.backgroundTasks, ...this.agentRegistrationTasks]
        : [...this.backgroundTasks];
      await Promise.allSettled(pending);
    }
  }

  private broadcastAgentAttention(
    agent: ManagedAgent,
    reason: "finished" | "error" | "permission",
  ): void {
    if (isDelegatedAgent(agent)) {
      return;
    }

    this.onAgentAttention?.({
      agentId: agent.id,
      provider: agent.provider,
      reason,
    });
  }

  private dispatchStream(
    agentId: string,
    event: AgentStreamEvent,
    metadata?: { seq?: number; epoch?: string; timestamp?: string },
  ): void {
    const agent = this.agents.get(agentId);
    this.logger.trace(
      {
        agentId,
        provider: event.provider,
        sessionId: agent?.persistence?.sessionId ?? undefined,
        turnId: getAgentStreamEventTurnId(event),
        metadata,
        event,
      },
      "execution.service.dispatch_stream",
    );
    this.dispatch({ type: "agent_stream", agentId, event, ...metadata });
  }

  private dispatch(event: ExecutionServiceEvent): void {
    for (const subscriber of this.subscribers) {
      if (
        subscriber.agentId &&
        event.type === "agent_stream" &&
        subscriber.agentId !== event.agentId
      ) {
        continue;
      }
      if (
        subscriber.agentId &&
        event.type === "agent_state" &&
        subscriber.agentId !== event.agent.id
      ) {
        continue;
      }
      // Skip internal agents for global subscribers (those without a specific agentId)
      if (!subscriber.agentId) {
        if (event.type === "agent_state" && event.agent.internal) {
          continue;
        }
        if (event.type === "agent_stream") {
          const agent = this.agents.get(event.agentId);
          if (agent?.internal) {
            continue;
          }
        }
      }
      subscriber.callback(event);
    }
  }

  private async normalizeConfig(
    config: AgentSessionConfig,
    options: NormalizeConfigOptions = {},
  ): Promise<AgentSessionConfig> {
    const normalized: AgentSessionConfig = { ...config };

    // Always resolve cwd to absolute path for consistent history file lookup
    if (normalized.cwd) {
      normalized.cwd = resolve(normalized.cwd);
      try {
        const cwdStats = await stat(normalized.cwd);
        if (!cwdStats.isDirectory()) {
          throw new Error(`Working directory is not a directory: ${normalized.cwd}`);
        }
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          throw new Error(`Working directory does not exist: ${normalized.cwd}`, { cause: error });
        }
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(`Failed to access working directory: ${normalized.cwd}`, { cause: error });
      }
    }

    if (typeof normalized.model === "string") {
      const trimmed = normalized.model.trim();
      normalized.model = trimmed.length > 0 && trimmed !== "default" ? trimmed : undefined;
    }

    const shouldResolveDefaultModel = options.resolveDefaultModel ?? true;
    if (shouldResolveDefaultModel && !normalized.model) {
      const defaultModelId = await this.resolveDefaultModelId(normalized);
      if (defaultModelId) {
        normalized.model = defaultModelId;
      }
    }

    if (!normalized.modeId) {
      const defaultModeId = await this.resolveDefaultModeId(
        normalized,
        options.allowDefaultModeCatalogLookup ?? true,
      );
      if (defaultModeId) {
        normalized.modeId = defaultModeId;
      }
    }

    return normalized;
  }

  private async resolveDefaultModelId(config: AgentSessionConfig): Promise<string | undefined> {
    const definition = this.providerDefinitions.get(config.provider);
    if (!definition) {
      return undefined;
    }
    try {
      const client = await this.loadAdapter(config.provider);
      const catalog = await client.fetchCatalog({
        scope: "workspace",
        cwd: config.cwd,
        force: false,
      });
      return (catalog.models.find((model) => model.isDefault) ?? catalog.models[0])?.id;
    } catch {
      // Provider may not support model listing — leave model undefined.
      return undefined;
    }
  }

  private async resolveDefaultModeId(
    config: AgentSessionConfig,
    allowCatalogLookup: boolean,
  ): Promise<string | undefined> {
    const definition = this.providerDefinitions.get(config.provider);
    if (!definition) {
      return undefined;
    }
    if (definition.defaultModeId) {
      return definition.defaultModeId;
    }
    if (!allowCatalogLookup) {
      return undefined;
    }
    try {
      const client = await this.loadAdapter(config.provider);
      const catalog = await client.fetchCatalog({
        scope: "workspace",
        cwd: config.cwd,
        force: false,
      });
      return catalog.defaultModeId ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async prepareSessionConfig(
    config: AgentSessionConfig,
    agentId: string,
  ): Promise<PreparedSessionConfig> {
    const provisionedConfig = this.foregroundThothSessionProvisioner
      ? await this.foregroundThothSessionProvisioner({ agentId, config })
      : config;
    const storedConfig = await this.normalizeConfig(stripInternalThothMcpServer(provisionedConfig));
    const launchConfig = this.applyDaemonAppendSystemPrompt(
      withRuntimeThothMcpServer({
        config: storedConfig,
        agentId,
        mcpBaseUrl: this.mcpBaseUrl,
        mcpAuthToken: this.mcpAuthToken,
      }),
    );
    return { storedConfig, launchConfig };
  }

  private applyDaemonAppendSystemPrompt(config: AgentSessionConfig): AgentSessionConfig {
    const daemonAppendSystemPrompt = this.appendSystemPrompt.trim();
    const next = { ...config };
    delete next.daemonAppendSystemPrompt;

    return daemonAppendSystemPrompt
      ? {
          ...next,
          daemonAppendSystemPrompt,
        }
      : next;
  }

  private async buildLaunchContext(
    agentId: string,
    client: HarnessAdapter,
    launchConfig: AgentSessionConfig,
    env?: Record<string, string>,
  ): Promise<AgentLaunchContext> {
    const context: AgentLaunchContext = {
      agentId,
      env: {
        ...env,
        THOTH_AGENT_ID: agentId,
      },
    };
    if (
      this.thothToolsEnabled &&
      client.harnessCapabilities.toolAttachment.includes("native") &&
      this.shouldUseNativeThothTools(launchConfig) &&
      this.thothToolCatalogFactory
    ) {
      context.thothTools = await this.thothToolCatalogFactory({
        callerAgentId: agentId,
        callerAgentConfig: launchConfig,
      });
    }
    return context;
  }

  private shouldUseNativeThothTools(config: AgentSessionConfig): boolean {
    return readThothRuntimeToolsConfig(config)?.enabled === true;
  }

  private resolveProviderLaunchConfig(
    launchConfig: AgentSessionConfig,
    launchContext: AgentLaunchContext,
  ): AgentSessionConfig {
    return launchContext.thothTools ? stripInternalThothMcpServer(launchConfig) : launchConfig;
  }

  private async requireAvailableAdapter(options: {
    provider: AgentProvider;
  }): Promise<HarnessAdapter> {
    if (!this.providerDefinitions.has(options.provider)) {
      const configuredProviders = this.getConfiguredProviderIds();
      throw new ProviderUnavailableError(
        options.provider,
        `Unknown provider '${options.provider}'. Configured providers: ${formatProviderList(
          configuredProviders,
        )}.`,
      );
    }

    const client = await this.loadAdapter(options.provider);
    let unavailableReason: string | null = null;
    try {
      const available = await client.isAvailable();
      if (available) {
        return client;
      }
    } catch (error) {
      unavailableReason = error instanceof Error ? error.message : String(error);
    }

    const availableProviders = (await this.listProviderAvailability())
      .filter((entry) => entry.available)
      .map((entry) => entry.provider);
    const providerList = formatProviderList(availableProviders);
    const reason = unavailableReason ? ` Reason: ${unavailableReason}.` : "";
    throw new Error(
      `Provider '${options.provider}' is not available.${reason} Available providers: ${providerList}. Use one of those providers, or install/configure '${options.provider}'.`,
    );
  }

  private requireEnabledProvider(provider: AgentProvider): void {
    const definition = this.providerDefinitions.get(provider);
    if (!definition) {
      const configuredProviders = this.getConfiguredProviderIds();
      throw new ProviderUnavailableError(
        provider,
        `Unknown provider '${provider}'. Configured providers: ${formatProviderList(
          configuredProviders,
        )}.`,
      );
    }
    if (definition.enabled === false) {
      throw new Error(`Provider '${provider}' is disabled`);
    }
  }

  private getConfiguredProviderIds(): AgentProvider[] {
    return Array.from(this.providerDefinitions.keys());
  }

  private async loadAdapter(provider: AgentProvider): Promise<HarnessAdapter> {
    const current = this.adapters.get(provider);
    if (current) return current;
    const definition = this.providerDefinitions.get(provider);
    if (!definition) {
      throw new ProviderUnavailableError(
        provider,
        `Provider '${provider}' is no longer configured and cannot start or resume a session`,
      );
    }
    if (!definition.loadAdapter) {
      throw new Error(`Provider '${provider}' has no adapter loader`);
    }
    const pending = this.adapterLoads.get(provider) ?? definition.loadAdapter();
    this.adapterLoads.set(provider, pending);
    try {
      const adapter = await pending;
      this.adapters.set(provider, adapter);
      return adapter;
    } finally {
      if (this.adapterLoads.get(provider) === pending) this.adapterLoads.delete(provider);
    }
  }

  async archiveNativeSessionBestEffort(
    provider: AgentProvider,
    persistence: AgentPersistenceHandle | null | undefined,
  ): Promise<void> {
    if (!persistence) return;
    const client = await this.loadAdapter(provider).catch(() => null);
    if (!client?.archiveNativeSession) return;
    try {
      await client.archiveNativeSession(
        persistence,
        this.buildPersistenceControlLaunchContext(provider, persistence),
      );
    } catch (error) {
      this.logger.warn(
        { error, provider, sessionId: persistence.sessionId },
        "Failed to archive native session (best-effort)",
      );
    }
  }

  private async unarchiveNativeSession(
    provider: AgentProvider,
    persistence: AgentPersistenceHandle | null | undefined,
  ): Promise<void> {
    if (!persistence) return;
    const client = await this.loadAdapter(provider);
    if (!client.unarchiveNativeSession) return;
    await client.unarchiveNativeSession(
      persistence,
      this.buildPersistenceControlLaunchContext(provider, persistence),
    );
  }

  private async withProviderControlLaunchContext<T>(
    _provider: AgentProvider,
    run: (launchContext: AgentLaunchContext) => Promise<T>,
  ): Promise<T> {
    return await run({ env: {} });
  }

  private buildPersistenceControlLaunchContext(
    _provider: AgentProvider,
    _persistence: AgentPersistenceHandle,
  ): AgentLaunchContext {
    return { env: {} };
  }

  private requireAgent(id: string): LiveManagedAgent {
    const normalizedId = validateAgentId(id, "requireAgent");
    const agent = this.agents.get(normalizedId);
    if (!agent) {
      throw new Error(`Unknown agent '${normalizedId}'`);
    }
    return agent;
  }

  private requireTimelineAgent(id: string): LiveManagedAgent | ManagedAgentClosed {
    const normalizedId = validateAgentId(id, "requireTimelineAgent");
    const agent = this.agents.get(normalizedId) ?? this.historyOnlyAgents.get(normalizedId);
    if (!agent) {
      throw new Error(`Unknown agent '${normalizedId}'`);
    }
    return agent;
  }

  private requireSessionAgent(id: string): ActiveManagedAgent {
    const agent = this.requireAgent(id);
    if (agent.session === null) {
      throw new Error(`Agent '${agent.id}' has no managed session`);
    }
    return agent;
  }
}

export function commandMayHaveChangedExternalState(command: string): boolean {
  const normalized = command.toLowerCase();
  // Commands that operate on remote state and do NOT trigger local file
  // watchers. Local git mutations (commit, checkout, merge, rebase, reset,
  // pull) are already caught by watchers on .git/HEAD and refs/heads/.
  return (
    // GitHub PR operations (merge, close, create, edit, comment, review)
    /\bgh\s+pr\s+(merge|close|create|edit|comment|review)\b/.test(normalized) ||
    // Pushes to remote — local refs unchanged, but remote state (PR checks,
    // mergeable status) may shift immediately after.
    /\bgit\s+push\b/.test(normalized) ||
    // Fetches update refs/remotes/ which our watchers do not watch, so
    // ahead/behind counts can drift stale until the next refresh.
    /\bgit\s+fetch\b/.test(normalized)
  );
}
