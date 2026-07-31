import type { z } from "zod";
import { CLIENT_CAPS } from "@thoth/protocol/client-capabilities";
import {
  AgentCreateFailedStatusPayloadSchema,
  AgentCreatedStatusPayloadSchema,
  AgentRefreshedStatusPayloadSchema,
  AgentResumedStatusPayloadSchema,
  CheckoutRenameBranchResponseSchema,
  parseServerInfoStatusPayload,
  RenameTerminalResponseSchema,
  RestartRequestedStatusPayloadSchema,
  RPC_PROTOCOL_VERSION,
  ShutdownRequestedStatusPayloadSchema,
  SessionInboundMessageSchema,
  rpcRegistry,
  type ProtocolRpcInput,
  type ProtocolRpcOperation,
  type ProtocolRpcResponse,
  type ServerInfoStatusPayload,
  WSOutboundMessageSchema,
} from "@thoth/protocol/messages";
import type {
  AgentStreamEventPayload,
  AgentSnapshotPayload,
  ProjectPlacementPayload,
  AgentPermissionResolvedMessage,
  CreateAgentRequestMessage,
  CreateThothWorktreeRequest,
  FileUploadResponse,
  FileExplorerResponse,
  FetchAgentTimelineResponseMessage,
  AgentForkContextResponseMessage,
  GitSetupOptions,
  CheckoutStatusResponse,
  CheckoutPrMergeMethod,
  GitHubSearchRequest,
  ListCommandsResponse,
  SubscribeTerminalResponse,
  SubscribeTerminalRequest,
  TerminalInput,
  SessionInboundMessage,
  SessionOutboundMessage,
  SendAgentMessageRequest,
  ThothConfigRaw,
  ThothConfigRevision,
  WorkspaceCreateRequest,
  AgentProviderQuestionRespondResponse,
} from "@thoth/protocol/messages";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPersistenceHandle,
  AgentProvider,
  ProviderQuestionResolution,
  AgentSessionConfig,
} from "@thoth/protocol/agent-types";
import type { AgentThothStateUpdate } from "@thoth/protocol/thoth/rpc-schemas";
import type { ProviderRunMode } from "@thoth/protocol/provider-control";
import { isRelayClientWebSocketUrl } from "@thoth/protocol/daemon-endpoints";
import { terminalSubscriptionKey } from "@thoth/protocol/terminal-subscription-key";
import {
  asUint8Array,
  decodeFileTransferFrame,
  encodeFileTransferFrame,
  decodeTerminalStreamFrame,
  FileTransferOpcode,
  TerminalStreamOpcode,
  type FileTransferFrame,
} from "@thoth/protocol/binary-frames/index";
import {
  createRelayE2eeTransportFactory,
  createWebSocketTransportFactory,
  decodeMessageData,
  defaultWebSocketFactory,
  describeTransportClose,
  describeTransportError,
  type DaemonTransport,
  type DaemonTransportFactory,
  type WebSocketFactory,
} from "./daemon-client-transport.js";
import { DaemonClientRuntimeMetrics } from "./daemon-client-runtime-metrics.js";
import { TerminalStreamRouter, type TerminalStreamEvent } from "./terminal-stream-router.js";
import type { BrowserAutomationExecuteResponse } from "@thoth/protocol/browser-automation/rpc-schemas";

export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

const consoleLogger: Logger = {
  debug: () => {},
  info: (obj, msg) => console.log(msg, obj),
  warn: (obj, msg) => console.warn(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
};

const perfNow: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

interface ImportAgentInputBase {
  workspaceId: string;
  cwd?: string;
  labels?: Record<string, string>;
}

export type ImportAgentInput =
  | (ImportAgentInputBase & {
      providerId: string;
      providerHandleId: string;
    })
  | (ImportAgentInputBase & {
      provider: AgentProvider;
      sessionId: string;
    });

function normalizePassword(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.length > 0 ? value : null;
}

export type {
  DaemonTransport,
  DaemonTransportFactory,
  WebSocketFactory,
  WebSocketLike,
} from "./daemon-client-transport.js";

export type { TerminalStreamEvent };

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

export type DaemonEvent =
  | {
      type: "agent_update";
      agentId: string;
      payload: Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];
    }
  | {
      type: "workspace_update";
      workspaceId: string;
      payload: Extract<SessionOutboundMessage, { type: "workspace_update" }>["payload"];
    }
  | {
      type: "workspace_setup_progress";
      workspaceId: string;
      payload: Extract<SessionOutboundMessage, { type: "workspace_setup_progress" }>["payload"];
    }
  | {
      type: "agent_stream";
      agentId: string;
      event: AgentStreamEventPayload;
      timestamp: string;
      seq?: number;
      epoch?: string;
    }
  | { type: "status"; payload: { status: string } & Record<string, unknown> }
  | { type: "agent_deleted"; agentId: string }
  | {
      type: "agent_permission_request";
      agentId: string;
      request: AgentPermissionRequest;
    }
  | {
      type: "agent_permission_resolved";
      agentId: string;
      requestId: string;
      resolution: AgentPermissionResponse;
    }
  | {
      type: "providers_snapshot_update";
      payload: Extract<SessionOutboundMessage, { type: "providers_snapshot_update" }>["payload"];
    }
  | {
      type: "agent_thoth_state_update";
      payload: AgentThothStateUpdate["payload"];
    }
  | {
      type: "workspace_authority_update";
      workspaceId: string;
      payload: Extract<SessionOutboundMessage, { type: "workspace.authority.update" }>["payload"];
    }
  | { type: "error"; message: string };

export type DaemonEventHandler = (event: DaemonEvent) => void;

export interface DaemonClientConfig {
  url: string;
  clientId: string;
  clientType?: "mobile" | "browser" | "cli" | "mcp";
  appVersion?: string;
  runtimeGeneration?: number | null;
  capabilities?: Record<string, unknown>;
  password?: string;
  authHeader?: string;
  protocols?: string[];
  suppressSendErrors?: boolean;
  transportFactory?: DaemonTransportFactory;
  webSocketFactory?: WebSocketFactory;
  logger?: Logger;
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

export interface SendMessageOptions {
  messageId?: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: SendAgentMessageRequest["attachments"];
  thoth?: SendAgentMessageRequest["thoth"];
  providerRunMode?: SendAgentMessageRequest["providerRunMode"];
  contextRefs?: SendAgentMessageRequest["contextRefs"];
  deliveryMode?: SendAgentMessageRequest["deliveryMode"];
}

type AgentConfigOverrides = Partial<Omit<AgentSessionConfig, "provider" | "cwd">>;

export interface CreateAgentRequestOptions extends AgentConfigOverrides {
  config?: CreateAgentRequestMessage["config"];
  provider?: AgentProvider;
  cwd?: string;
  env?: CreateAgentRequestMessage["env"];
  workspaceId?: string;
  initialPrompt?: string;
  thoth?: CreateAgentRequestMessage["thoth"];
  providerRunMode?: CreateAgentRequestMessage["providerRunMode"];
  contextRefs?: CreateAgentRequestMessage["contextRefs"];
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: GitSetupOptions;
  worktree?: CreateAgentRequestMessage["worktree"];
  autoArchive?: CreateAgentRequestMessage["autoArchive"];
  worktreeName?: string;
  requestId?: string;
  labels?: Record<string, string>;
}

export interface CreateThothWorktreeInput extends Pick<
  CreateThothWorktreeRequest,
  | "cwd"
  | "projectId"
  | "worktreeSlug"
  | "firstAgentContext"
  | "refName"
  | "action"
  | "githubPrNumber"
> {}

type CheckoutStatusPayload = CheckoutStatusResponse["payload"];
type SubscribeCheckoutDiffPayload = Extract<
  SessionOutboundMessage,
  { type: "subscribe_checkout_diff_response" }
>["payload"];
type CheckoutDiffPayload = Omit<SubscribeCheckoutDiffPayload, "subscriptionId">;
export type RenameBranchResult = z.infer<typeof CheckoutRenameBranchResponseSchema>["payload"];
type AgentThothStateUpdatePayload = AgentThothStateUpdate["payload"];
type FileExplorerPayload = FileExplorerResponse["payload"];
export type FileExplorerDirectoryPayload = NonNullable<FileExplorerPayload["directory"]>;
type LegacyFileExplorerFilePayload = NonNullable<FileExplorerPayload["file"]>;
export interface FileReadResult {
  bytes: Uint8Array;
  mime: string;
  size: number;
  path: string;
  kind: LegacyFileExplorerFilePayload["kind"];
  modifiedAt: string;
  revision?: string;
}
export interface FileUploadInput {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array | ArrayBuffer;
  modifiedAt?: string;
  requestId?: string;
  chunkSize?: number;
}
export type FileUploadResult = FileUploadResponse["payload"];
type ListCommandsPayload = ListCommandsResponse["payload"];
type ListCommandsDraftConfig = Pick<
  AgentSessionConfig,
  "provider" | "cwd" | "modeId" | "model" | "thinkingOptionId" | "featureValues"
>;
export interface WriteProjectConfigInput {
  repoRoot: string;
  config: ThothConfigRaw;
  expectedRevision: ThothConfigRevision | null;
  requestId?: string;
}
interface ListCommandsOptions {
  agentId: string;
  requestId?: string;
  draftConfig?: ListCommandsDraftConfig;
}
type LegacyListCommandsOptions = Omit<ListCommandsOptions, "agentId">;
type AgentPermissionResolvedPayload = AgentPermissionResolvedMessage["payload"];
export type RenameTerminalResult = z.infer<typeof RenameTerminalResponseSchema>["payload"];
type SubscribeTerminalPayload = SubscribeTerminalResponse["payload"];
export type FetchAgentTimelinePayload = FetchAgentTimelineResponseMessage["payload"];
export type AgentForkContextPayload = AgentForkContextResponseMessage["payload"];

export type FetchAgentTimelineDirection = FetchAgentTimelinePayload["direction"];
export type FetchAgentTimelineProjection = FetchAgentTimelinePayload["projection"];
export type FetchAgentTimelineCursor = NonNullable<FetchAgentTimelinePayload["startCursor"]>;
export interface FetchAgentOptions {
  agentId: string;
  requestId?: string;
  timeout?: number;
}
type LegacyFetchAgentOptions = Omit<FetchAgentOptions, "agentId">;
export interface FetchAgentTimelineOptions {
  direction?: FetchAgentTimelineDirection;
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  projection?: FetchAgentTimelineProjection;
  requestId?: string;
  timeout?: number;
}

// COMPAT(daemon-client-object-options): added in v0.1.102; remove after
// 2026-12-29 once SDK callers have migrated to object parameters.
function normalizeFetchAgentOptions(
  input: FetchAgentOptions | string,
  legacyOptions?: LegacyFetchAgentOptions | string,
): FetchAgentOptions {
  if (typeof input !== "string") {
    return input;
  }
  if (typeof legacyOptions === "string") {
    return { agentId: input, requestId: legacyOptions };
  }
  return { agentId: input, ...legacyOptions };
}

function normalizeListCommandsOptions(
  input: ListCommandsOptions | string,
  legacyOptions?: LegacyListCommandsOptions | string,
): ListCommandsOptions {
  if (typeof input !== "string") {
    return input;
  }
  if (typeof legacyOptions === "string") {
    return { agentId: input, requestId: legacyOptions };
  }
  return { agentId: input, ...legacyOptions };
}
export interface AgentForkContextOptions {
  boundaryMessageId?: string;
  requestId?: string;
}

export interface ShutdownServerOptions {
  requestId?: string;
  timeout?: number;
}
export interface DaemonStatusOptions {
  requestId?: string;
  timeout?: number;
}
export interface DaemonPairingOfferOptions {
  requestId?: string;
  timeout?: number;
}
export interface DaemonIssueRelayDeviceTokenOptions {
  requestId?: string;
  timeout?: number;
}
type FetchAgentsPayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_agents_response" }
>["payload"];
type FetchAgentsRequest = Extract<SessionInboundMessage, { type: "fetch_agents_request" }>;
export type FetchAgentsOptions = Omit<FetchAgentsRequest, "type" | "requestId"> & {
  requestId?: string;
  timeout?: number;
};
export type FetchAgentsEntry = FetchAgentsPayload["entries"][number];
export type FetchAgentsPageInfo = FetchAgentsPayload["pageInfo"];
type FetchAgentHistoryPayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_agent_history_response" }
>["payload"];
type FetchAgentHistoryRequest = Extract<
  SessionInboundMessage,
  { type: "fetch_agent_history_request" }
>;
export type FetchAgentHistoryOptions = Omit<FetchAgentHistoryRequest, "type" | "requestId"> & {
  requestId?: string;
};
export type FetchAgentHistoryEntry = FetchAgentHistoryPayload["entries"][number];
export type FetchAgentHistoryPageInfo = FetchAgentHistoryPayload["pageInfo"];
type FetchRecentProviderSessionsPayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_recent_provider_sessions_response" }
>["payload"];
type FetchRecentProviderSessionsRequest = Extract<
  SessionInboundMessage,
  { type: "fetch_recent_provider_sessions_request" }
>;
export type FetchRecentProviderSessionsOptions = Omit<
  FetchRecentProviderSessionsRequest,
  "type" | "requestId"
> & {
  requestId?: string;
};
export type FetchRecentProviderSessionEntry = FetchRecentProviderSessionsPayload["entries"][number];
type FetchWorkspacesPayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_workspaces_response" }
>["payload"];
type FetchWorkspacesRequest = Extract<SessionInboundMessage, { type: "fetch_workspaces_request" }>;
export type FetchWorkspacesOptions = Omit<FetchWorkspacesRequest, "type" | "requestId"> & {
  requestId?: string;
};
export type FetchWorkspacesEntry = FetchWorkspacesPayload["entries"][number];
export type FetchWorkspacesPageInfo = FetchWorkspacesPayload["pageInfo"];
export interface CreateChatRoomOptions {
  workspaceId: string;
  name: string;
  purpose?: string | null;
  requestId?: string;
}
export interface InspectChatRoomOptions {
  workspaceId: string;
  room: string;
  requestId?: string;
}
export interface DeleteChatRoomOptions {
  workspaceId: string;
  room: string;
  requestId?: string;
}
export interface PostChatMessageOptions {
  workspaceId: string;
  room: string;
  body: string;
  authorAgentId?: string;
  replyToMessageId?: string | null;
  requestId?: string;
}
export interface ReadChatMessagesOptions {
  workspaceId: string;
  room: string;
  limit?: number;
  since?: string;
  authorAgentId?: string;
  requestId?: string;
  timeout?: number;
}
export interface WaitForChatMessagesOptions {
  workspaceId: string;
  room: string;
  afterMessageId?: string | null;
  timeoutMs?: number;
  requestId?: string;
}
export interface CreateScheduleOptions {
  workspaceId: string;
  prompt: string;
  intentContractId: string;
  name?: string | null;
  cadence:
    | {
        type: "every";
        everyMs: number;
      }
    | {
        type: "cron";
        expression: string;
        timezone?: string;
      };
  target:
    | {
        type: "self";
        agentId: string;
      }
    | {
        type: "agent";
        agentId: string;
      }
    | {
        type: "new-agent";
        config: {
          provider: AgentProvider;
          isolation?: "same-workspace" | "worktree";
          modeId?: string;
          model?: string;
          thinkingOptionId?: string;
          title?: string | null;
          approvalPolicy?: string;
          sandboxMode?: string;
          networkAccess?: boolean;
          webSearch?: boolean;
          extra?: AgentSessionConfig["extra"];
          systemPrompt?: string;
          mcpServers?: AgentSessionConfig["mcpServers"];
        };
      };
  maxRuns?: number;
  expiresAt?: string;
  runOnCreate?: boolean;
  requestId?: string;
}
export interface InspectScheduleOptions {
  workspaceId: string;
  id: string;
  requestId?: string;
}
export interface UpdateScheduleNewAgentConfig {
  provider?: string;
  model?: string | null;
  modeId?: string | null;
  isolation?: "same-workspace" | "worktree";
}
export interface UpdateScheduleOptions {
  workspaceId: string;
  id: string;
  name?: string | null;
  prompt?: string;
  cadence?:
    | {
        type: "every";
        everyMs: number;
      }
    | {
        type: "cron";
        expression: string;
        timezone?: string;
      };
  newAgentConfig?: UpdateScheduleNewAgentConfig;
  intentContractId?: string;
  maxRuns?: number | null;
  expiresAt?: string | null;
  requestId?: string;
}
export interface RenameBranchInput {
  cwd: string;
  branch: string;
  requestId?: string;
}
export interface RenameTerminalInput {
  terminalId: string;
  title: string;
  requestId?: string;
}
export interface FetchAgentResult {
  agent: AgentSnapshotPayload;
  project: ProjectPlacementPayload | null;
}

export interface WaitForFinishResult {
  status: "idle" | "error" | "permission" | "timeout";
  final: AgentSnapshotPayload | null;
  error: string | null;
  lastMessage: string | null;
}

interface Waiter<T> {
  predicate: (msg: SessionOutboundMessage) => T | null;
  resolve(value: T): void;
  reject(error: Error): void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

interface WaitHandle<T> {
  promise: Promise<T>;
  cancel: (error: Error) => void;
}

interface PendingBinaryFileRead {
  cwd: string;
  path: string;
}

interface BinaryFileTransferState extends PendingBinaryFileRead {
  mime: string;
  size: number;
  encoding: Extract<
    FileTransferFrame,
    { opcode: typeof FileTransferOpcode.FileBegin }
  >["metadata"]["encoding"];
  modifiedAt: string;
  revision?: string;
  bytesReceived: number;
  chunks: Uint8Array[];
}

type RpcWaitResult<T> = { kind: "ok"; value: T } | { kind: "error"; error: DaemonRpcError };

class DaemonRpcError extends Error {
  readonly requestId: string;
  readonly requestType?: string;
  readonly code?: string;

