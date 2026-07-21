// CLI exports for @thoth/daemon
export { createThothDaemon, type ThothDaemon, type ThothDaemonConfig } from "./bootstrap.js";
export { loadConfig, type CliConfigOverrides } from "./config.js";
export { resolveThothHome } from "./thoth-home.js";
export { getOrCreateServerId } from "./server-id.js";
export { createRootLogger, type LogLevel, type LogFormat } from "./logger.js";
export {
  loadPersistedConfig,
  savePersistedConfig,
  type PersistedConfig,
} from "./persisted-config.js";
export { hashDaemonPassword, isBearerTokenValid } from "./auth.js";
export { generateLocalPairingOffer, type LocalPairingOffer } from "./pairing-offer.js";
export {
  ConnectionOfferSchema,
  decodeOfferFragmentPayload,
  parseConnectionOfferFromUrl,
  type ConnectionOffer,
} from "@thoth/protocol/connection-offer";
export { buildRelayWebSocketUrl } from "@thoth/protocol/daemon-endpoints";
export {
  buildDaemonWebSocketUrl,
  deriveLabelFromEndpoint,
  normalizeHostPort,
  parseConnectionUri,
  shouldUseTlsForDefaultHostedRelay,
} from "@thoth/protocol/daemon-endpoints";
export { PARENT_AGENT_ID_LABEL } from "@thoth/protocol/agent-labels";
export {
  DirectTcpHostConnectionSchema,
  type DirectTcpHostConnection,
  type NormalizedDirectTcpHostConnection,
} from "@thoth/protocol/host-connection-schema";
// Provider binary resolution
export {
  type ProviderOverride,
  type ProviderProfileModel,
} from "@thoth/drivers/internal/server/agent/provider-launch-config";
export { findExecutable } from "@thoth/drivers/internal/executable-resolution/executable-resolution";
export { execCommand, spawnProcess } from "@thoth/drivers/internal/utils/spawn";

// Provider manifest (source of truth for provider definitions)
export {
  AGENT_PROVIDER_DEFINITIONS,
  BUILTIN_PROVIDER_IDS,
  type AgentProviderDefinition,
} from "@thoth/protocol/provider-manifest";

// Agent SDK types for CLI commands
export type {
  AgentMode,
  AgentUsage,
  AgentCapabilityFlags,
  AgentPermissionRequest,
  AgentTimelineItem,
  ProviderSnapshotEntry,
} from "@thoth/drivers/agent-runtime";

// Agent activity curator for CLI logs
export { curateAgentActivity } from "@thoth/drivers/internal/server/agent/activity-curator";
export {
  getStructuredAgentResponse,
  StructuredAgentResponseError,
  StructuredAgentFallbackError,
  DEFAULT_STRUCTURED_GENERATION_PROVIDERS,
  generateStructuredAgentResponseWithFallback,
  type AgentCaller,
  type JsonSchema,
  type StructuredGenerationAttempt,
  type StructuredGenerationProvider,
  type StructuredAgentGenerationOptions,
  type StructuredAgentGenerationWithFallbackOptions,
  type StructuredAgentResponseOptions,
} from "./agent/agent-response-loop.js";

// WebSocket message types for CLI streaming
export type {
  AgentSnapshotPayload,
  AgentStreamEventPayload,
  AgentStreamMessage,
} from "@thoth/protocol/messages";
