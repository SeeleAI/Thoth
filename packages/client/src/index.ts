import type {
  AgentSnapshotPayload,
  CreateAgentRequestMessage,
  FetchWorkspacesRequestMessage,
  FetchWorkspacesResponseMessage,
  GetProvidersSnapshotResponseMessage,
  ListAvailableProvidersResponse,
  ListProviderFeaturesRequestMessage,
  ListProviderFeaturesResponseMessage,
  ListProviderModelsResponseMessage,
  ListProviderModesResponseMessage,
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
  ProviderDiagnosticResponseMessage,
  ProjectPlacementPayload,
  RefreshProvidersSnapshotResponseMessage,
  SendAgentMessageRequest,
  SessionOutboundMessage,
  WorkspaceDescriptorPayload,
} from "@thoth/protocol/messages";
import { DaemonClient } from "./daemon-client.js";
import type {
  FetchAgentTimelineCursor,
  FetchAgentTimelineDirection,
  FetchAgentTimelinePayload,
  FetchAgentTimelineProjection,
} from "./daemon-client.js";

export { DaemonClient };
export type {
  DaemonClientConfig,
  DaemonEvent,
  WebSocketFactory,
  WebSocketLike,
} from "./daemon-client.js";

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

export interface ThothLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface ThothClientConfig {
  url: string;
  clientId?: string;
  appVersion?: string;
  runtimeGeneration?: number | null;
  password?: string;
  authHeader?: string;
  suppressSendErrors?: boolean;
  logger?: ThothLogger;
  connectTimeoutMs?: number;
  e2ee?: {
    enabled?: boolean;
    daemonPublicKeyB64?: string;
  };
  reconnect?: {
    enabled?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  runtimeMetricsIntervalMs?: number;
  runtimeMetricsWindowMs?: number;
}

export type ThothWorkspace = WorkspaceDescriptorPayload;
export type ThothAgent = AgentSnapshotPayload;
export type ThothWorkspaceListOptions = Omit<
  FetchWorkspacesRequestMessage,
  "type" | "requestId"
> & {
  requestId?: string;
};

export interface ThothWorkspaceListResult {
  requestId: string;
  subscriptionId?: string | null;
  entries: ThothWorkspace[];
  pageInfo: FetchWorkspacesResponseMessage["payload"]["pageInfo"];
}

export interface ThothWorkspaceOpenOptions {
  cwd: string;
  requestId?: string;
}

export interface ThothWorkspaceOpenResult {
  requestId: string;
  workspace: ThothWorkspaceHandle | null;
  error: string | null;
}

export interface ThothWorkspaceArchiveResult {
  requestId: string;
  workspaceId: string;
  archivedAt: string | null;
  error: string | null;
}

export type ThothWorkspaceUpdate = Extract<
  SessionOutboundMessage,
  { type: "workspace_update" }
>["payload"];

export type ThothWorkspaceUpdateHandler = (update: ThothWorkspaceUpdate) => void;

/**
 * A handle is a stable typed reference to a daemon resource. Its identity is the
 * daemon id, and `latest()` only returns the most recent snapshot this handle has
 * seen through construction, `refetch()`, or this handle's local subscription.
 */
export interface ThothWorkspaceHandle {
  readonly id: string;
  latest(): ThothWorkspace | null;
  /**
   * Fetches a fresh workspace snapshot through the existing workspace list RPC,
   * exact-matches this handle id from the result, and updates `latest()`.
   */
  refetch(options?: { requestId?: string }): Promise<ThothWorkspace | null>;
  archive(requestId?: string): Promise<ThothWorkspaceArchiveResult>;
  /**
   * Subscribes to already-emitted daemon workspace_update events for this id.
   * This returns a local unsubscribe function; it does not own app cache state or
   * send a daemon unsubscribe RPC. Call `workspaces.list({ subscribe: {} })` when
   * the daemon should start streaming workspace directory updates.
   */
  subscribe(handler: (update: ThothWorkspaceUpdate) => void): () => void;
}

export interface ThothWorkspaceActions {
  list(options?: ThothWorkspaceListOptions): Promise<ThothWorkspaceListResult>;
  ref(workspace: string | ThothWorkspace): ThothWorkspaceHandle;
  open(
    input: string | ThothWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<ThothWorkspaceOpenResult>;
  create(
    input: string | ThothWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<ThothWorkspaceOpenResult>;
  archive(
    workspace: string | ThothWorkspaceHandle,
    requestId?: string,
  ): Promise<ThothWorkspaceArchiveResult>;
  /**
   * Local event subscription over the low-level driver's workspace_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: ThothWorkspaceUpdateHandler): () => void;
}

type ThothAgentSessionConfig = CreateAgentRequestMessage["config"];
type ThothAgentProvider = ThothAgentSessionConfig["provider"];
type ThothAgentConfigOverrides = Partial<Omit<ThothAgentSessionConfig, "provider" | "cwd">>;

export interface ThothAgentCreateOptions extends ThothAgentConfigOverrides {
  config?: ThothAgentSessionConfig;
  provider?: CreateAgentRequestMessage["config"]["provider"];
  cwd?: string;
  workspaceId?: string;
  initialPrompt?: string;
  thoth?: CreateAgentRequestMessage["thoth"];
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: CreateAgentRequestMessage["git"];
  worktreeName?: string;
  requestId?: string;
  labels?: Record<string, string>;
}

export interface ThothAgentRefetchResult {
  agent: ThothAgent;
  project: ProjectPlacementPayload | null;
}

export interface ThothAgentTimelineRefetchOptions {
  direction?: FetchAgentTimelineDirection;
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  projection?: FetchAgentTimelineProjection;
  requestId?: string;
}

export interface ThothAgentSendOptions {
  messageId?: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: SendAgentMessageRequest["attachments"];
}

export type ThothAgentUpdate = Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];

export type ThothAgentStream = Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"];

export type ThothAgentUpdateHandler = (update: ThothAgentUpdate) => void;

export interface ThothAgentTimelineHandle {
  /**
   * Fetches a fresh timeline page through the existing daemon RPC. If the daemon
   * includes an agent snapshot in the response, the parent handle's `latest()`
   * is updated to that snapshot.
   */
  refetch(options?: ThothAgentTimelineRefetchOptions): Promise<FetchAgentTimelinePayload>;
  /**
   * Local listener for agent_stream events matching this handle id. It does not
   * retain timeline entries or own application cache state.
   */
  subscribe(handler: (event: ThothAgentStream) => void): () => void;
}

/**
 * Agent handles follow the same identity/snapshot rule as workspace handles:
 * `id` is stable, while `latest()` is only the newest snapshot observed by this
 * handle through construction, `refetch()`, timeline refetch, archive, or local
 * agent_update subscription.
 */
export interface ThothAgentHandle {
  readonly id: string;
  readonly timeline: ThothAgentTimelineHandle;
  latest(): ThothAgent | null;
  refetch(requestId?: string): Promise<ThothAgentRefetchResult | null>;
  send(text: string, options?: ThothAgentSendOptions): Promise<void>;
  archive(): Promise<{ archivedAt: string }>;
  detach(): Promise<void>;
  subscribe(handler: (update: ThothAgentUpdate) => void): () => void;
}

export interface ThothAgentActions {
  ref(agent: string | ThothAgent): ThothAgentHandle;
  create(options: ThothAgentCreateOptions): Promise<ThothAgentHandle>;
  /**
   * Local event subscription over the low-level driver's agent_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: ThothAgentUpdateHandler): () => void;
}

export interface ThothProviderConfig extends ThothProviderConfigInput {
  provider: ThothAgentProvider;
}
export type ThothProviderFeatureValues = Record<string, unknown>;

export interface ThothProviderConfigInput {
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: ThothProviderFeatureValues;
}

export type ThothProviderModelsResult = ListProviderModelsResponseMessage["payload"];
export type ThothProviderModesResult = ListProviderModesResponseMessage["payload"];
export type ThothProviderFeaturesInput = ListProviderFeaturesRequestMessage["draftConfig"];
export type ThothProviderFeaturesResult = ListProviderFeaturesResponseMessage["payload"];
export type ThothProviderAvailabilityResult = ListAvailableProvidersResponse["payload"];
export type ThothProviderSnapshotResult = GetProvidersSnapshotResponseMessage["payload"];
export type ThothProviderSnapshotUpdate = Extract<
  SessionOutboundMessage,
  { type: "providers_snapshot_update" }
>["payload"];
export type ThothProviderRefreshResult = RefreshProvidersSnapshotResponseMessage["payload"];
export type ThothProviderDiagnosticResult = ProviderDiagnosticResponseMessage["payload"];

export interface ThothProviderListOptions {
  cwd?: string;
  requestId?: string;
}

export interface ThothProviderRefreshOptions {
  cwd?: string;
  providers?: ThothAgentProvider[];
  requestId?: string;
}

export interface ThothProviderActions {
  codex(input?: ThothProviderConfigInput): ThothProviderConfig;
  claude(input?: ThothProviderConfigInput): ThothProviderConfig;
  opencode(input?: ThothProviderConfigInput): ThothProviderConfig;
  copilot(input?: ThothProviderConfigInput): ThothProviderConfig;
  config(provider: ThothAgentProvider, input?: ThothProviderConfigInput): ThothProviderConfig;
  listModels(
    provider: ThothAgentProvider,
    options?: ThothProviderListOptions,
  ): Promise<ThothProviderModelsResult>;
  listModes(
    provider: ThothAgentProvider,
    options?: ThothProviderListOptions,
  ): Promise<ThothProviderModesResult>;
  listFeatures(
    draftConfig: ThothProviderFeaturesInput,
    options?: { requestId?: string },
  ): Promise<ThothProviderFeaturesResult>;
  listAvailable(options?: { requestId?: string }): Promise<ThothProviderAvailabilityResult>;
  snapshot(options?: ThothProviderListOptions): Promise<ThothProviderSnapshotResult>;
  refresh(options?: ThothProviderRefreshOptions): Promise<ThothProviderRefreshResult>;
  diagnostic(
    provider: ThothAgentProvider,
    options?: { requestId?: string },
  ): Promise<ThothProviderDiagnosticResult>;
  subscribe(handler: (update: ThothProviderSnapshotUpdate) => void): () => void;
}

export interface ThothConfigActions {
  /**
   * Reads daemon config through the existing config RPC. Provider profiles,
   * custom provider entries, keys/env, custom binaries, and provider enablement
   * are currently config-file-shaped daemon state, so the SDK exposes this raw
   * typed surface instead of pretending there are higher-level provider-settings
   * RPCs.
   */
  get(requestId?: string): Promise<{ requestId: string; config: MutableDaemonConfig }>;
  /**
   * Patches daemon config through the existing config RPC. The daemon validates
   * and persists supported fields; unsupported provider/settings workflows remain
   * daemon gaps until first-class RPCs exist.
   */
  patch(
    config: MutableDaemonConfigPatch,
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }>;
}

export interface ThothClient {
  readonly workspaces: ThothWorkspaceActions;
  readonly agents: ThothAgentActions;
  readonly providers: ThothProviderActions;
  readonly config: ThothConfigActions;
  connect(): Promise<void>;
  close(): Promise<void>;
  ensureConnected(): void;
  getConnectionState(): ConnectionState;
}

export function createThothClient(config: ThothClientConfig): ThothClient {
  const daemonClient = new DaemonClient({
    ...config,
    clientId: config.clientId ?? createGeneratedClientId(),
    clientType: "cli",
  });
  const createWorkspaceHandle = createWorkspaceHandleFactory(daemonClient);
  const createAgentHandle = createAgentHandleFactory(daemonClient);

  return {
    workspaces: {
      list: (options) => daemonClient.fetchWorkspaces(options),
      ref: (workspace) => createWorkspaceHandle(workspace),
      open: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      create: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      archive: (workspace, requestId) =>
        daemonClient.archiveWorkspace(resolveWorkspaceId(workspace), requestId),
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          handler(message.payload);
        }),
    },
    agents: {
      ref: (agent) => createAgentHandle(agent),
      create: async (options) => {
        const agent = await daemonClient.createAgent(options);
        return createAgentHandle(agent);
      },
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          handler(message.payload);
        }),
    },
    providers: {
      codex: (input) => providerConfig("codex", input),
      claude: (input) => providerConfig("claude", input),
      opencode: (input) => providerConfig("opencode", input),
      copilot: (input) => providerConfig("copilot", input),
      config: (provider, input) => providerConfig(provider, input),
      listModels: (provider, options) => daemonClient.listProviderModels(provider, options),
      listModes: (provider, options) => daemonClient.listProviderModes(provider, options),
      listFeatures: (draftConfig, options) =>
        daemonClient.listProviderFeatures(draftConfig, options),
      listAvailable: (options) => daemonClient.listAvailableProviders(options),
      snapshot: (options) => daemonClient.getProvidersSnapshot(options),
      refresh: (options) => daemonClient.refreshProvidersSnapshot(options),
      diagnostic: (provider, options) => daemonClient.getProviderDiagnostic(provider, options),
      subscribe: (handler) =>
        daemonClient.on("providers_snapshot_update", (message) => {
          handler(message.payload);
        }),
    },
    config: {
      get: (requestId) => daemonClient.getDaemonConfig(requestId),
      patch: (patch, requestId) => daemonClient.patchDaemonConfig(patch, requestId),
    },
    connect: () => daemonClient.connect(),
    close: () => daemonClient.close(),
    ensureConnected: () => daemonClient.ensureConnected(),
    getConnectionState: () => daemonClient.getConnectionState(),
  };
}