  constructor(params: { requestId: string; error: string; requestType?: string; code?: string }) {
    const parts = [params.error];
    if (params.requestType) parts.push(`requestType=${params.requestType}`);
    if (params.code) parts.push(`code=${params.code}`);
    super(parts.join(" "));
    this.name = "DaemonRpcError";
    this.requestId = params.requestId;
    this.requestType = params.requestType;
    this.code = params.code;
  }
}

class PingTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Ping timed out (${timeoutMs}ms)`);
    this.name = "PingTimeoutError";
  }
}

function toTimeoutError(error: unknown, label: string, timeoutMs: number): Error {
  if (error instanceof PingTimeoutError) {
    return new Error(`${label} timed out (${timeoutMs}ms)`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

const DEFAULT_RECONNECT_BASE_DELAY_MS = 1500;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30000;
const DEFAULT_SESSION_RPC_TIMEOUT_MS = 60_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_LIVENESS_TIMEOUT_MS = 5000;
const LIVENESS_HEARTBEAT_INTERVAL_MS = 10_000;
const LIVENESS_HEARTBEAT_TIMEOUT_MS = 15_000;
const LIVENESS_FAILURE_RECONNECT_THRESHOLD = 2;

/** Default timeout for waiting for connection before sending queued messages */
const DEFAULT_SEND_QUEUE_TIMEOUT_MS = DEFAULT_SESSION_RPC_TIMEOUT_MS;

function normalizeClientId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function legacyExplorerFileToBytes(file: LegacyFileExplorerFilePayload): FileReadResult {
  let bytes: Uint8Array;
  if (file.encoding === "base64" && file.content) {
    bytes = decodeBase64ToBytes(file.content);
  } else if (file.encoding === "utf-8" && file.content) {
    bytes = new TextEncoder().encode(file.content);
  } else {
    bytes = new Uint8Array();
  }

  return {
    bytes,
    mime: file.mimeType ?? "application/octet-stream",
    size: file.size,
    path: file.path,
    kind: file.kind,
    modifiedAt: file.modifiedAt,
  };
}

function binaryFileKind(mime: string, encoding: string): FileReadResult["kind"] {
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (encoding === "utf-8" || mime.startsWith("text/") || mime === "application/json") {
    return "text";
  }
  return "binary";
}

function concatByteChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function hashForLog(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return `h_${Math.abs(hash).toString(16)}`;
}

function toReasonCode(reason: string | null | undefined): string | null {
  if (!reason) {
    return null;
  }
  const normalized = reason.toLowerCase();
  if (normalized.includes("timed out")) {
    return "connect_timeout";
  }
  if (normalized.includes("disposed")) {
    return "disposed";
  }
  if (normalized.includes("client closed")) {
    return "client_closed";
  }
  if (normalized.includes("transport")) {
    return "transport_error";
  }
  if (normalized.includes("failed to connect")) {
    return "connect_failed";
  }
  return "unknown";
}

type RpcResponseOperation = {
  [Operation in ProtocolRpcOperation]: [ProtocolRpcResponse<Operation>] extends [never]
    ? never
    : Operation;
}[ProtocolRpcOperation];

type RpcResponsePayload<Operation extends RpcResponseOperation> =
  ProtocolRpcResponse<Operation> extends { payload: infer Payload } ? Payload : never;

type RpcRequestBody<Operation extends ProtocolRpcOperation> = Omit<
  ProtocolRpcInput<Operation>,
  "type" | "requestId"
>;

interface RpcInvocation<Operation extends RpcResponseOperation> {
  body: RpcRequestBody<Operation>;
  requestId?: string;
  timeout?: number;
}

const RPC_INVOKE = Symbol("rpc.invoke");

interface RpcClientInvoker {
  [RPC_INVOKE]<Operation extends RpcResponseOperation>(
    operation: Operation,
    invocation: RpcInvocation<Operation>,
  ): Promise<RpcResponsePayload<Operation>>;
}

interface ClientRpcBinding<
  Method extends string,
  Operation extends RpcResponseOperation,
  Args extends unknown[],
  Result,
> {
  clientMethod: Method;
  operation: Operation;
  invoke(client: RpcClientInvoker, args: Args): Promise<Result>;
}

type RpcBodyField<Operation extends RpcResponseOperation> = Extract<
  keyof RpcRequestBody<Operation>,
  string
>;

type PositionalValues<
  Operation extends RpcResponseOperation,
  Fields extends readonly RpcBodyField<Operation>[],
> = {
  -readonly [Index in keyof Fields]: Fields[Index] extends keyof RpcRequestBody<Operation>
    ? RpcRequestBody<Operation>[Fields[Index]]
    : never;
};

type PositionalRpcArgs<
  Operation extends RpcResponseOperation,
  Fields extends readonly RpcBodyField<Operation>[],
> = [...PositionalValues<Operation, Fields>, requestId?: string];

function positionalRpc<
  const Operation extends RpcResponseOperation,
  const Fields extends readonly RpcBodyField<Operation>[],
>(options: {
  clientMethod: Operation;
  fields: Fields;
  timeout?: number;
}): ClientRpcBinding<
  Operation,
  Operation,
  PositionalRpcArgs<Operation, Fields>,
  RpcResponsePayload<Operation>
> {
  return {
    clientMethod: options.clientMethod,
    operation: options.clientMethod,
    invoke(client, args) {
      const body: Record<string, unknown> = {};
      for (const [index, field] of options.fields.entries()) body[field] = args[index];
      return client[RPC_INVOKE](options.clientMethod, {
        body: body as RpcRequestBody<Operation>,
        requestId: args[options.fields.length] as string | undefined,
        timeout: options.timeout,
      });
    },
  };
}

type RpcObjectInput<Operation extends RpcResponseOperation> = RpcRequestBody<Operation> & {
  requestId?: string;
};

function objectRpc<const Operation extends RpcResponseOperation>(options: {
  clientMethod: Operation;
  timeout?: number;
}): ClientRpcBinding<
  Operation,
  Operation,
  [input: RpcObjectInput<Operation>],
  RpcResponsePayload<Operation>
> {
  return mappedRpc({
    clientMethod: options.clientMethod,
    request: (input: RpcObjectInput<Operation>) => {
      const { requestId, ...body } = input;
      return { body: body as RpcRequestBody<Operation>, requestId, timeout: options.timeout };
    },
  });
}

function renamedObjectRpc<
  const Method extends string,
  const Operation extends RpcResponseOperation,
>(options: {
  clientMethod: Method;
  operation: Operation;
  timeout?: number;
}): ClientRpcBinding<
  Method,
  Operation,
  [input: RpcObjectInput<Operation>],
  RpcResponsePayload<Operation>
> {
  return {
    clientMethod: options.clientMethod,
    operation: options.operation,
    invoke(client, [input]) {
      const { requestId, ...body } = input;
      return client[RPC_INVOKE](options.operation, {
        body: body as RpcRequestBody<Operation>,
        requestId,
        timeout: options.timeout,
      });
    },
  };
}

function requestIdRpc<const Operation extends RpcResponseOperation>(options: {
  clientMethod: Operation;
  timeout?: number;
}): ClientRpcBinding<Operation, Operation, [requestId?: string], RpcResponsePayload<Operation>> {
  return mappedRpc({
    clientMethod: options.clientMethod,
    request: (requestId?: string) => ({
      body: {} as RpcRequestBody<Operation>,
      requestId,
      timeout: options.timeout,
    }),
  });
}

function mappedRpc<const Operation extends RpcResponseOperation, Args extends unknown[]>(options: {
  clientMethod: Operation;
  request: (...args: Args) => RpcInvocation<Operation>;
}): ClientRpcBinding<Operation, Operation, Args, RpcResponsePayload<Operation>> {
  return {
    clientMethod: options.clientMethod,
    operation: options.clientMethod,
    invoke: (client, args) => client[RPC_INVOKE](options.clientMethod, options.request(...args)),
  };
}

function mappedRpcResult<
  const Operation extends RpcResponseOperation,
  Args extends unknown[],
  Result,
>(options: {
  clientMethod: Operation;
  request: (...args: Args) => RpcInvocation<Operation>;
  select: (payload: RpcResponsePayload<Operation>) => Result | Promise<Result>;
}): ClientRpcBinding<Operation, Operation, Args, Result> {
  return {
    clientMethod: options.clientMethod,
    operation: options.clientMethod,
    async invoke(client, args) {
      return options.select(
        await client[RPC_INVOKE](options.clientMethod, options.request(...args)),
      );
    },
  };
}

function scheduleByIdRpc<
  const Operation extends
    | "scheduleInspect"
    | "scheduleLogs"
    | "schedulePause"
    | "scheduleResume"
    | "scheduleDelete"
    | "scheduleRunOnce",
>(options: {
  clientMethod: Operation;
}): ClientRpcBinding<
  Operation,
  Operation,
  [options: InspectScheduleOptions],
  RpcResponsePayload<Operation>
> {
  return mappedRpc({
    clientMethod: options.clientMethod,
    request: (options: InspectScheduleOptions) => ({
      body: {
        workspaceId: options.workspaceId,
        scheduleId: options.id,
      } as RpcRequestBody<Operation>,
      requestId: options.requestId,
    }),
  });
}

interface PendingSend {
  message: SessionInboundMessage;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

interface PingProbe {
  promise: Promise<number>;
  resolve: (value: number) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  startedAt: number;
  // Whether a timeout on this ping should be recorded as a liveness failure. Only the
  // heartbeat sets this; a latency measurement never drives teardown, even when a
  // heartbeat tick shares (dedupes onto) an in-flight measurement ping.
  drivesLivenessFailure: boolean;
}

const clientRpcBindings = {
  clearAgentAttention: mappedRpcResult({
    clientMethod: "clearAgentAttention",
    request: (agentId: string | string[]) => ({ body: { agentId } }),
    select: (): void => undefined,
  }),
  clearWorkspaceAttention: mappedRpcResult({
    clientMethod: "clearWorkspaceAttention",
    request: (workspaceId: string | string[]) => ({ body: { workspaceId } }),
    select: (payload) => {
      if (!payload.success) throw new Error(payload.error ?? "Failed to clear workspace attention");
    },
  }),
  fetchAgents: mappedRpc({
    clientMethod: "fetchAgents",
    request: (options?: FetchAgentsOptions) => {
      const { requestId, timeout, ...body } = options ?? {};
      return { body, requestId, timeout };
    },
  }),
  fetchAgentHistory: mappedRpc({
    clientMethod: "fetchAgentHistory",
    request: (options?: FetchAgentHistoryOptions) => {
      const { requestId, ...body } = options ?? {};
      return { body, requestId };
    },
  }),
  fetchRecentProviderSessions: mappedRpc({
    clientMethod: "fetchRecentProviderSessions",
    request: (options?: FetchRecentProviderSessionsOptions) => {
      const { requestId, ...body } = options ?? {};
      return { body, requestId };
    },
  }),
  fetchWorkspaces: mappedRpc({
    clientMethod: "fetchWorkspaces",
    request: (options?: FetchWorkspacesOptions) => {
      const { requestId, ...body } = options ?? {};
      return { body, requestId };
    },
  }),
  openProject: positionalRpc({ clientMethod: "openProject", fields: ["cwd"] }),
  resolveForge: objectRpc({ clientMethod: "resolveForge" }),
  cloneWorkspace: objectRpc({ clientMethod: "cloneWorkspace", timeout: 5 * 60_000 }),
  addProject: positionalRpc({ clientMethod: "addProject", fields: ["cwd"] }),
  workspaceScriptList: renamedObjectRpc({
    clientMethod: "listWorkspaceScripts",
    operation: "workspaceScriptList",
  }),
  workspaceScriptStart: renamedObjectRpc({
    clientMethod: "startWorkspaceScript",
    operation: "workspaceScriptStart",
  }),
  workspaceScriptStop: renamedObjectRpc({
    clientMethod: "stopWorkspaceScript",
    operation: "workspaceScriptStop",
  }),
  archiveWorkspace: positionalRpc({
    clientMethod: "archiveWorkspace",
    fields: ["workspaceId"],
  }),
  restoreWorkspace: positionalRpc({
    clientMethod: "restoreWorkspace",
    fields: ["workspaceId"],
  }),
  fetchWorkspaceSetupStatus: positionalRpc({
    clientMethod: "fetchWorkspaceSetupStatus",
    fields: ["workspaceId"],
  }),
  getAgentThothState: positionalRpc({
    clientMethod: "getAgentThothState",
    fields: ["agentId"],
  }),
  listAgentDecisionSessions: positionalRpc({
    clientMethod: "listAgentDecisionSessions",
    fields: ["agentId"],
  }),
  getAgentDecisionSession: objectRpc({ clientMethod: "getAgentDecisionSession" }),
  prioritizeAgentDecisionNode: objectRpc({ clientMethod: "prioritizeAgentDecisionNode" }),
  answerAgentThothCard: objectRpc({ clientMethod: "answerAgentThothCard" }),
  listTasks: positionalRpc({ clientMethod: "listTasks", fields: ["workspaceId"] }),
  getTask: objectRpc({ clientMethod: "getTask" }),
  commandTask: objectRpc({ clientMethod: "commandTask" }),
  answerTaskDecision: objectRpc({ clientMethod: "answerTaskDecision" }),
  searchTaskContext: objectRpc({ clientMethod: "searchTaskContext" }),
  getTaskContext: objectRpc({ clientMethod: "getTaskContext" }),
  getExecutionTimeline: objectRpc({ clientMethod: "getExecutionTimeline" }),
  resolveExecutionApproval: objectRpc({ clientMethod: "resolveExecutionApproval" }),
  commandAgentTurnQueue: objectRpc({ clientMethod: "commandAgentTurnQueue" }),
  createAgent: mappedRpcResult({
    clientMethod: "createAgent",
    request: (options: CreateAgentRequestOptions) => ({
      body: {
        config: resolveAgentConfig(options),
        ...(options.env ? { env: options.env } : {}),
        ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
        ...(options.initialPrompt ? { initialPrompt: options.initialPrompt } : {}),
        ...(options.thoth ? { thoth: options.thoth } : {}),
        ...(options.providerRunMode ? { providerRunMode: options.providerRunMode } : {}),
        ...(options.contextRefs ? { contextRefs: options.contextRefs } : {}),
        ...(options.clientMessageId ? { clientMessageId: options.clientMessageId } : {}),
        ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
        ...(options.images?.length ? { images: options.images } : {}),
        ...(options.attachments?.length ? { attachments: options.attachments } : {}),
        ...(options.git ? { git: options.git } : {}),
        ...(options.worktree ? { worktree: options.worktree } : {}),
        ...(options.autoArchive !== undefined ? { autoArchive: options.autoArchive } : {}),
        ...(options.worktreeName ? { worktreeName: options.worktreeName } : {}),
        ...(options.labels && Object.keys(options.labels).length ? { labels: options.labels } : {}),
      },
      requestId: options.requestId,
    }),
    select: (payload) => {
      const created = AgentCreatedStatusPayloadSchema.safeParse(payload);
      if (created.success) return created.data.agent;
      const failed = AgentCreateFailedStatusPayloadSchema.safeParse(payload);
      if (failed.success) throw new Error(failed.data.error);
      throw new Error("Invalid createAgent status response");
    },
  }),
  deleteAgent: mappedRpcResult({
    clientMethod: "deleteAgent",
    request: (agentId: string) => ({ body: { agentId } }),
    select: (): void => undefined,
  }),
  archiveAgent: mappedRpcResult({
    clientMethod: "archiveAgent",
    request: (agentId: string) => ({ body: { agentId } }),
    select: (payload) => ({ archivedAt: payload.archivedAt }),
  }),
  detachAgent: mappedRpcResult({
    clientMethod: "detachAgent",
    request: (agentId: string) => ({ body: { agentId } }),
    select: (payload) => {
      if (!payload.accepted) throw new Error(payload.error ?? "detachAgent rejected");
    },
  }),
  updateAgent: mappedRpcResult({
    clientMethod: "updateAgent",
    request: (agentId: string, updates: { name?: string; labels?: Record<string, string> }) => ({
      body: {
        agentId,
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.labels && Object.keys(updates.labels).length ? { labels: updates.labels } : {}),
      },
    }),
    select: (payload) => {
      if (!payload.accepted) throw new Error(payload.error ?? "updateAgent rejected");
    },
  }),
  renameProject: mappedRpcResult({
    clientMethod: "renameProject",
    request: (projectId: string, customName: string | null, requestId?: string) => ({
      body: { projectId, customName },
      requestId,
    }),
    select: (payload) => {
      if (!payload.accepted) throw new Error(payload.error ?? "renameProject rejected");
      return { customName: payload.customName };
    },
  }),
  removeProject: mappedRpcResult({
    clientMethod: "removeProject",
    request: (projectId: string, requestId?: string) => ({ body: { projectId }, requestId }),
    select: (payload) => {
      if (!payload.accepted) throw new Error(payload.error ?? "removeProject rejected");
      return { removedWorkspaceIds: payload.removedWorkspaceIds };
    },
  }),
  setWorkspaceTitle: mappedRpcResult({
    clientMethod: "setWorkspaceTitle",
    request: (workspaceId: string, title: string | null, requestId?: string) => ({
      body: { workspaceId, title },
      requestId,
    }),
    select: (payload) => {
      if (!payload.accepted) throw new Error(payload.error ?? "setWorkspaceTitle rejected");
      return { title: payload.title };
    },
  }),
  resumeAgent: mappedRpcResult({
    clientMethod: "resumeAgent",
    request: (handle: AgentPersistenceHandle, overrides?: Partial<AgentSessionConfig>) => ({
      body: { handle, ...(overrides ? { overrides } : {}) },
    }),
    select: (payload) => {
      const resumed = AgentResumedStatusPayloadSchema.safeParse(payload);
      if (!resumed.success) throw new Error("Invalid resumeAgent status response");
      return resumed.data.agent;
    },
  }),
  importAgent: mappedRpcResult({
    clientMethod: "importAgent",
    request: (input: ImportAgentInput) => ({
      body: {
        workspaceId: input.workspaceId,
        ...("providerId" in input
          ? { providerId: input.providerId, providerHandleId: input.providerHandleId }
          : { provider: input.provider, sessionId: input.sessionId }),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.labels && Object.keys(input.labels).length ? { labels: input.labels } : {}),
      },
    }),
    select: (payload) => {
      const resumed = AgentResumedStatusPayloadSchema.safeParse(payload);
      if (resumed.success) return resumed.data.agent;
      const failed = AgentCreateFailedStatusPayloadSchema.safeParse(payload);
      if (failed.success) throw new Error(failed.data.error);
      throw new Error("Invalid importAgent status response");
    },
  }),
  refreshAgent: mappedRpcResult({
    clientMethod: "refreshAgent",
    request: (agentId: string, requestId?: string) => ({ body: { agentId }, requestId }),
    select: (payload) => {
      const refreshed = AgentRefreshedStatusPayloadSchema.safeParse(payload);
      if (!refreshed.success) throw new Error("Invalid refreshAgent status response");
      return refreshed.data;
    },
  }),
  fetchAgentTimeline: mappedRpcResult({
    clientMethod: "fetchAgentTimeline",
    request: (agentId: string, options: FetchAgentTimelineOptions = {}) => ({
      body: {
        agentId,
        ...(options.direction ? { direction: options.direction } : {}),
        ...(options.cursor ? { cursor: options.cursor } : {}),
        ...(typeof options.limit === "number" ? { limit: options.limit } : {}),
        ...(options.projection ? { projection: options.projection } : {}),
      },
      requestId: options.requestId,
      timeout: options.timeout,
    }),
    select: (payload) => {
      if (payload.error) throw new Error(payload.error);
      return payload;
    },
  }),
  buildAgentForkContext: mappedRpcResult({
    clientMethod: "buildAgentForkContext",
    request: (agentId: string, options: AgentForkContextOptions = {}) => ({
      body: {
        agentId,
        ...(options.boundaryMessageId ? { boundaryMessageId: options.boundaryMessageId } : {}),
      },
      requestId: options.requestId,
      timeout: 15_000,
    }),
    select: (payload) => {
      if (payload.error) throw new Error(payload.error);
      return payload;
    },
  }),
  sendAgentMessage: mappedRpcResult({
    clientMethod: "sendAgentMessage",
    request: (agentId: string, text: string, options?: SendMessageOptions) => ({
      body: {
        agentId,
        text,
        messageId: options?.messageId ?? crypto.randomUUID(),
        ...(options?.images ? { images: options.images } : {}),
        ...(options?.attachments ? { attachments: options.attachments } : {}),
        ...(options?.thoth ? { thoth: options.thoth } : {}),
        ...(options?.providerRunMode ? { providerRunMode: options.providerRunMode } : {}),
        ...(options?.contextRefs ? { contextRefs: options.contextRefs } : {}),
        deliveryMode: options?.deliveryMode ?? "queue",
      },
    }),
    select: (payload) => {
      if (!payload.accepted) throw new Error(payload.error ?? "sendAgentMessage rejected");
      return payload;
    },
  }),
  rewindAgent: mappedRpcResult({
    clientMethod: "rewindAgent",
    request: (agentId: string, messageId: string, mode: "conversation" | "files" | "both") => ({
      body: { agentId, messageId, mode },
    }),
    select: (payload) => {
      if (!payload.ok) throw new Error(payload.error ?? "Agent rewind failed");
      return payload;
    },
  }),
  cancelAgent: mappedRpcResult({
    clientMethod: "cancelAgent",
    request: (agentId: string) => ({ body: { agentId } }),
    select: (payload) => {
      if (payload.error) throw new Error(payload.error);
    },
  }),
  setAgentMode: mappedRpcResult({
    clientMethod: "setAgentMode",
    request: (agentId: string, modeId: string) => ({ body: { agentId, modeId } }),
    select: (payload) => {
      if (!payload.accepted) throw new Error(payload.error ?? "setAgentMode rejected");
      return payload.notice ?? null;
    },
  }),
  getAgentProviderControl: mappedRpcResult({
    clientMethod: "getAgentProviderControl",
    request: (agentId: string, options?: { refresh?: boolean }) => ({
      body: { agentId, ...(options?.refresh ? { refresh: true } : {}) },
    }),
    select: (payload) => {
      if (!payload.accepted || !payload.providerControl) {
        throw new Error(payload.error ?? "getAgentProviderControl rejected");
      }
      return payload.providerControl;
    },
  }),
  updateAgentProviderControl: mappedRpcResult({
    clientMethod: "updateAgentProviderControl",
    request: (input: {
      agentId: string;
      runMode: ProviderRunMode;
      expectedRevision: number;
      commandId?: string;
    }) => ({ body: { ...input, commandId: input.commandId ?? crypto.randomUUID() } }),
    select: (payload) => {
      if (!payload.accepted || !payload.providerControl) {
        throw new Error(payload.error ?? "updateAgentProviderControl rejected");
      }
      return payload.providerControl;
    },
  }),
  setAgentModel: mappedRpcResult({
    clientMethod: "setAgentModel",
    request: (agentId: string, modelId: string | null) => ({ body: { agentId, modelId } }),
    select: (payload) => {
      if (!payload.accepted) throw new Error(payload.error ?? "setAgentModel rejected");
    },
  }),
  setAgentFeature: mappedRpcResult({
    clientMethod: "setAgentFeature",
    request: (agentId: string, featureId: string, value: unknown) => ({
      body: { agentId, featureId, value },
    }),
    select: (payload) => {
      if (!payload.accepted) throw new Error(payload.error ?? "setAgentFeature rejected");
    },
  }),
  setAgentThinkingOption: mappedRpcResult({
    clientMethod: "setAgentThinkingOption",
    request: (agentId: string, thinkingOptionId: string | null) => ({
      body: { agentId, thinkingOptionId },
    }),
    select: (payload) => {
      if (!payload.accepted) {
        throw new Error(payload.error ?? "setAgentThinkingOption rejected");
      }
      return payload.notice ?? null;
    },
  }),
  restartServer: mappedRpcResult({
    clientMethod: "restartServer",
    request: (reason?: string, requestId?: string) => ({
      body: reason?.trim() ? { reason } : {},
      requestId,
    }),
    select: (payload) => {
      const restarted = RestartRequestedStatusPayloadSchema.safeParse(payload);
      if (!restarted.success) throw new Error("Invalid restartServer status response");
      return restarted.data;
    },
  }),
  shutdownServer: mappedRpcResult({
    clientMethod: "shutdownServer",
    request: (options?: ShutdownServerOptions) => ({
      body: {},
      requestId: options?.requestId,
      timeout: options?.timeout,
    }),
    select: (payload) => {
      const shutdown = ShutdownRequestedStatusPayloadSchema.safeParse(payload);
      if (!shutdown.success) throw new Error("Invalid shutdownServer status response");
      return shutdown.data;
    },
  }),
  updateDaemon: mappedRpc({
    clientMethod: "updateDaemon",
    request: (requestId?: string) => ({ body: {}, requestId, timeout: 300_000 }),
  }),
  checkoutPull: positionalRpc({ clientMethod: "checkoutPull", fields: ["cwd"] }),
  checkoutPush: positionalRpc({ clientMethod: "checkoutPush", fields: ["cwd"] }),
  checkoutRefresh: positionalRpc({ clientMethod: "checkoutRefresh", fields: ["cwd"] }),
  listCheckoutCommits: mappedRpcResult({
    clientMethod: "listCheckoutCommits",
    request: (cwd: string, requestId?: string) => ({ body: { cwd }, requestId }),
    select: (payload) => {
      if (payload.error) throw new Error(payload.error.message);
      return { baseRef: payload.baseRef, commits: payload.commits };
    },
  }),
  getCommitFileDiff: mappedRpcResult({
    clientMethod: "getCommitFileDiff",
    request: (cwd: string, sha: string, path: string, requestId?: string) => ({
      body: { cwd, sha, path },
      requestId,
    }),
    select: (payload) => {
      if (payload.error) throw new Error(payload.error.message);
      return { file: payload.file };
    },
  }),
  checkoutPrStatus: positionalRpc({ clientMethod: "checkoutPrStatus", fields: ["cwd"] }),
  checkoutSwitchBranch: positionalRpc({
    clientMethod: "checkoutSwitchBranch",
    fields: ["cwd", "branch"],
  }),
  checkoutCommit: mappedRpc({
    clientMethod: "checkoutCommit",
    request: (cwd: string, input: { message?: string; addAll?: boolean }, requestId?: string) => ({
      body: { cwd, message: input.message, addAll: input.addAll },
      requestId,
    }),
  }),
  checkoutMerge: mappedRpc({
    clientMethod: "checkoutMerge",
    request: (
      cwd: string,
      input: { baseRef?: string; strategy?: "merge" | "squash"; requireCleanTarget?: boolean },
      requestId?: string,
    ) => ({ body: { cwd, ...input }, requestId }),
  }),
  checkoutMergeFromBase: mappedRpc({
    clientMethod: "checkoutMergeFromBase",
    request: (
      cwd: string,
      input: { baseRef?: string; requireCleanTarget?: boolean },
      requestId?: string,
    ) => ({ body: { cwd, ...input }, requestId }),
  }),
  checkoutPrCreate: mappedRpc({
    clientMethod: "checkoutPrCreate",
    request: (
      cwd: string,
      input: { title?: string; body?: string; baseRef?: string },
      requestId?: string,
    ) => ({ body: { cwd, ...input }, requestId }),
  }),
  checkoutPrMerge: mappedRpc({
    clientMethod: "checkoutPrMerge",
    request: (cwd: string, input: { method: CheckoutPrMergeMethod }, requestId?: string) => ({
      body: { cwd, mergeMethod: input.method },
      requestId,
    }),
  }),
  checkoutGithubSetAutoMerge: mappedRpc({
    clientMethod: "checkoutGithubSetAutoMerge",
    request: (
      cwd: string,
      input: { enabled: true; method: CheckoutPrMergeMethod } | { enabled: false },
      requestId?: string,
    ) => ({
      body: {
        cwd,
        enabled: input.enabled,
        ...(input.enabled ? { mergeMethod: input.method } : {}),
      },
      requestId,
    }),
  }),
  checkoutGithubGetCheckDetails: mappedRpc({
    clientMethod: "checkoutGithubGetCheckDetails",
    request: (
      input: {
        cwd: string;
        repoOwner: string;
        repoName: string;
        checkRunId: number;
        workflowRunId?: number;
      },
      requestId?: string,
    ) => ({ body: input, requestId }),
  }),
  pullRequestTimeline: mappedRpc({
    clientMethod: "pullRequestTimeline",
    request: (
      input: { cwd: string; prNumber: number; repoOwner: string; repoName: string },
      requestId?: string,
    ) => ({ body: input, requestId }),
  }),
  stashSave: mappedRpc({
    clientMethod: "stashSave",
    request: (cwd: string, options?: { branch?: string }, requestId?: string) => ({
      body: { cwd, branch: options?.branch },
      requestId,
    }),
  }),
  stashPop: positionalRpc({ clientMethod: "stashPop", fields: ["cwd", "stashIndex"] }),
  stashList: mappedRpc({
    clientMethod: "stashList",
    request: (cwd: string, options?: { thothOnly?: boolean }, requestId?: string) => ({
      body: { cwd, thothOnly: options?.thothOnly },
      requestId,
    }),
  }),
  getThothWorktreeList: mappedRpc({
    clientMethod: "getThothWorktreeList",
    request: (input: { cwd?: string; repoRoot?: string }, requestId?: string) => ({
      body: input,
      requestId,
    }),
  }),
  archiveThothWorktree: mappedRpc({
    clientMethod: "archiveThothWorktree",
    request: (
      input: {
        worktreePath?: string;
        repoRoot?: string;
        branchName?: string;
        workspaceId?: string;
        scope?: "workspace" | "worktree";
      },
      requestId?: string,
    ) => ({ body: input, requestId }),
  }),
  createThothWorktree: mappedRpc({
    clientMethod: "createThothWorktree",
    request: (input: CreateThothWorktreeInput, requestId?: string) => ({
      body: input,
      requestId,
    }),
  }),
  createWorkspace: mappedRpc({
    clientMethod: "createWorkspace",
    request: (
      input: {
        source: WorkspaceCreateRequest["source"];
        title?: string;
        firstAgentContext?: WorkspaceCreateRequest["firstAgentContext"];
      },
      requestId?: string,
    ) => ({ body: input, requestId }),
  }),
  validateBranch: mappedRpc({
    clientMethod: "validateBranch",
    request: (options: { cwd: string; branchName: string }, requestId?: string) => ({
      body: options,
      requestId,
    }),
  }),
  getBranchSuggestions: mappedRpc({
    clientMethod: "getBranchSuggestions",
    request: (options: { cwd: string; query?: string; limit?: number }, requestId?: string) => ({
      body: options,
      requestId,
    }),
  }),
  searchGitHub: mappedRpc({
    clientMethod: "searchGitHub",
    request: (
      options: {
        cwd: string;
        query: string;
        limit?: number;
        kinds?: GitHubSearchRequest["kinds"];
      },
      requestId?: string,
    ) => ({ body: options, requestId }),
  }),
  getDirectorySuggestions: mappedRpc({
    clientMethod: "getDirectorySuggestions",
    request: (
      options: {
        query: string;
        limit?: number;
        cwd?: string;
        includeFiles?: boolean;
        includeDirectories?: boolean;
        matchMode?: "fuzzy" | "suffix";
      },
      requestId?: string,
    ) => ({ body: options, requestId }),
  }),
  requestDownloadToken: positionalRpc({
    clientMethod: "requestDownloadToken",
    fields: ["cwd", "path"],
  }),
  requestProjectIcon: positionalRpc({
    clientMethod: "requestProjectIcon",
    fields: ["cwd"],
  }),
  getDaemonConfig: requestIdRpc({ clientMethod: "getDaemonConfig" }),
  collectDiagnostics: requestIdRpc({ clientMethod: "collectDiagnostics" }),
  patchDaemonConfig: positionalRpc({
    clientMethod: "patchDaemonConfig",
    fields: ["config"],
  }),
  readProjectConfig: positionalRpc({
    clientMethod: "readProjectConfig",
    fields: ["repoRoot"],
  }),
  writeProjectConfig: objectRpc({ clientMethod: "writeProjectConfig" }),
  listProviderModels: mappedRpc({
    clientMethod: "listProviderModels",
    request: (provider: AgentProvider, options?: { cwd?: string; requestId?: string }) => ({
      body: { provider, cwd: options?.cwd },
      requestId: options?.requestId,
    }),
  }),
  listProviderModes: mappedRpc({
    clientMethod: "listProviderModes",
    request: (provider: AgentProvider, options?: { cwd?: string; requestId?: string }) => ({
      body: { provider, cwd: options?.cwd },
      requestId: options?.requestId,
    }),
  }),
  listProviderFeatures: mappedRpc({
    clientMethod: "listProviderFeatures",
    request: (draftConfig: ListCommandsDraftConfig, options?: { requestId?: string }) => ({
      body: { draftConfig },
      requestId: options?.requestId,
    }),
  }),
  listAvailableProviders: mappedRpc({
    clientMethod: "listAvailableProviders",
    request: (options?: { requestId?: string }) => ({
      body: {},
      requestId: options?.requestId,
    }),
  }),
  getProvidersSnapshot: mappedRpc({
    clientMethod: "getProvidersSnapshot",
    request: (options?: { cwd?: string; requestId?: string }) => ({
      body: { cwd: options?.cwd },
      requestId: options?.requestId,
    }),
  }),
  getDaemonStatus: mappedRpc({
    clientMethod: "getDaemonStatus",
    request: (options?: DaemonStatusOptions) => ({
      body: {},
      requestId: options?.requestId,
      timeout: options?.timeout,
    }),
  }),
  getDaemonPairingOffer: mappedRpc({
    clientMethod: "getDaemonPairingOffer",
    request: (options?: DaemonPairingOfferOptions) => ({
      body: {},
      requestId: options?.requestId,
      timeout: options?.timeout,
    }),
  }),
  issueRelayDeviceToken: mappedRpc({
    clientMethod: "issueRelayDeviceToken",
    request: (options?: DaemonIssueRelayDeviceTokenOptions) => ({
      body: {},
      requestId: options?.requestId,
      timeout: options?.timeout,
    }),
  }),
  refreshProvidersSnapshot: mappedRpc({
    clientMethod: "refreshProvidersSnapshot",
    request: (options?: { cwd?: string; providers?: AgentProvider[]; requestId?: string }) => ({
      body: { cwd: options?.cwd, providers: options?.providers },
      requestId: options?.requestId,
      timeout: 120_000,
    }),
  }),
  deleteProvider: mappedRpc({
    clientMethod: "deleteProvider",
    request: (provider: AgentProvider, options?: { requestId?: string }) => ({
      body: { provider, confirmed: true as const },
      requestId: options?.requestId,
    }),
  }),
  getProviderDiagnostic: mappedRpc({
    clientMethod: "getProviderDiagnostic",
    request: (provider: AgentProvider, options?: { requestId?: string }) => ({
      body: { provider },
      requestId: options?.requestId,
      timeout: 180_000,
    }),
  }),
  listProviderUsage: mappedRpc({
    clientMethod: "listProviderUsage",
    request: (options?: { requestId?: string }) => ({
      body: {},
      requestId: options?.requestId,
    }),
  }),
  renameBranch: objectRpc({ clientMethod: "renameBranch" }),
  renameTerminal: objectRpc({ clientMethod: "renameTerminal" }),
  listTerminals: mappedRpc({
    clientMethod: "listTerminals",
    request: (cwd?: string, requestId?: string, options?: { workspaceId?: string }) => ({
      body: { cwd, workspaceId: options?.workspaceId },
      requestId,
    }),
  }),
  createTerminal: mappedRpc({
    clientMethod: "createTerminal",
    request: (
      cwd: string,
      name?: string,
      requestId?: string,
      options?: {
        agentId?: string;
        command?: string;
        args?: string[];
        workspaceId?: string;
        size?: { rows: number; cols: number };
      },
    ) => ({ body: { cwd, name, ...options }, requestId }),
  }),
  killTerminal: positionalRpc({ clientMethod: "killTerminal", fields: ["terminalId"] }),
  closeItems: mappedRpc({
    clientMethod: "closeItems",
    request: (input: { agentIds?: string[]; terminalIds?: string[] }, requestId?: string) => ({
      body: { agentIds: input.agentIds ?? [], terminalIds: input.terminalIds ?? [] },
      requestId,
    }),
  }),
  captureTerminal: mappedRpc({
    clientMethod: "captureTerminal",
    request: (
      terminalId: string,
      options?: { start?: number; end?: number; stripAnsi?: boolean },
      requestId?: string,
    ) => ({ body: { terminalId, ...options }, requestId }),
  }),
  createChatRoom: mappedRpc({
    clientMethod: "createChatRoom",
    request: (options: CreateChatRoomOptions) => ({
      body: {
        workspaceId: options.workspaceId,
        name: options.name,
        ...(options.purpose ? { purpose: options.purpose } : {}),
      },
      requestId: options.requestId,
    }),
  }),
  listChatRooms: objectRpc({ clientMethod: "listChatRooms" }),
  inspectChatRoom: objectRpc({ clientMethod: "inspectChatRoom" }),
  deleteChatRoom: objectRpc({ clientMethod: "deleteChatRoom" }),
  postChatMessage: mappedRpc({
    clientMethod: "postChatMessage",
    request: (options: PostChatMessageOptions) => ({
      body: {
        workspaceId: options.workspaceId,
        room: options.room,
        body: options.body,
        ...(options.authorAgentId ? { authorAgentId: options.authorAgentId } : {}),
        ...(options.replyToMessageId ? { replyToMessageId: options.replyToMessageId } : {}),
      },
      requestId: options.requestId,
    }),
  }),
  readChatMessages: mappedRpc({
    clientMethod: "readChatMessages",
    request: (options: ReadChatMessagesOptions) => ({
      body: {
        workspaceId: options.workspaceId,
        room: options.room,
        limit: options.limit,
        since: options.since,
        authorAgentId: options.authorAgentId,
      },
      requestId: options.requestId,
      timeout: options.timeout,
    }),
  }),
  waitForChatMessages: mappedRpc({
    clientMethod: "waitForChatMessages",
    request: (options: WaitForChatMessagesOptions) => ({
      body: {
        workspaceId: options.workspaceId,
        room: options.room,
        ...(options.afterMessageId ? { afterMessageId: options.afterMessageId } : {}),
        ...(typeof options.timeoutMs === "number" ? { timeoutMs: options.timeoutMs } : {}),
      },
      requestId: options.requestId,
      timeout: (options.timeoutMs ?? 0) + 10_000,
    }),
  }),
  scheduleCreate: mappedRpc({
    clientMethod: "scheduleCreate",
    request: (options: CreateScheduleOptions) => ({
      body: {
        workspaceId: options.workspaceId,
        prompt: options.prompt,
        intentContractId: options.intentContractId,
        cadence: options.cadence,
        target: options.target,
        ...(options.name ? { name: options.name } : {}),
        ...(typeof options.maxRuns === "number" ? { maxRuns: options.maxRuns } : {}),
        ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
        ...(typeof options.runOnCreate === "boolean" ? { runOnCreate: options.runOnCreate } : {}),
      },
      requestId: options.requestId,
    }),
  }),
  scheduleList: objectRpc({ clientMethod: "scheduleList" }),
  scheduleInspect: scheduleByIdRpc({ clientMethod: "scheduleInspect" }),
  scheduleLogs: scheduleByIdRpc({ clientMethod: "scheduleLogs" }),
  schedulePause: scheduleByIdRpc({ clientMethod: "schedulePause" }),
  scheduleResume: scheduleByIdRpc({ clientMethod: "scheduleResume" }),
  scheduleDelete: scheduleByIdRpc({ clientMethod: "scheduleDelete" }),
  scheduleRunOnce: scheduleByIdRpc({ clientMethod: "scheduleRunOnce" }),
  scheduleUpdate: mappedRpc({
    clientMethod: "scheduleUpdate",
    request: (options: UpdateScheduleOptions) => ({
      body: {
        workspaceId: options.workspaceId,
        scheduleId: options.id,
        name: options.name,
        prompt: options.prompt,
        cadence: options.cadence,
        newAgentConfig: options.newAgentConfig,
        intentContractId: options.intentContractId,
        maxRuns: options.maxRuns,
        expiresAt: options.expiresAt,
      },
      requestId: options.requestId,
    }),
  }),
} as const;

type ClientRpcMethods = {
  [Binding in (typeof clientRpcBindings)[keyof typeof clientRpcBindings] as Binding["clientMethod"]]: Binding extends {
    invoke(client: RpcClientInvoker, args: infer Args extends unknown[]): Promise<infer Result>;
  }
    ? (...args: Args) => Promise<Result>
    : never;
};

class DaemonClientRuntime {
  private transport: DaemonTransport | null = null;
  private transportCleanup: Array<() => void> = [];
  private rawMessageListeners: Set<(message: SessionOutboundMessage) => void> = new Set();
  private messageHandlers: Map<
    SessionOutboundMessage["type"],
    Set<(message: SessionOutboundMessage) => void>
  > = new Map();
  private eventListeners: Set<DaemonEventHandler> = new Set();
  private waiters: Set<Waiter<unknown>> = new Set();
  private checkoutStatusInFlight: Map<string, Promise<CheckoutStatusPayload>> = new Map();
  private connectionListeners: Set<(status: ConnectionState) => void> = new Set();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingGenericTransportErrorTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = true;
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private lastErrorValue: string | null = null;
  private connectionState: ConnectionState = { status: "idle" };
  private checkoutDiffSubscriptions = new Map<
    string,
    {
      cwd: string;
      compare: { mode: "uncommitted" | "base"; baseRef?: string; ignoreWhitespace?: boolean };
    }
  >();
  private terminalDirectorySubscriptions = new Map<string, { cwd: string; workspaceId?: string }>();
  private readonly terminalStreams = new TerminalStreamRouter();
  private pendingBinaryFileReads = new Map<string, PendingBinaryFileRead>();
  private activeBinaryFileTransfers = new Map<string, BinaryFileTransferState>();
  private completedBinaryFileReads = new Map<string, FileReadResult>();
  private logger: Logger;
  private pendingSendQueue: PendingSend[] = [];
  private pendingBrowserAutomationResponses = new Map<string, BrowserAutomationExecuteResponse>();
  private readonly logConnectionPath: "direct" | "relay";
  private readonly logServerId: string | null;
  private readonly logClientIdHash: string;
  private readonly logGeneration: number | null;
  private lastServerInfoMessage: ServerInfoStatusPayload | null = null;
  private runtimeMetricsInterval: ReturnType<typeof setInterval> | null = null;
  private runtimeMetrics: DaemonClientRuntimeMetrics | null = null;
  private pingProbe: PingProbe | null = null;
  private livenessHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLivenessRttMs: number | null = null;
  private consecutiveLivenessFailures = 0;

  constructor(private config: DaemonClientConfig) {
    this.logger = config.logger ?? consoleLogger;
    this.logConnectionPath = isRelayClientWebSocketUrl(this.config.url) ? "relay" : "direct";
    let parsedUrlForLog: URL | null = null;
    try {
      parsedUrlForLog = new URL(this.config.url);
    } catch {
      parsedUrlForLog = null;
    }
    const parsedServerIdForLog = normalizeClientId(parsedUrlForLog?.searchParams.get("serverId"));
    this.logServerId = parsedServerIdForLog ?? parsedUrlForLog?.host ?? null;
    const resolvedClientId = normalizeClientId(this.config.clientId);
    if (!resolvedClientId) {
      throw new Error("Daemon client requires a non-empty clientId");
    }
    this.config.clientId = resolvedClientId;
    this.logClientIdHash = hashForLog(resolvedClientId);
    this.logGeneration =
      typeof this.config.runtimeGeneration === "number" &&
      Number.isFinite(this.config.runtimeGeneration)
        ? this.config.runtimeGeneration
        : null;
    const runtimeMetricsIntervalMs =
      typeof config.runtimeMetricsIntervalMs === "number" && config.runtimeMetricsIntervalMs > 0
        ? config.runtimeMetricsIntervalMs
        : 0;
    if (runtimeMetricsIntervalMs > 0) {
      const runtimeMetricsWindowMs =
        typeof config.runtimeMetricsWindowMs === "number" && config.runtimeMetricsWindowMs > 0
          ? Math.max(config.runtimeMetricsWindowMs, runtimeMetricsIntervalMs)
          : undefined;
      this.runtimeMetrics = new DaemonClientRuntimeMetrics(
        this.logger,
        {
          connectionPath: this.logConnectionPath,
          serverId: this.logServerId,
          getConnectionStatus: () => this.connectionState.status,
        },
        runtimeMetricsWindowMs ? { windowMs: runtimeMetricsWindowMs } : undefined,
      );
      this.runtimeMetricsInterval = setInterval(() => {
        this.runtimeMetrics?.flush();
      }, runtimeMetricsIntervalMs);
    }
  }

  // ============================================================================
  // Connection
  // ============================================================================

  async connect(): Promise<void> {
    if (this.connectionState.status === "disposed") {
      throw new Error("Daemon client is disposed");
    }
    if (this.connectionState.status === "connected") {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.shouldReconnect = true;
    this.connectPromise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.attemptConnect();
    });

    return this.connectPromise;
  }

  private attemptConnect(): void {
    if (this.connectionState.status === "disposed") {
      this.rejectConnect(new Error("Daemon client is disposed"));
      return;
    }
    if (!this.shouldReconnect) {
      this.rejectConnect(new Error("Daemon client is closed"));
      return;
    }

    if (this.connectionState.status === "connecting") {
      return;
    }

    const headers: Record<string, string> = {};
    const password = normalizePassword(this.config.password);
    if (password) {
      headers.Authorization = `Bearer ${password}`;
    } else if (this.config.authHeader) {
      headers.Authorization = this.config.authHeader;
    }
    const protocols = [
      ...(this.config.protocols ?? []),
      ...(password ? [`thoth.bearer.${password}`] : []),
    ];

    try {
      // Reconnect can overlap with browser close/error delivery ordering.
      // Always dispose previous transport before constructing the next one.
      this.disposeTransport();
      const baseTransportFactory =
        this.config.transportFactory ??
        createWebSocketTransportFactory(this.config.webSocketFactory ?? defaultWebSocketFactory);
      const shouldUseRelayE2ee =
        this.config.e2ee?.enabled === true && isRelayClientWebSocketUrl(this.config.url);

      let transportFactory = baseTransportFactory;
      if (shouldUseRelayE2ee) {
        const daemonPublicKeyB64 = this.config.e2ee?.daemonPublicKeyB64;
        if (!daemonPublicKeyB64) {
          throw new Error("daemonPublicKeyB64 is required for relay E2EE");
        }
        transportFactory = createRelayE2eeTransportFactory({
          baseFactory: baseTransportFactory,
          daemonPublicKeyB64,
          logger: this.logger,
        });
      }
      const transportUrl = this.resolveTransportUrlForAttempt();
      const transport = transportFactory({
        url: transportUrl,
        headers,
        ...(protocols.length > 0 ? { protocols } : {}),
      });
      this.transport = transport;
      this.lastServerInfoMessage = null;

      this.updateConnectionState(
        {
          status: "connecting",
          attempt: this.reconnectAttempt,
        },
        { event: "CONNECT_REQUEST" },
      );
      this.resetConnectTimeout();
      const timeoutMs = Math.max(1, this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
      this.connectTimeout = setTimeout(() => {
        if (this.connectionState.status !== "connecting") {
          return;
        }
        this.lastErrorValue = "Connection timed out";
        this.disposeTransport(1001, "Connection timed out");
        this.scheduleReconnect({
          reason: "Connection timed out",
          event: "CONNECT_TIMEOUT",
          reasonCode: "connect_timeout",
        });
      }, timeoutMs);

      this.transportCleanup = [
        transport.onOpen(() => {
          if (this.pendingGenericTransportErrorTimeout) {
            clearTimeout(this.pendingGenericTransportErrorTimeout);
            this.pendingGenericTransportErrorTimeout = null;
          }
          this.lastErrorValue = null;
          this.sendHelloMessage();
        }),
        transport.onClose((event) => {
          this.resetConnectTimeout();
          if (this.pendingGenericTransportErrorTimeout) {
            clearTimeout(this.pendingGenericTransportErrorTimeout);
            this.pendingGenericTransportErrorTimeout = null;
          }
          const reason = describeTransportClose(event);
          if (reason) {
            this.lastErrorValue = reason;
          }
          this.scheduleReconnect({
            reason,
            event: "TRANSPORT_CLOSE",
            reasonCode: "transport_closed",
          });
        }),
        transport.onError((event) => {
          this.resetConnectTimeout();
          const reason = describeTransportError(event);
          const isGeneric = reason === "Transport error";
          // Browser WebSocket.onerror often provides no useful details and is followed
          // by a close event (often with code 1006). Prefer surfacing the close details
          // instead of immediately disconnecting with a generic "Transport error".
          if (isGeneric) {
            this.lastErrorValue ??= reason;
            if (!this.pendingGenericTransportErrorTimeout) {
              this.pendingGenericTransportErrorTimeout = setTimeout(() => {
                this.pendingGenericTransportErrorTimeout = null;
                if (
                  this.connectionState.status === "connected" ||
                  this.connectionState.status === "connecting"
                ) {
                  this.lastErrorValue = reason;
                  this.scheduleReconnect({
                    reason,
                    event: "TRANSPORT_ERROR",
                    reasonCode: "transport_error",
                  });
                }
              }, 250);
            }
            return;
          }

          if (this.pendingGenericTransportErrorTimeout) {
            clearTimeout(this.pendingGenericTransportErrorTimeout);
            this.pendingGenericTransportErrorTimeout = null;
          }
          this.lastErrorValue = reason;
          this.scheduleReconnect({
            reason,
            event: "TRANSPORT_ERROR",
            reasonCode: "transport_error",
          });
        }),
        transport.onMessage((data) => this.handleTransportMessage(data)),
      ];
    } catch (error) {
      this.resetConnectTimeout();
      const message = error instanceof Error ? error.message : "Failed to connect";
      this.lastErrorValue = message;
      this.scheduleReconnect({
        reason: message,
        event: "CONNECT_FAILED",
        reasonCode: "connect_failed",
      });
      this.rejectConnect(error instanceof Error ? error : new Error(message));
    }
  }

  private resolveConnect(): void {
    if (this.connectResolve) {
      this.connectResolve();
    }
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
  }

  private rejectConnect(error: Error): void {
    if (this.connectReject) {
      this.connectReject(error);
    }
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
  }

  async close(): Promise<void> {
    if (this.connectionState.status === "disposed") {
      return;
    }
    this.shouldReconnect = false;
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.resetConnectTimeout();
    this.disposeTransport(1000, "Client closed");
    this.clearWaiters(new Error("Daemon client closed"));
    this.rejectPendingSendQueue(new Error("Daemon client closed"));
    this.pendingBrowserAutomationResponses.clear();
    this.rejectPingProbe(new Error("Daemon client closed"));
    this.terminalStreams.clearSlots();
    this.lastServerInfoMessage = null;
    if (this.runtimeMetricsInterval) {
      clearInterval(this.runtimeMetricsInterval);
      this.runtimeMetricsInterval = null;
      this.runtimeMetrics?.flush({ final: true });
      this.runtimeMetrics = null;
    }
    this.updateConnectionState(
      { status: "disposed" },
      { event: "DISPOSE", reason: "Client closed", reasonCode: "disposed" },
    );
  }

  ensureConnected(): void {
    if (this.connectionState.status === "disposed") {
      return;
    }
    if (!this.shouldReconnect) {
      this.shouldReconnect = true;
    }
    if (
      this.connectionState.status === "connected" ||
      this.connectionState.status === "connecting"
    ) {
      return;
    }
    void this.connect();
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  subscribeConnectionStatus(listener: (status: ConnectionState) => void): () => void {
    this.connectionListeners.add(listener);
    listener(this.connectionState);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  get isConnected(): boolean {
    return this.connectionState.status === "connected";
  }

  get isConnecting(): boolean {
    return this.connectionState.status === "connecting";
  }

  get lastError(): string | null {
    return this.lastErrorValue;
  }

  getLastLivenessRttMs(): number | null {
    return this.lastLivenessRttMs;
  }

  // ============================================================================
  // Message Subscription
  // ============================================================================

  subscribe(handler: DaemonEventHandler): () => void {
    this.eventListeners.add(handler);
    return () => this.eventListeners.delete(handler);
  }

  subscribeRawMessages(handler: (message: SessionOutboundMessage) => void): () => void {
    this.rawMessageListeners.add(handler);
    return () => {
      this.rawMessageListeners.delete(handler);
    };
  }

  on<TType extends SessionOutboundMessage["type"]>(
    type: TType,
    handler: (message: Extract<SessionOutboundMessage, { type: TType }>) => void,
  ): () => void;
  on(handler: DaemonEventHandler): () => void;
  on(
    arg1: SessionOutboundMessage["type"] | DaemonEventHandler,
    arg2?: (message: SessionOutboundMessage) => void,
  ): () => void {
    if (typeof arg1 === "function") {
      return this.subscribe(arg1);
    }

    const type = arg1;
    const handler = arg2!;

    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);

    return () => {
      const handlers = this.messageHandlers.get(type);
      if (!handlers) {
        return;
      }
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.messageHandlers.delete(type);
      }
    };
  }

  // ============================================================================
  // Core Send Helpers
  // ============================================================================

  /**
   * Send a session message. For fire-and-forget messages (heartbeats, etc.),
   * failures are suppressed if `suppressSendErrors` is configured.
   * For RPC methods that wait for responses, use `sendSessionMessageOrThrow` instead.
   */
  private sendSessionMessage(message: SessionInboundMessage): void {
    if (!this.transport || this.connectionState.status !== "connected") {
      if (this.config.suppressSendErrors) {
        return;
      }
      throw new Error(`Transport not connected (status: ${this.connectionState.status})`);
    }
    const payload = SessionInboundMessageSchema.parse(message);
    try {
      this.transport.send(JSON.stringify({ type: "session", message: payload }));
    } catch (error) {
      if (this.config.suppressSendErrors) {
        return;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private sendBinaryFrame(frame: Uint8Array): void {
    if (!this.transport || this.connectionState.status !== "connected") {
      if (this.config.suppressSendErrors) {
        return;
      }
      throw new Error(`Transport not connected (status: ${this.connectionState.status})`);
    }
    try {
      this.transport.send(frame);
    } catch (error) {
      if (this.config.suppressSendErrors) {
        return;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Send a session message for RPC methods that create waiters.
   * If the connection is still being established ("connecting"), the message
   * is queued and will be sent once connected (or rejected after timeout).
   * This prevents waiters from hanging forever when called during connection.
   */
  private sendSessionMessageOrThrow(message: SessionInboundMessage): Promise<void> {
    const status = this.connectionState.status;

    // If connected, send immediately
    if (this.transport && status === "connected") {
      const payload = SessionInboundMessageSchema.parse(message);
      this.transport.send(JSON.stringify({ type: "session", message: payload }));
      return Promise.resolve();
    }

    // If connecting, queue the message to be sent once connected
    if (status === "connecting") {
      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          // Remove from queue
          const idx = this.pendingSendQueue.findIndex((p) => p.resolve === resolve);
          if (idx !== -1) {
            this.pendingSendQueue.splice(idx, 1);
          }
          reject(new Error(`Timed out waiting for connection to send message`));
        }, DEFAULT_SEND_QUEUE_TIMEOUT_MS);

        this.pendingSendQueue.push({ message, resolve, reject, timeoutHandle });
      });
    }

    // Not connected and not connecting - fail immediately
    return Promise.reject(new Error(`Transport not connected (status: ${status})`));
  }

  /**
   * Flush pending send queue - called when connection is established.
   */
  private flushPendingSendQueue(): void {
    const queue = this.pendingSendQueue;
    this.pendingSendQueue = [];

    for (const pending of queue) {
      clearTimeout(pending.timeoutHandle);
      try {
        if (this.transport && this.connectionState.status === "connected") {
          const payload = SessionInboundMessageSchema.parse(pending.message);
          this.transport.send(JSON.stringify({ type: "session", message: payload }));
          pending.resolve();
        } else {
          pending.reject(new Error("Connection lost before message could be sent"));
        }
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Reject all pending sends - called when connection fails or is closed.
   */
  private rejectPendingSendQueue(error: Error): void {
    const queue = this.pendingSendQueue;
    this.pendingSendQueue = [];

    for (const pending of queue) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
  }

  async [RPC_INVOKE]<Operation extends RpcResponseOperation>(
    operation: Operation,
    invocation: RpcInvocation<Operation>,
  ): Promise<RpcResponsePayload<Operation>> {
    const descriptor = rpcRegistry.entries[operation];
    if (
      !("input" in descriptor) ||
      !descriptor.output ||
      !descriptor.requestType ||
      !descriptor.responseType
    ) {
      throw new Error(`RPC ${operation} does not have a correlated response`);
    }
    const requestId = this.createRequestId(invocation.requestId);
    const message = descriptor.input.parse({
      ...invocation.body,
      type: descriptor.requestType,
      requestId,
    }) as SessionInboundMessage;
    return this.sendRequest({
      requestId,
      message,
      timeout: invocation.timeout,
      options: { skipQueue: true },
      select: (candidate) => {
        if (candidate.type !== descriptor.responseType || !("payload" in candidate)) return null;
        const payload = candidate.payload;
        if (
          !payload ||
          typeof payload !== "object" ||
          !("requestId" in payload) ||
          payload.requestId !== requestId
        ) {
          return null;
        }
        return payload as RpcResponsePayload<Operation>;
      },
    });
  }

  private async sendRequest<T>(params: {
    requestId: string;
    message: SessionInboundMessage;
    timeout?: number;
    select: (msg: SessionOutboundMessage) => T | null;
    options?: { skipQueue?: boolean };
  }): Promise<T> {
    const timeout = params.timeout ?? DEFAULT_SESSION_RPC_TIMEOUT_MS;
    const { promise, cancel } = this.waitForWithCancel<RpcWaitResult<T>>(
      (msg) => {
        if (msg.type === "rpc_error" && msg.payload.requestId === params.requestId) {
          return {
            kind: "error",
            error: new DaemonRpcError({
              requestId: msg.payload.requestId,
              error: msg.payload.error,
              requestType: msg.payload.requestType,
              code: msg.payload.code,
            }),
          };
        }
        const value = params.select(msg);
        if (value === null) {
          return null;
        }
        return { kind: "ok", value };
      },
      timeout,
      params.options,
    );

    try {
      await this.sendSessionMessageOrThrow(params.message);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      cancel(err);
      void promise.catch(() => undefined);
      throw err;
    }

    const result = await promise;
    if (result.kind === "error") {
      throw result.error;
    }
    return result.value;
  }

  sendHeartbeat(params: {
    deviceType: "web" | "mobile";
    focusedAgentId: string | null;
    focusedTerminalId?: string | null;
    lastActivityAt: string;
    appVisible: boolean;
    appVisibilityChangedAt?: string;
  }): void {
    this.sendSessionMessage({
      type: "client_heartbeat",
      deviceType: params.deviceType,
      focusedAgentId: params.focusedAgentId,
      focusedTerminalId: params.focusedTerminalId ?? null,
      lastActivityAt: params.lastActivityAt,
      appVisible: params.appVisible,
      appVisibilityChangedAt: params.appVisibilityChangedAt,
    });
  }

  registerPushToken(token: string): void {
    this.sendSessionMessage({
      type: "register_push_token",
      token,
    });
  }

  async ping(params?: { requestId?: string; timeoutMs?: number }): Promise<{
    requestId: string;
    clientSentAt: number;
    serverReceivedAt: number;
    serverSentAt: number;
    rttMs: number;
  }> {
    const requestId =
      params?.requestId ?? `ping-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const clientSentAt = Date.now();

