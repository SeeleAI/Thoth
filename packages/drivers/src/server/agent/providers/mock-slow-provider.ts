import type {
  AgentCapabilityFlags,
  HarnessAdapter,
  AgentLaunchContext,
  AgentPersistenceHandle,
  AgentProvider,
  HarnessThread,
  AgentSessionConfig,
  FetchCatalogOptions,
  ProviderCatalog,
} from "../harness-contract.js";
import { NO_HARNESS_CAPABILITIES } from "@thoth/drivers/harness";

export const MOCK_SLOW_PROVIDER_ID = "mock-slow";

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

export class MockSlowHarnessAdapter implements HarnessAdapter {
  readonly provider: AgentProvider = MOCK_SLOW_PROVIDER_ID;
  readonly capabilities = CAPABILITIES;
  readonly harnessCapabilities = NO_HARNESS_CAPABILITIES;

  async isAvailable(): Promise<boolean> {
    return process.env.THOTH_ENABLE_MOCK_SLOW === "true";
  }

  async fetchCatalog(_options: FetchCatalogOptions): Promise<ProviderCatalog> {
    return neverResolves<ProviderCatalog>();
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    return {
      diagnostic:
        "Mock slow provider: dev-only. fetchCatalog() never resolves so the snapshot manager will time out.",
    };
  }

  createSession(
    _config: AgentSessionConfig,
    _launchContext?: AgentLaunchContext,
  ): Promise<HarnessThread> {
    throw new Error("Mock slow provider is dev-only; sessions are not supported.");
  }

  resumeSession(
    _handle: AgentPersistenceHandle,
    _overrides?: Partial<AgentSessionConfig>,
    _launchContext?: AgentLaunchContext,
  ): Promise<HarnessThread> {
    throw new Error("Mock slow provider is dev-only; sessions are not supported.");
  }
}