type WorkspaceHandleFactory = (workspace: string | ThothWorkspace) => ThothWorkspaceHandle;
type AgentHandleFactory = (agent: string | ThothAgent) => ThothAgentHandle;

function createWorkspaceHandleFactory(daemonClient: DaemonClient): WorkspaceHandleFactory {
  return (workspace) => {
    const id = typeof workspace === "string" ? workspace : workspace.id;
    let latest = typeof workspace === "string" ? null : workspace;

    return {
      id,
      latest: () => latest,
      refetch: async (options) => {
        // Best-effort: fetches one page and matches by id client-side, so a workspace beyond
        // the first page won't be found. TODO: add a "get workspace by id" lookup and resolve
        // by exact id instead of paging.
        const result = await daemonClient.fetchWorkspaces({
          requestId: options?.requestId,
          page: { limit: 25 },
        });
        latest = result.entries.find((entry) => entry.id === id) ?? null;
        return latest;
      },
      archive: async (requestId) => {
        const result = await daemonClient.archiveWorkspace(id, requestId);
        if (latest) {
          latest = { ...latest, archivingAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.workspace.id === id) {
            latest = update.workspace;
            handler(update);
          }
          if (update.kind === "remove" && update.id === id) {
            latest = null;
            handler(update);
          }
        }),
    };
  };
}