    const payload = await this.sendRequest({
      requestId,
      message: { type: "ping", requestId, clientSentAt },
      timeout: params?.timeoutMs ?? 5000,
      select: (msg) => {
        if (msg.type !== "pong") return null;
        if (msg.payload.requestId !== requestId) return null;
        if (typeof msg.payload.serverReceivedAt !== "number") return null;
        if (typeof msg.payload.serverSentAt !== "number") return null;
        return msg.payload;
      },
    });

    return {
      requestId,
      clientSentAt,
      serverReceivedAt: payload.serverReceivedAt,
      serverSentAt: payload.serverSentAt,
      rttMs: Date.now() - clientSentAt,
    };
  }

  measureLatency(params?: { timeoutMs?: number }): Promise<number> {
    const timeoutMs = Math.max(1, params?.timeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS);
    return this.sendPingAwaitRtt({ timeoutMs, drivesLivenessFailure: false }).catch((error) => {
      throw toTimeoutError(error, "Latency measurement", timeoutMs);
    });
  }

  private async livenessPing(params?: { timeoutMs?: number }): Promise<number> {
    const timeoutMs = Math.max(1, params?.timeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS);
    try {
      const rttMs = await this.sendPingAwaitRtt({ timeoutMs, drivesLivenessFailure: true });
      this.lastLivenessRttMs = rttMs;
      return rttMs;
    } catch (error) {
      throw toTimeoutError(error, "Liveness check", timeoutMs);
    }
  }

  private sendPingAwaitRtt(params: {
    timeoutMs: number;
    drivesLivenessFailure: boolean;
  }): Promise<number> {
    if (this.connectionState.status !== "connected" || !this.transport) {
      return Promise.reject(
        new Error(`Transport not connected (status: ${this.connectionState.status})`),
      );
    }

    if (this.pingProbe) {
      return this.pingProbe.promise;
    }

    const startedAt = perfNow();
    const timeoutMs = params.timeoutMs;
    let resolveProbe: ((value: number) => void) | null = null;
    let rejectProbe: ((error: Error) => void) | null = null;
    const promise = new Promise<number>((resolve, reject) => {
      resolveProbe = resolve;
      rejectProbe = reject;
    });
    const probe: PingProbe = {
      promise,
      resolve: (value) => resolveProbe?.(value),
      reject: (error) => rejectProbe?.(error),
      timeoutHandle: setTimeout(() => {
        if (this.pingProbe !== probe) {
          return;
        }
        this.pingProbe = null;
        const error = new PingTimeoutError(timeoutMs);
        probe.reject(error);
        if (probe.drivesLivenessFailure) {
          this.recordLivenessFailure(toTimeoutError(error, "Liveness check", timeoutMs));
        }
      }, timeoutMs),
      startedAt,
      drivesLivenessFailure: params.drivesLivenessFailure,
    };
    this.pingProbe = probe;

    try {
      this.transport.send(JSON.stringify({ type: "ping" }));
    } catch (error) {
      this.clearPingProbe();
      const sendError = error instanceof Error ? error : new Error(String(error));
      if (probe.drivesLivenessFailure) {
        this.recordLivenessFailure(sendError);
      }
      return Promise.reject(sendError);
    }

    return promise;
  }