function createAgentHandleFactory(daemonClient: DaemonClient): AgentHandleFactory {
  return (agent) => {
    const id = typeof agent === "string" ? agent : agent.id;
    let latest = typeof agent === "string" ? null : agent;

    const handle: ThothAgentHandle = {
      id,
      timeline: {
        refetch: async (options) => {
          const result = await daemonClient.fetchAgentTimeline(id, options);
          if (result.agent) {
            latest = result.agent;
          }
          return result;
        },
        subscribe: (handler) =>
          daemonClient.on("agent_stream", (message) => {
            if (message.payload.agentId === id) {
              handler(message.payload);
            }
          }),
      },
      latest: () => latest,
      refetch: async (requestId) => {
        const result = await daemonClient.fetchAgent({ agentId: id, requestId });
        latest = result?.agent ?? null;
        return result;
      },
      send: async (text, options) => {
        await daemonClient.sendAgentMessage(id, text, options);
      },
      archive: async () => {
        const result = await daemonClient.archiveAgent(id);
        if (latest) {
          latest = { ...latest, archivedAt: result.archivedAt };
        }
        return result;
      },
      detach: async () => {
        await daemonClient.detachAgent(id);
      },
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.agent.id === id) {
            latest = update.agent;
            handler(update);
          }
          if (update.kind === "remove" && update.agentId === id) {
            latest = null;
            handler(update);
          }
        }),
    };

    return handle;
  };
}

async function openWorkspace(
  daemonClient: DaemonClient,
  createWorkspaceHandle: WorkspaceHandleFactory,
  input: string | ThothWorkspaceOpenOptions,
  requestId?: string,
): Promise<ThothWorkspaceOpenResult> {
  const options = typeof input === "string" ? { cwd: input, requestId } : input;
  const result = await daemonClient.openProject(options.cwd, options.requestId);
  return {
    ...result,
    workspace: result.workspace ? createWorkspaceHandle(result.workspace) : null,
  };
}

function resolveWorkspaceId(workspace: string | ThothWorkspaceHandle): string {
  return typeof workspace === "string" ? workspace : workspace.id;
}

function providerConfig(
  provider: ThothAgentProvider,
  input: ThothProviderConfigInput = {},
): ThothProviderConfig {
  return {
    provider,
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.modeId !== undefined ? { modeId: input.modeId } : {}),
    ...(input.thinkingOptionId !== undefined ? { thinkingOptionId: input.thinkingOptionId } : {}),
    ...(input.featureValues !== undefined ? { featureValues: input.featureValues } : {}),
  };
}

function createGeneratedClientId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `thoth-sdk-${randomId}`;
}