  private startLivenessHeartbeat(): void {
    this.stopLivenessHeartbeat();
    this.lastLivenessRttMs = null;
    this.scheduleNextLivenessHeartbeat();
  }

  private stopLivenessHeartbeat(): void {
    if (!this.livenessHeartbeatTimer) {
      return;
    }
    clearTimeout(this.livenessHeartbeatTimer);
    this.livenessHeartbeatTimer = null;
  }

  private scheduleNextLivenessHeartbeat(): void {
    if (this.connectionState.status !== "connected" || this.livenessHeartbeatTimer) {
      return;
    }
    this.livenessHeartbeatTimer = setTimeout(() => {
      this.livenessHeartbeatTimer = null;
      this.livenessPing({ timeoutMs: LIVENESS_HEARTBEAT_TIMEOUT_MS })
        .catch(() => {})
        .finally(() => {
          this.scheduleNextLivenessHeartbeat();
        });
    }, LIVENESS_HEARTBEAT_INTERVAL_MS);
  }

  // ============================================================================
  // Agent RPCs (requestId-correlated)
  // ============================================================================

  subscribeAgentThothStateUpdates(
    handler: (payload: AgentThothStateUpdatePayload) => void,
  ): () => void {
    return this.on("agent.thoth.state.update", (message) => handler(message.payload));
  }

  subscribeAgentDecisionTreeDeltas(
    handler: (
      payload: Extract<SessionOutboundMessage, { type: "agent.decision_tree.delta" }>["payload"],
    ) => void,
  ): () => void {
    return this.on("agent.decision_tree.delta", (message) => handler(message.payload));
  }

  subscribeWorkspaceAuthorityUpdates(
    handler: (
      payload: Extract<SessionOutboundMessage, { type: "workspace.authority.update" }>["payload"],
    ) => void,
  ): () => void {
    return this.on("workspace.authority.update", (message) => handler(message.payload));
  }

  async fetchAgent(options: FetchAgentOptions): Promise<FetchAgentResult | null>;
  async fetchAgent(agentId: string, requestId?: string): Promise<FetchAgentResult | null>;
  async fetchAgent(
    agentId: string,
    options?: LegacyFetchAgentOptions,
  ): Promise<FetchAgentResult | null>;
  async fetchAgent(
    input: FetchAgentOptions | string,
    legacyOptions?: LegacyFetchAgentOptions | string,
  ): Promise<FetchAgentResult | null> {
    const options = normalizeFetchAgentOptions(input, legacyOptions);
    const resolvedRequestId = this.createRequestId(options.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "fetch_agent_request",
      requestId: resolvedRequestId,
      agentId: options.agentId,
    });
    const payload = await this.sendRequest({
      requestId: resolvedRequestId,
      message,
      timeout: options.timeout,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "fetch_agent_response") {
          return null;
        }
        if (msg.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return msg.payload;
      },
    });
    if (payload.errorCode === "agent_not_found") {
      return null;
    }
    if (payload.error) {
      throw new Error(payload.error);
    }
    if (!payload.agent) {
      return null;
    }
    return { agent: payload.agent, project: payload.project ?? null };
  }

  private resubscribeCheckoutDiffSubscriptions(): void {
    if (this.checkoutDiffSubscriptions.size === 0) {
      return;
    }
    for (const [subscriptionId, subscription] of this.checkoutDiffSubscriptions) {
      const message = SessionInboundMessageSchema.parse({
        type: "subscribe_checkout_diff_request",
        subscriptionId,
        cwd: subscription.cwd,
        compare: subscription.compare,
        requestId: this.createRequestId(),
      });
      this.sendSessionMessage(message);
    }
  }

  private resubscribeTerminalDirectorySubscriptions(): void {
    if (this.terminalDirectorySubscriptions.size === 0) {
      return;
    }
    for (const subscription of this.terminalDirectorySubscriptions.values()) {
      this.sendSessionMessage({
        type: "subscribe_terminals_request",
        cwd: subscription.cwd,
        ...(subscription.workspaceId !== undefined
          ? { workspaceId: subscription.workspaceId }
          : {}),
      });
    }
  }

  // ============================================================================
  // Agent Lifecycle
  // ============================================================================

  // ============================================================================
  // Agent Interaction
  // ============================================================================

  async sendMessage(agentId: string, text: string, options?: SendMessageOptions): Promise<void> {
    await clientRpcBindings.sendAgentMessage.invoke(this, [agentId, text, options]);
  }

  // ============================================================================
  // Git Operations
  // ============================================================================

  async getCheckoutStatus(
    cwd: string,
    options?: { requestId?: string },
  ): Promise<CheckoutStatusPayload> {
    const requestId = options?.requestId;

    if (!requestId) {
      const existing = this.checkoutStatusInFlight.get(cwd);
      if (existing) {
        return existing;
      }
    }

    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "checkout_status_request",
      cwd,
      requestId: resolvedRequestId,
    });

    const responsePromise = this.sendRequest({
      requestId: resolvedRequestId,
      message,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "checkout_status_response") {
          return null;
        }
        if (msg.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return msg.payload;
      },
    });

    if (!requestId) {
      this.checkoutStatusInFlight.set(cwd, responsePromise);
      void responsePromise
        .finally(() => {
          if (this.checkoutStatusInFlight.get(cwd) === responsePromise) {
            this.checkoutStatusInFlight.delete(cwd);
          }
        })
        .catch(() => undefined);
    }

    return responsePromise;
  }

  private normalizeCheckoutDiffCompare(compare: {
    mode: "uncommitted" | "base";
    baseRef?: string;
    ignoreWhitespace?: boolean;
  }): { mode: "uncommitted" | "base"; baseRef?: string; ignoreWhitespace?: boolean } {
    if (compare.mode === "uncommitted") {
      return compare.ignoreWhitespace === true
        ? { mode: "uncommitted", ignoreWhitespace: true }
        : { mode: "uncommitted" };
    }
    const trimmedBaseRef = compare.baseRef?.trim();
    if (!trimmedBaseRef) {
      return compare.ignoreWhitespace === true
        ? { mode: "base", ignoreWhitespace: true }
        : { mode: "base" };
    }
    return compare.ignoreWhitespace === true
      ? { mode: "base", baseRef: trimmedBaseRef, ignoreWhitespace: true }
      : { mode: "base", baseRef: trimmedBaseRef };
  }

  async getCheckoutDiff(
    cwd: string,
    compare: { mode: "uncommitted" | "base"; baseRef?: string; ignoreWhitespace?: boolean },
    requestId?: string,
  ): Promise<CheckoutDiffPayload> {
    const oneShotSubscriptionId = `oneshot-checkout-diff:${crypto.randomUUID()}`;
    try {
      const payload = await this.subscribeCheckoutDiff(cwd, compare, {
        subscriptionId: oneShotSubscriptionId,
        requestId,
      });
      return {
        cwd: payload.cwd,
        files: payload.files,
        error: payload.error,
        requestId: payload.requestId,
      };
    } finally {
      try {
        this.unsubscribeCheckoutDiff(oneShotSubscriptionId);
      } catch {
        // Ignore disconnect races during one-shot cleanup.
      }
    }
  }

  async subscribeCheckoutDiff(
    cwd: string,
    compare: { mode: "uncommitted" | "base"; baseRef?: string; ignoreWhitespace?: boolean },
    options?: { subscriptionId?: string; requestId?: string },
  ): Promise<SubscribeCheckoutDiffPayload> {
    const subscriptionId = options?.subscriptionId ?? crypto.randomUUID();
    const normalizedCompare = this.normalizeCheckoutDiffCompare(compare);
    const previousSubscription = this.checkoutDiffSubscriptions.get(subscriptionId) ?? null;
    this.checkoutDiffSubscriptions.set(subscriptionId, {
      cwd,
      compare: normalizedCompare,
    });

    const resolvedRequestId = this.createRequestId(options?.requestId);
    try {
      const payload = await this[RPC_INVOKE]("subscribeCheckoutDiff", {
        body: { subscriptionId, cwd, compare: normalizedCompare },
        requestId: resolvedRequestId,
      });
      if (payload.subscriptionId !== subscriptionId) {
        throw new Error(`Unexpected checkout subscription ${payload.subscriptionId}`);
      }
      return payload;
    } catch (error) {
      if (previousSubscription) {
        this.checkoutDiffSubscriptions.set(subscriptionId, previousSubscription);
      } else {
        this.checkoutDiffSubscriptions.delete(subscriptionId);
      }
      throw error;
    }
  }

  unsubscribeCheckoutDiff(subscriptionId: string): void {
    this.checkoutDiffSubscriptions.delete(subscriptionId);
    this.sendSessionMessage({
      type: "unsubscribe_checkout_diff_request",
      subscriptionId,
    });
  }

  // ============================================================================
  // File Explorer
  // ============================================================================

  private async requestFileExplorer(
    cwd: string,
    path: string,
    mode: "list" | "file",
    requestId?: string,
    acceptBinary = false,
  ): Promise<FileExplorerPayload> {
    return this[RPC_INVOKE]("requestFileExplorer", {
      body: {
        cwd,
        path,
        mode,
        ...(acceptBinary ? { acceptBinary: true } : {}),
      },
      requestId,
    });
  }

  async listDirectory(
    cwd: string,
    path: string,
    requestId?: string,
  ): Promise<FileExplorerDirectoryPayload> {
    const payload = await this.requestFileExplorer(cwd, path, "list", requestId);
    if (payload.error) {
      throw new Error(payload.error);
    }
    if (!payload.directory) {
      throw new Error("Directory listing unavailable.");
    }
    return payload.directory;
  }

  async readFile(cwd: string, path: string, requestId?: string): Promise<FileReadResult> {
    const resolvedRequestId = this.createRequestId(requestId);
    this.pendingBinaryFileReads.set(resolvedRequestId, { cwd, path });
    try {
      const payload = await this.requestFileExplorer(cwd, path, "file", resolvedRequestId, true);
      if (payload.error) {
        throw new Error(payload.error);
      }
      const binaryResult = this.completedBinaryFileReads.get(resolvedRequestId);
      if (binaryResult) {
        this.completedBinaryFileReads.delete(resolvedRequestId);
        return binaryResult;
      }
      if (!payload.file) {
        throw new Error("File unavailable.");
      }
      return legacyExplorerFileToBytes(payload.file);
    } finally {
      this.pendingBinaryFileReads.delete(resolvedRequestId);
      this.activeBinaryFileTransfers.delete(resolvedRequestId);
    }
  }

  async uploadFile(input: FileUploadInput): Promise<FileUploadResult> {
    const bytes = asUint8Array(input.bytes);
    if (!bytes) {
      throw new Error("File bytes are required.");
    }
    const resolvedRequestId = this.createRequestId(input.requestId);
    const modifiedAt = input.modifiedAt ?? new Date().toISOString();
    const responsePromise = this[RPC_INVOKE]("uploadFile", {
      body: {
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: bytes.byteLength,
        modifiedAt,
      },
      requestId: resolvedRequestId,
    });

    this.sendBinaryFrame(
      encodeFileTransferFrame({
        opcode: FileTransferOpcode.FileBegin,
        requestId: resolvedRequestId,
        metadata: {
          mime: input.mimeType,
          size: bytes.byteLength,
          encoding: "binary",
          modifiedAt,
          fileName: input.fileName,
        },
      }),
    );

    const chunkSize = input.chunkSize ?? 1024 * 1024;
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      this.sendBinaryFrame(
        encodeFileTransferFrame({
          opcode: FileTransferOpcode.FileChunk,
          requestId: resolvedRequestId,
          payload: bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)),
        }),
      );
    }

    this.sendBinaryFrame(
      encodeFileTransferFrame({
        opcode: FileTransferOpcode.FileEnd,
        requestId: resolvedRequestId,
      }),
    );

    return responsePromise;
  }

  // ============================================================================
  // Provider Models / Commands
  // ============================================================================

  async listCommands(options: ListCommandsOptions): Promise<ListCommandsPayload>;
  async listCommands(agentId: string, requestId?: string): Promise<ListCommandsPayload>;
  async listCommands(
    agentId: string,
    options?: LegacyListCommandsOptions,
  ): Promise<ListCommandsPayload>;
  async listCommands(
    input: ListCommandsOptions | string,
    legacyOptions?: LegacyListCommandsOptions | string,
  ): Promise<ListCommandsPayload> {
    const options = normalizeListCommandsOptions(input, legacyOptions);
    return this[RPC_INVOKE]("listCommands", {
      body: {
        agentId: options.agentId,
        ...(options.draftConfig ? { draftConfig: options.draftConfig } : {}),
      },
      requestId: options.requestId,
    });
  }

  // ============================================================================
  // Permissions
  // ============================================================================

  async respondToPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void> {
    this.sendSessionMessage({
      type: "agent_permission_response",
      agentId,
      requestId,
      response,
    });
  }

  async respondToPermissionAndWait(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
    timeout = 15000,
  ): Promise<AgentPermissionResolvedPayload> {
    const message = SessionInboundMessageSchema.parse({
      type: "agent_permission_response",
      agentId,
      requestId,
      response,
    });
    return this.sendRequest({
      requestId,
      message,
      timeout,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "agent_permission_resolved") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        if (msg.payload.agentId !== agentId) {
          return null;
        }
        return msg.payload;
      },
    });
  }

  async respondProviderQuestion(input: {
    agentId: string;
    interactionId: string;
    expectedRevision: number;
    commandId: string;
    resolution: ProviderQuestionResolution;
    requestId?: string;
    timeout?: number;
  }): Promise<AgentProviderQuestionRespondResponse["payload"]> {
    return this[RPC_INVOKE]("respondProviderQuestion", {
      body: {
        agentId: input.agentId,
        interactionId: input.interactionId,
        expectedRevision: input.expectedRevision,
        commandId: input.commandId,
        resolution: input.resolution,
      },
      requestId: input.requestId,
      timeout: input.timeout,
    });
  }

  async respondProviderQuestionAndWait(input: {
    agentId: string;
    interactionId: string;
    expectedRevision: number;
    commandId: string;
    resolution: ProviderQuestionResolution;
    requestId?: string;
    timeout?: number;
  }): Promise<AgentProviderQuestionRespondResponse["payload"]> {
    return this.respondProviderQuestion(input);
  }

  // ============================================================================
  // Waiting / Streaming Helpers
  // ============================================================================

  async waitForAgentUpsert(
    agentId: string,
    predicate: (snapshot: AgentSnapshotPayload) => boolean,
    timeout = 60000,
  ): Promise<AgentSnapshotPayload> {
    const deadline = Date.now() + timeout;
    const remainingTimeoutMs = () => Math.max(1, deadline - Date.now());
    const timeoutError = () => new Error(`Timed out waiting for agent ${agentId}`);
    const fetchAgentWithinDeadline = () =>
      this.fetchAgent({ agentId, timeout: remainingTimeoutMs() }).catch(() => null);

    const initialResult = await fetchAgentWithinDeadline();
    if (initialResult && predicate(initialResult.agent)) {
      return initialResult.agent;
    }
    if (Date.now() >= deadline) {
      throw timeoutError();
    }

    return await new Promise<AgentSnapshotPayload>((resolve, reject) => {
      let settled = false;
      let pollInFlight = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let unsubscribe: (() => void) | null = null;

      const finish = (
        result: { kind: "ok"; snapshot: AgentSnapshotPayload } | { kind: "error"; error: Error },
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (result.kind === "ok") {
          resolve(result.snapshot);
          return;
        }
        reject(result.error);
      };

      const maybeResolve = (snapshot: AgentSnapshotPayload | null) => {
        if (!snapshot) {
          return false;
        }
        if (!predicate(snapshot)) {
          return false;
        }
        finish({ kind: "ok", snapshot });
        return true;
      };

      const poll = async () => {
        if (settled || pollInFlight) {
          return;
        }
        pollInFlight = true;
        try {
          const result = await fetchAgentWithinDeadline();
          maybeResolve(result?.agent ?? null);
        } finally {
          pollInFlight = false;
        }
      };

      unsubscribe = this.on("agent_update", (message) => {
        if (settled) {
          return;
        }
        if (message.payload.kind !== "upsert") {
          return;
        }
        const snapshot = message.payload.agent;
        if (snapshot.id !== agentId) {
          return;
        }
        maybeResolve(snapshot);
      });

      const remaining = Math.max(1, deadline - Date.now());
      timeoutTimer = setTimeout(() => {
        finish({
          kind: "error",
          error: timeoutError(),
        });
      }, remaining);

      pollTimer = setInterval(() => {
        void poll();
      }, 250);
      void poll();
    });
  }

  async waitForFinish(agentId: string, timeout = 60000): Promise<WaitForFinishResult> {
    const requestId = this.createRequestId();
    const hasTimeout = Number.isFinite(timeout) && timeout > 0;
    const payload = await this[RPC_INVOKE]("waitForFinish", {
      body: { agentId, ...(hasTimeout ? { timeoutMs: timeout } : {}) },
      requestId,
      timeout: hasTimeout ? timeout + 5000 : 0,
    });
    return {
      status: payload.status,
      final: payload.final,
      error: payload.error,
      lastMessage: payload.lastMessage,
    };
  }

  // ============================================================================
  // Terminals
  // ============================================================================

  subscribeTerminals(input: { cwd: string; workspaceId?: string }): void {
    this.terminalDirectorySubscriptions.set(terminalSubscriptionKey(input.cwd, input.workspaceId), {
      cwd: input.cwd,
      workspaceId: input.workspaceId,
    });
    if (!this.transport || this.connectionState.status !== "connected") {
      return;
    }
    this.sendSessionMessage({
      type: "subscribe_terminals_request",
      cwd: input.cwd,
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    });
  }

  unsubscribeTerminals(input: { cwd: string; workspaceId?: string }): void {
    this.terminalDirectorySubscriptions.delete(
      terminalSubscriptionKey(input.cwd, input.workspaceId),
    );
    if (!this.transport || this.connectionState.status !== "connected") {
      return;
    }
    this.sendSessionMessage({
      type: "unsubscribe_terminals_request",
      cwd: input.cwd,
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    });
  }

  async subscribeTerminal(
    terminalId: string,
    optionsOrRequestId?:
      | { restore?: SubscribeTerminalRequest["restore"]; requestId?: string }
      | string,
  ): Promise<SubscribeTerminalPayload> {
    const restore = typeof optionsOrRequestId === "object" ? optionsOrRequestId.restore : undefined;
    const requestId =
      typeof optionsOrRequestId === "object" ? optionsOrRequestId.requestId : optionsOrRequestId;
    const resolvedRequestId = this.createRequestId(requestId);
    const payload = await this[RPC_INVOKE]("subscribeTerminal", {
      body: { terminalId, ...(restore ? { restore } : {}) },
      requestId: resolvedRequestId,
    });
    if (payload.error === null) {
      this.terminalStreams.setSlot(terminalId, payload.slot);
    }
    return payload;
  }

  unsubscribeTerminal(terminalId: string): void {
    this.terminalStreams.removeTerminal(terminalId);
    this.sendSessionMessage({
      type: "unsubscribe_terminal_request",
      terminalId,
    });
  }

  sendTerminalInput(terminalId: string, message: TerminalInput["message"]): void {
    const frame = this.terminalStreams.encodeInput(terminalId, message);
    if (frame) {
      this.sendBinaryFrame(frame);
      return;
    }
    this.sendSessionMessage({
      type: "terminal_input",
      terminalId,
      message,
    });
  }

  onTerminalStreamEvent(handler: (event: TerminalStreamEvent) => void): () => void {
    return this.terminalStreams.onEvent(handler);
  }

  async waitForTerminalStreamEvent(
    predicate: (event: TerminalStreamEvent) => boolean,
    timeout = 5000,
  ): Promise<TerminalStreamEvent> {
    return new Promise<TerminalStreamEvent>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for terminal stream event (${timeout}ms)`));
      }, timeout);

      const unsubscribe = this.onTerminalStreamEvent((event) => {
        if (!predicate(event)) {
          return;
        }
        clearTimeout(timeoutHandle);
        unsubscribe();
        resolve(event);
      });
    });
  }

  sendBrowserAutomationExecuteResponse(response: BrowserAutomationExecuteResponse): boolean {
    if (this.connectionState.status === "disposed") {
      return false;
    }
    this.pendingBrowserAutomationResponses.set(response.payload.requestId, response);
    this.flushPendingBrowserAutomationResponses();
    return true;
  }

  // ============================================================================
  // Internals
  // ============================================================================

  private createRequestId(requestId?: string): string {
    return requestId ?? crypto.randomUUID();
  }

  getLastServerInfoMessage(): ServerInfoStatusPayload | null {
    return this.lastServerInfoMessage;
  }

  private resolveTransportUrlForAttempt(): string {
    return this.config.url;
  }

  private sendHelloMessage(): void {
    if (!this.transport) {
      this.scheduleReconnect({
        reason: "Transport unavailable before hello",
        event: "HELLO_TRANSPORT_MISSING",
        reasonCode: "transport_error",
      });
      return;
    }

    try {
      this.transport.send(
        JSON.stringify({
          type: "hello",
          clientId: this.config.clientId,
          clientType: this.config.clientType ?? "cli",
          protocolVersion: RPC_PROTOCOL_VERSION,
          capabilities: {
            [CLIENT_CAPS.customModeIcons]: true,
            [CLIENT_CAPS.reasoningMergeEnum]: true,
            [CLIENT_CAPS.terminalReflowableSnapshot]: true,
            ...this.config.capabilities,
          },
          ...(this.config.appVersion ? { appVersion: this.config.appVersion } : {}),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send hello message";
      this.lastErrorValue = message;
      this.scheduleReconnect({
        reason: message,
        event: "HELLO_SEND_FAILED",
        reasonCode: "transport_error",
      });
    }
  }

  private disposeTransport(code = 1001, reason = "Reconnecting"): void {
    this.stopLivenessHeartbeat();
    this.cleanupTransport();
    if (this.transport) {
      try {
        this.transport.close(code, reason);
      } catch {
        // no-op
      }
      this.transport = null;
    }
  }

  private cleanupTransport(): void {
    this.resetConnectTimeout();
    if (this.pendingGenericTransportErrorTimeout) {
      clearTimeout(this.pendingGenericTransportErrorTimeout);
      this.pendingGenericTransportErrorTimeout = null;
    }
    for (const cleanup of this.transportCleanup) {
      try {
        cleanup();
      } catch {
        // no-op
      }
    }
    this.transportCleanup = [];
  }

  private resetConnectTimeout(): void {
    if (!this.connectTimeout) {
      return;
    }
    clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
  }

  private handleTransportMessage(data: unknown): void {
    const rawData =
      data && typeof data === "object" && "data" in data ? (data as { data: unknown }).data : data;

    if (
      typeof Blob !== "undefined" &&
      rawData instanceof Blob &&
      typeof rawData.arrayBuffer === "function"
    ) {
      void rawData
        .arrayBuffer()
        .then((buffer) => {
          this.handleTransportMessage(buffer);
          return;
        })
        .catch(() => {
          // Ignore failed blob decoding and allow reconnect logic to recover.
        });
      return;
    }

    const rawBytes = asUint8Array(rawData);
    if (rawBytes && this.tryHandleBinaryFrame(rawBytes)) {
      return;
    }
    const payload = decodeMessageData(rawData);
    if (!payload) {
      return;
    }
    this.handleJsonPayload(payload, rawBytes?.byteLength);
  }

  private handleJsonPayload(payload: string, rawBytesLength: number | undefined): void {
    const bytes = rawBytesLength ?? payload.length;
    const startMs = perfNow();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(payload);
    } catch {
      return;
    }

    const parsed = WSOutboundMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const msgType =
        parsedJson != null &&
        typeof parsedJson === "object" &&
        "type" in parsedJson &&
        typeof parsedJson.type === "string"
          ? parsedJson.type
          : "unknown";
      this.logger.warn({ msgType, error: parsed.error.message }, "Message validation failed");
      return;
    }

    this.consecutiveLivenessFailures = 0;

    if (parsed.data.type === "pong") {
      this.resolvePingProbe();
      this.runtimeMetrics?.recordMessage("pong", bytes, perfNow() - startMs);
      return;
    }

    this.handleSessionMessage(parsed.data.message);
    const msgType = parsed.data.message.type;
    this.runtimeMetrics?.recordMessage(msgType, bytes, perfNow() - startMs);
    if (parsed.data.message.type === "agent_stream") {
      this.runtimeMetrics?.recordAgentStream(parsed.data.message.payload);
    }
  }

  private tryHandleBinaryFrame(rawBytes: Uint8Array): boolean {
    const fileFrame = decodeFileTransferFrame(rawBytes);
    if (fileFrame) {
      this.consecutiveLivenessFailures = 0;
      this.handleFileTransferFrame(fileFrame);
      this.runtimeMetrics?.recordBinaryFrame("other", rawBytes.byteLength, 0);
      return true;
    }

    const frame = decodeTerminalStreamFrame(rawBytes);
    if (!frame) {
      return false;
    }
    this.consecutiveLivenessFailures = 0;
    const binaryStartMs = perfNow();
    this.terminalStreams.handleFrame(frame);
    let frameKind: "output" | "snapshot" | "other" = "other";
    if (frame.opcode === TerminalStreamOpcode.Output) {
      frameKind = "output";
    } else if (frame.opcode === TerminalStreamOpcode.Snapshot) {
      frameKind = "snapshot";
    } else if (frame.opcode === TerminalStreamOpcode.Restore) {
      frameKind = "output";
    }
    this.runtimeMetrics?.recordBinaryFrame(
      frameKind,
      rawBytes.byteLength,
      perfNow() - binaryStartMs,
    );
    return true;
  }

  private handleFileTransferFrame(frame: FileTransferFrame): void {
    if (frame.opcode === FileTransferOpcode.FileBegin) {
      const pending = this.pendingBinaryFileReads.get(frame.requestId);
      if (!pending) {
        return;
      }
      this.activeBinaryFileTransfers.set(frame.requestId, {
        ...pending,
        mime: frame.metadata.mime,
        size: frame.metadata.size,
        encoding: frame.metadata.encoding,
        modifiedAt: frame.metadata.modifiedAt,
        revision: frame.metadata.revision,
        bytesReceived: 0,
        chunks: [],
      });
      return;
    }

    const transfer = this.activeBinaryFileTransfers.get(frame.requestId);
    if (!transfer) {
      return;
    }

    if (frame.opcode === FileTransferOpcode.FileChunk) {
      const nextBytesReceived = transfer.bytesReceived + frame.payload.byteLength;
      if (nextBytesReceived > transfer.size) {
        this.failBinaryFileTransfer(
          frame.requestId,
          transfer,
          `File transfer exceeded advertised size ${transfer.size} bytes`,
        );
        return;
      }
      transfer.chunks.push(frame.payload);
      transfer.bytesReceived = nextBytesReceived;
      return;
    }

    if (transfer.bytesReceived !== transfer.size) {
      this.failBinaryFileTransfer(
        frame.requestId,
        transfer,
        `File transfer ended at ${transfer.bytesReceived} bytes; expected ${transfer.size} bytes`,
      );
      return;
    }

    const bytes = concatByteChunks(transfer.chunks, transfer.size);
    this.activeBinaryFileTransfers.delete(frame.requestId);
    this.completedBinaryFileReads.set(frame.requestId, {
      bytes,
      mime: transfer.mime,
      size: transfer.size,
      path: transfer.path,
      kind: binaryFileKind(transfer.mime, transfer.encoding),
      modifiedAt: transfer.modifiedAt,
      ...(transfer.revision ? { revision: transfer.revision } : {}),
    });
    this.handleSessionMessage({
      type: "file_explorer_response",
      payload: {
        cwd: transfer.cwd,
        path: transfer.path,
        mode: "file",
        directory: null,
        file: null,
        error: null,
        requestId: frame.requestId,
      },
    });
  }

  private failBinaryFileTransfer(
    requestId: string,
    transfer: BinaryFileTransferState,
    error: string,
  ): void {
    this.activeBinaryFileTransfers.delete(requestId);
    this.completedBinaryFileReads.delete(requestId);
    this.handleSessionMessage({
      type: "file_explorer_response",
      payload: {
        cwd: transfer.cwd,
        path: transfer.path,
        mode: "file",
        directory: null,
        file: null,
        error,
        requestId,
      },
    });
  }

  private updateConnectionState(
    next: ConnectionState,
    metadata?: { event: string; reason?: string; reasonCode?: string },
  ): void {
    const previous = this.connectionState;
    this.connectionState = next;
    const reasonFromNext =
      next.status === "disconnected" && typeof next.reason === "string" ? next.reason : null;
    const reason = metadata?.reason ?? reasonFromNext;
    const reasonCode = metadata?.reasonCode ?? toReasonCode(reason);
    this.logger.debug(
      {
        serverId: this.logServerId,
        clientIdHash: this.logClientIdHash,
        from: previous.status,
        to: next.status,
        event: metadata?.event ?? "STATE_UPDATE",
        connectionPath: this.logConnectionPath,
        generation: this.logGeneration,
        reasonCode,
        reason,
      },
      "DaemonClientTransition",
    );
    for (const listener of this.connectionListeners) {
      try {
        listener(next);
      } catch {
        // no-op
      }
    }
  }

  setReconnectEnabled(enabled: boolean): void {
    this.config = { ...this.config, reconnect: { ...this.config.reconnect, enabled } };
  }

  private scheduleReconnect(input?: {
    reason?: string;
    event?: string;
    reasonCode?: string;
  }): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    const wasDisposed = this.connectionState.status === "disposed";
    const reason = input?.reason;

    if (typeof reason === "string" && reason.trim().length > 0) {
      this.lastErrorValue = reason.trim();
    }

    // Clear all pending waiters and queued sends since the connection was lost
    // and responses from the previous connection will never arrive.
    this.clearWaiters(new Error(reason ?? "Connection lost"));
    this.rejectPendingSendQueue(new Error(reason ?? "Connection lost"));
    this.rejectPingProbe(new Error(reason ?? "Connection lost"));
    this.terminalStreams.clearSlots();
    this.lastServerInfoMessage = null;

    if (wasDisposed) {
      this.rejectConnect(new Error(reason ?? "Daemon client is disposed"));
      return;
    }
    this.emitDisconnectedStateForReconnect(reason, input);
    if (!this.shouldReconnect || this.config.reconnect?.enabled === false) {
      this.rejectConnect(new Error(reason ?? "Transport disconnected before connect"));
      return;
    }

    this.armReconnectTimer();
  }

  private emitDisconnectedStateForReconnect(
    reason: string | undefined,
    input: { reason?: string; event?: string; reasonCode?: string } | undefined,
  ): void {
    this.updateConnectionState(
      {
        status: "disconnected",
        ...(reason ? { reason } : {}),
      },
      {
        event: input?.event ?? "TRANSPORT_CLOSE",
        ...(reason ? { reason } : {}),
        ...(input?.reasonCode ? { reasonCode: input.reasonCode } : {}),
      },
    );
  }

  private armReconnectTimer(): void {
    const attempt = this.reconnectAttempt;
    const baseDelay = this.config.reconnect?.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    const maxDelay = this.config.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
    this.reconnectAttempt = attempt + 1;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.shouldReconnect) {
        return;
      }
      this.attemptConnect();
    }, delay);
  }

  private resolvePingProbe(): void {
    const probe = this.pingProbe;
    if (!probe) {
      return;
    }
    this.pingProbe = null;
    clearTimeout(probe.timeoutHandle);
    probe.resolve(perfNow() - probe.startedAt);
  }

  private clearPingProbe(): void {
    const probe = this.pingProbe;
    if (!probe) {
      return;
    }
    this.pingProbe = null;
    clearTimeout(probe.timeoutHandle);
  }

  private rejectPingProbe(error: Error): void {
    const probe = this.pingProbe;
    if (!probe) {
      return;
    }
    this.pingProbe = null;
    clearTimeout(probe.timeoutHandle);
    probe.reject(error);
  }

  private recordLivenessFailure(error: Error): void {
    this.consecutiveLivenessFailures += 1;
    if (this.consecutiveLivenessFailures < LIVENESS_FAILURE_RECONNECT_THRESHOLD) {
      return;
    }
    this.consecutiveLivenessFailures = 0;
    this.lastErrorValue = error.message;
    this.disposeTransport(1001, "Liveness check timed out");
    this.scheduleReconnect({
      reason: error.message,
      event: "LIVENESS_TIMEOUT",
      reasonCode: "liveness_timeout",
    });
  }

  private handleSessionMessage(msg: SessionOutboundMessage): void {
    if (msg.type === "status") {
      const serverInfo = parseServerInfoStatusPayload(msg.payload);
      if (serverInfo) {
        this.lastServerInfoMessage = serverInfo;
        if (this.connectionState.status === "connecting") {
          this.resetConnectTimeout();
          this.reconnectAttempt = 0;
          this.updateConnectionState({ status: "connected" }, { event: "HELLO_SERVER_INFO" });
          this.startLivenessHeartbeat();
          this.resubscribeCheckoutDiffSubscriptions();
          this.resubscribeTerminalDirectorySubscriptions();
          this.flushPendingSendQueue();
          this.flushPendingBrowserAutomationResponses();
          this.resolveConnect();
        }
      }
    }

    if (msg.type === "terminal_stream_exit") {
      this.terminalStreams.removeTerminal(msg.payload.terminalId);
    }

    if (this.rawMessageListeners.size > 0) {
      for (const handler of this.rawMessageListeners) {
        try {
          handler(msg);
        } catch {
          // no-op
        }
      }
    }

    const handlers = this.messageHandlers.get(msg.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(msg);
        } catch {
          // no-op
        }
      }
    }

    const event = this.toEvent(msg);
    if (event) {
      for (const handler of this.eventListeners) {
        handler(event);
      }
    }

    this.resolveWaiters(msg);
  }

  private resolveWaiters(msg: SessionOutboundMessage): void {
    for (const waiter of Array.from(this.waiters)) {
      const result = waiter.predicate(msg);
      if (result !== null) {
        this.waiters.delete(waiter);
        if (waiter.timeoutHandle) {
          clearTimeout(waiter.timeoutHandle);
        }
        waiter.resolve(result);
      }
    }
  }

  private flushPendingBrowserAutomationResponses(): void {
    if (!this.transport || this.connectionState.status !== "connected") {
      return;
    }
    for (const [requestId, response] of this.pendingBrowserAutomationResponses) {
      const payload = SessionInboundMessageSchema.parse(response);
      try {
        this.transport.send(JSON.stringify({ type: "session", message: payload }));
        this.pendingBrowserAutomationResponses.delete(requestId);
      } catch {
        return;
      }
    }
  }

  private clearWaiters(error: Error): void {
    for (const waiter of Array.from(this.waiters)) {
      if (waiter.timeoutHandle) {
        clearTimeout(waiter.timeoutHandle);
      }
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  private toEvent(msg: SessionOutboundMessage): DaemonEvent | null {
    switch (msg.type) {
      case "agent_update":
        return {
          type: "agent_update",
          agentId: msg.payload.kind === "upsert" ? msg.payload.agent.id : msg.payload.agentId,
          payload: msg.payload,
        };
      case "workspace_update":
        return {
          type: "workspace_update",
          workspaceId: msg.payload.kind === "upsert" ? msg.payload.workspace.id : msg.payload.id,
          payload: msg.payload,
        };
      case "workspace_setup_progress":
        return {
          type: "workspace_setup_progress",
          workspaceId: msg.payload.workspaceId,
          payload: msg.payload,
        };
      case "agent_stream":
        return {
          type: "agent_stream",
          agentId: msg.payload.agentId,
          event: msg.payload.event,
          timestamp: msg.payload.timestamp,
          ...(typeof msg.payload.seq === "number" ? { seq: msg.payload.seq } : {}),
          ...(typeof msg.payload.epoch === "string" ? { epoch: msg.payload.epoch } : {}),
        };
      case "status":
        return { type: "status", payload: msg.payload };
      case "agent_deleted":
        return { type: "agent_deleted", agentId: msg.payload.agentId };
      case "agent_permission_request":
        return {
          type: "agent_permission_request",
          agentId: msg.payload.agentId,
          request: msg.payload.request,
        };
      case "agent_permission_resolved":
        return {
          type: "agent_permission_resolved",
          agentId: msg.payload.agentId,
          requestId: msg.payload.requestId,
          resolution: msg.payload.resolution,
        };
      case "providers_snapshot_update":
        return {
          type: "providers_snapshot_update",
          payload: msg.payload,
        };
      case "agent.thoth.state.update":
        return {
          type: "agent_thoth_state_update",
          payload: msg.payload,
        };
      case "workspace.authority.update":
        return {
          type: "workspace_authority_update",
          workspaceId: msg.payload.workspaceId,
          payload: msg.payload,
        };
      default:
        return null;
    }
  }

  private waitForWithCancel<T>(
    predicate: (msg: SessionOutboundMessage) => T | null,
    timeout = 30000,
    _options?: { skipQueue?: boolean },
  ): WaitHandle<T> {
    // Capture stack trace at call site, not inside setTimeout
    const timeoutError = new Error(`Timeout waiting for message (${timeout}ms)`);

    let waiter: Waiter<T> | null = null;
    let settled = false;
    let rejectFn: ((error: Error) => void) | null = null;

    const promise = new Promise<T>((resolve, reject) => {
      const wrappedResolve = (value: T) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const wrappedReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      rejectFn = wrappedReject;

      const timeoutHandle =
        timeout > 0
          ? setTimeout(() => {
              if (waiter) {
                this.waiters.delete(waiter);
              }
              wrappedReject(timeoutError);
            }, timeout)
          : null;

      waiter = {
        predicate,
        resolve: wrappedResolve,
        reject: wrappedReject,
        timeoutHandle,
      };
      this.waiters.add(waiter);
    });

    const cancel = (error: Error) => {
      if (settled) {
        return;
      }

      if (waiter) {
        this.waiters.delete(waiter);
        if (waiter.timeoutHandle) {
          clearTimeout(waiter.timeoutHandle);
        }
      }

      if (rejectFn) {
        rejectFn(error);
        return;
      }

      // Extremely unlikely: cancel called before the Promise executor ran.
      queueMicrotask(() => {
        if (!settled && rejectFn) {
          rejectFn(error);
        }
      });
    };

    return { promise, cancel };
  }
}

export type DaemonClient = InstanceType<typeof DaemonClientRuntime> & ClientRpcMethods;

type RuntimeClientRpcBinding = {
  clientMethod: string;
  invoke(client: RpcClientInvoker, args: unknown[]): Promise<unknown>;
};

for (const binding of Object.values(clientRpcBindings) as unknown as RuntimeClientRpcBinding[]) {
  if (Object.prototype.hasOwnProperty.call(DaemonClientRuntime.prototype, binding.clientMethod)) {
    throw new Error(`Duplicate DaemonClient RPC method: ${binding.clientMethod}`);
  }
  Object.defineProperty(DaemonClientRuntime.prototype, binding.clientMethod, {
    configurable: false,
    enumerable: false,
    value(this: DaemonClient, ...args: unknown[]) {
      return binding.invoke(this, args);
    },
    writable: false,
  });
}

export const DaemonClient = DaemonClientRuntime as {
  new (...args: ConstructorParameters<typeof DaemonClientRuntime>): DaemonClient;
  readonly prototype: DaemonClient;
};

function resolveAgentConfig(
  options: CreateAgentRequestOptions,
): CreateAgentRequestMessage["config"] {
  const {
    config,
    provider,
    cwd,
    env: _env,
    workspaceId: _workspaceId,
    initialPrompt: _initialPrompt,
    thoth: _thoth,
    images: _images,
    git: _git,
    worktreeName: _worktreeName,
    requestId: _requestId,
    labels: _labels,
    ...overrides
  } = options;

  const baseConfig: Partial<AgentSessionConfig> = {
    ...(provider ? { provider } : {}),
    ...(cwd ? { cwd } : {}),
    ...overrides,
  };

  const merged = config ? { ...baseConfig, ...config } : baseConfig;

  if (!merged.provider || (!merged.cwd && !options.workspaceId)) {
    throw new Error("createAgent requires provider and either workspaceId or cwd");
  }

  return {
    ...merged,
    provider: merged.provider,
    ...(merged.cwd ? { cwd: merged.cwd } : {}),
  };
}
