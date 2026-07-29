import type { Logger } from "pino";

import type {
  HarnessAdapter,
  AgentCreateConfigUnattendedInput,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentProvider,
  AgentRuntimeInfo,
  HarnessThread,
  AgentStreamEvent,
  FetchCatalogOptions,
  ProviderCatalog,
  ResolveAgentCreateConfigInput,
  ResolveAgentCreateConfigResult,
} from "./harness-contract.js";
import {
  isDefaultAgentCreateConfigUnattended,
  isOpenCodeCreateConfigUnattended,
  resolveDefaultAgentCreateConfig,
  resolveOpenCodeCreateConfig,
} from "./create-agent-mode.js";
import { normalizeAgentModelDefinition } from "./harness-contract.js";
import type { ManagedProviderProcessPort, ProviderWorkspacePort } from "../../host/ports.js";
import type {
  AgentProviderRuntimeSettingsMap,
  ProviderOverride,
  ProviderProfileModel,
  ProviderRuntimeSettings,
} from "./provider-launch-config.js";
import {
  AGENT_PROVIDER_DEFINITIONS,
  BUILTIN_PROVIDER_IDS,
  DEV_AGENT_PROVIDER_DEFINITIONS,
  getAgentProviderDefinition,
  type AgentProviderDefinition,
} from "@thoth/protocol/provider-manifest";

function isNonEmptyStringArray(value: string[]): value is [string, ...string[]] {
  return value.length > 0;
}

export type { AgentProviderDefinition };

export { AGENT_PROVIDER_DEFINITIONS, getAgentProviderDefinition };

export interface ProviderManifest extends AgentProviderDefinition {
  enabled: boolean;
  source: "builtin" | "custom";
  /**
   * The id of another *registered* provider this one extends (e.g. a Z.AI
   * profile that extends "claude"). null for built-in providers and for
   * generic ACP providers (which only extend the literal "acp" sentinel).
   */
  derivedFromProviderId: string | null;
  loadAdapter: (logger?: Logger) => Promise<HarnessAdapter>;
  resolveCreateConfig: (input: ResolveAgentCreateConfigInput) => ResolveAgentCreateConfigResult;
  isCreateConfigUnattended: (input: AgentCreateConfigUnattendedInput) => boolean;
  /**
   * Single catalog discovery call used by ProviderSnapshotManager. Should spawn
   * at most one provider runtime process and return both models and modes.
   */
  fetchCatalog: (
    options: FetchCatalogOptions,
    adapter?: HarnessAdapter,
  ) => Promise<ProviderCatalog>;
}

export interface BuildProviderRegistryOptions {
  runtimeSettings?: AgentProviderRuntimeSettingsMap;
  providerOverrides?: Record<string, ProviderOverride>;
  workspaceGitService?: ProviderWorkspacePort;
  managedProcesses?: ManagedProviderProcessPort;
  isDev?: boolean;
}

interface ProviderAdapterFactoryOptions extends Pick<
  BuildProviderRegistryOptions,
  "workspaceGitService" | "managedProcesses"
> {
  providerParams?: unknown;
  customProvider?: {
    id: string;
    label: string;
    extends: string;
  };
}

type ProviderAdapterLoader = (
  logger: Logger,
  runtimeSettings?: ProviderRuntimeSettings,
  options?: ProviderAdapterFactoryOptions,
) => Promise<HarnessAdapter>;

interface ResolvedProvider {
  definition: AgentProviderDefinition;
  runtimeSettings?: ProviderRuntimeSettings;
  profileModels: ProviderProfileModel[];
  additionalModels: ProviderProfileModel[];
  profileModelsAreAdditive: boolean;
  enabled: boolean;
  source: "builtin" | "custom";
  derivedFromProviderId: string | null;
  providerParams?: unknown;
  loadBaseAdapter: (logger: Logger) => Promise<HarnessAdapter>;
  resolveCreateConfig: (input: ResolveAgentCreateConfigInput) => ResolveAgentCreateConfigResult;
  isCreateConfigUnattended: (input: AgentCreateConfigUnattendedInput) => boolean;
}

const PROVIDER_ADAPTER_LOADERS: Record<string, ProviderAdapterLoader> = {
  claude: async (logger, runtimeSettings) => {
    const { ClaudeHarnessAdapter } = await import("./providers/claude/agent.js");
    return new ClaudeHarnessAdapter({ logger, runtimeSettings });
  },
  codex: async (logger, runtimeSettings, options) => {
    const { CodexHarnessAdapter } = await import("./providers/codex-app-server-agent.js");
    return new CodexHarnessAdapter(logger, runtimeSettings, {
      workspaceGitService: options?.workspaceGitService,
      customProvider: options?.customProvider,
    });
  },
  copilot: async (logger, runtimeSettings) => {
    const { CopilotACPHarnessAdapter } = await import("./providers/copilot-acp-agent.js");
    return new CopilotACPHarnessAdapter({ logger, runtimeSettings });
  },
  cursor: async (logger, runtimeSettings) => {
    const { CursorACPHarnessAdapter } = await import("./providers/cursor-acp-agent.js");
    return new CursorACPHarnessAdapter({
      logger,
      command: getCursorACPCommand(runtimeSettings),
      env: runtimeSettings?.env,
    });
  },
  opencode: async (logger, runtimeSettings, options) => {
    const { OpenCodeHarnessAdapter } = await import("./providers/opencode-agent.js");
    return new OpenCodeHarnessAdapter(logger, runtimeSettings, {
      managedProcesses: options?.managedProcesses,
    });
  },
  pi: async (logger, runtimeSettings, options) => {
    const { PiHarnessAdapter } = await import("./providers/pi/agent.js");
    return new PiHarnessAdapter({
      logger,
      runtimeSettings,
      providerParams: options?.providerParams,
      flavor: "pi",
    });
  },
  omp: async (logger, runtimeSettings, options) => {
    const { PiHarnessAdapter } = await import("./providers/pi/agent.js");
    return new PiHarnessAdapter({
      logger,
      runtimeSettings: mergeRuntimeSettings(
        { command: { mode: "replace", argv: ["omp"] } },
        runtimeSettings,
      ),
      providerParams: options?.providerParams ?? { sessionDir: "~/.omp/agent/sessions" },
      commandsRpcType: "get_available_commands",
      flavor: "omp",
    });
  },
  mock: async (logger) => {
    const { MockHarnessAdapter } = await import("./providers/mock-load-test-agent.js");
    return new MockHarnessAdapter(logger);
  },
  "mock-slow": async () => {
    const { MockSlowHarnessAdapter } = await import("./providers/mock-slow-provider.js");
    return new MockSlowHarnessAdapter();
  },
};

function getCursorACPCommand(
  runtimeSettings: ProviderRuntimeSettings | undefined,
): [string, ...string[]] {
  if (
    runtimeSettings?.command?.mode === "replace" &&
    isNonEmptyStringArray(runtimeSettings.command.argv)
  ) {
    return runtimeSettings.command.argv;
  }

  return ["cursor-agent", "acp"];
}

function getProviderAdapterLoader(provider: string): ProviderAdapterLoader {
  const loader = PROVIDER_ADAPTER_LOADERS[provider];
  if (!loader) {
    throw new Error(`No provider adapter loader registered for '${provider}'`);
  }
  return loader;
}

function toRuntimeSettings(override?: ProviderOverride): ProviderRuntimeSettings | undefined {
  if (!override?.command && !override?.env && !override?.disallowedTools) {
    return undefined;
  }

  return {
    command: override.command
      ? {
          mode: "replace",
          argv: override.command,
        }
      : undefined,
    env: override.env,
    disallowedTools: override.disallowedTools,
  };
}

function mergeRuntimeSettings(
  base: ProviderRuntimeSettings | undefined,
  override: ProviderRuntimeSettings | undefined,
): ProviderRuntimeSettings | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    command: override?.command ?? base?.command,
    env:
      base?.env || override?.env
        ? {
            ...base?.env,
            ...override?.env,
          }
        : undefined,
    disallowedTools:
      base?.disallowedTools || override?.disallowedTools
        ? [...(base?.disallowedTools ?? []), ...(override?.disallowedTools ?? [])]
        : undefined,
  };
}

function applyOverrideToDefinition(
  definition: AgentProviderDefinition,
  override?: ProviderOverride,
): AgentProviderDefinition {
  if (!override) {
    return definition;
  }

  return {
    ...definition,
    label: override.label ?? definition.label,
    description: override.description ?? definition.description,
  };
}

function createDerivedDefinition(
  providerId: string,
  baseDefinition: AgentProviderDefinition,
  override: ProviderOverride,
): AgentProviderDefinition {
  if (!override.label) {
    throw new Error(`Custom provider '${providerId}' requires a label`);
  }

  return {
    ...baseDefinition,
    id: providerId,
    label: override.label,
    description: override.description ?? baseDefinition.description,
  };
}

function mapPersistenceHandle(
  provider: AgentProvider,
  handle: AgentPersistenceHandle | null,
): AgentPersistenceHandle | null {
  if (!handle) {
    return null;
  }

  return {
    ...handle,
    provider,
  };
}

function mapRuntimeInfo(provider: AgentProvider, runtimeInfo: AgentRuntimeInfo): AgentRuntimeInfo {
  return {
    ...runtimeInfo,
    provider,
  };
}

function mapStreamEvent(provider: AgentProvider, event: AgentStreamEvent): AgentStreamEvent {
  return {
    ...event,
    provider,
  };
}

function mapModel(
  provider: AgentProvider,
  model: AgentModelDefinition | ProviderProfileModel,
): AgentModelDefinition {
  return normalizeAgentModelDefinition({ ...model, provider });
}

function mergeModels(
  provider: AgentProvider,
  profileModels: ProviderProfileModel[],
  additionalModels: ProviderProfileModel[],
  runtimeModels: AgentModelDefinition[],
  options?: { profileModelsAreAdditive?: boolean },
): AgentModelDefinition[] {
  const baseModels = runtimeModels.map((model) => mapModel(provider, model));
  if (profileModels.length > 0 && options?.profileModelsAreAdditive !== true) {
    return mergeModelAdditions(
      provider,
      profileModels.map((model) => mapModel(provider, model)),
      additionalModels,
    );
  }

  return mergeModelAdditions(provider, baseModels, [...profileModels, ...additionalModels]);
}

function mergeModelAdditions(
  provider: AgentProvider,
  baseModels: AgentModelDefinition[],
  modelAdditions: ProviderProfileModel[],
): AgentModelDefinition[] {
  if (modelAdditions.length === 0) {
    return baseModels;
  }

  const mergedModels = [...baseModels];
  let hasAdditionalDefault = false;

  for (const model of modelAdditions) {
    const additionalModel = mapModel(provider, model);
    hasAdditionalDefault ||= additionalModel.isDefault === true;

    const existingIndex = mergedModels.findIndex((candidate) => candidate.id === model.id);
    if (existingIndex === -1) {
      mergedModels.push(additionalModel);
      continue;
    }

    mergedModels[existingIndex] = {
      ...mergedModels[existingIndex],
      ...additionalModel,
    };
  }

  if (!hasAdditionalDefault) {
    return mergedModels;
  }

  const additionalDefaultIds = new Set(
    modelAdditions.filter((model) => model.isDefault === true).map((model) => model.id),
  );

  return mergedModels.map((model) =>
    additionalDefaultIds.has(model.id) ? model : Object.assign({}, model, { isDefault: false }),
  );
}

export function wrapSessionProvider(provider: AgentProvider, inner: HarnessThread): HarnessThread {
  return {
    provider,
    id: inner.id,
    capabilities: inner.capabilities,
    get features() {
      return inner.features;
    },
    run: (prompt, options) => inner.run(prompt, options),
    startTurn: (prompt, options) => inner.startTurn(prompt, options),
    subscribe: (callback) => inner.subscribe((event) => callback(mapStreamEvent(provider, event))),
    async *streamHistory() {
      for await (const event of inner.streamHistory()) {
        yield mapStreamEvent(provider, event);
      }
    },
    getRuntimeInfo: async () => mapRuntimeInfo(provider, await inner.getRuntimeInfo()),
    getAvailableModes: () => inner.getAvailableModes(),
    getCurrentMode: () => inner.getCurrentMode(),
    setMode: (modeId) => inner.setMode(modeId),
    getPendingPermissions: () => inner.getPendingPermissions(),
    respondToPermission: (requestId, response) => inner.respondToPermission(requestId, response),
    respondToProviderQuestion: inner.respondToProviderQuestion?.bind(inner),
    describePersistence: () => mapPersistenceHandle(provider, inner.describePersistence()),
    interrupt: () => inner.interrupt(),
    close: () => inner.close(),
    listCommands: inner.listCommands?.bind(inner),
    setModel: inner.setModel?.bind(inner),
    setThinkingOption: inner.setThinkingOption?.bind(inner),
    setFeature: inner.setFeature?.bind(inner),
    revertConversation: inner.revertConversation?.bind(inner),
    revertFiles: inner.revertFiles?.bind(inner),
    revertBoth: inner.revertBoth?.bind(inner),
    tryHandleOutOfBand: inner.tryHandleOutOfBand?.bind(inner),
  };
}

function wrapAdapterProvider(
  provider: AgentProvider,
  inner: HarnessAdapter,
  profileModels: ProviderProfileModel[],
  additionalModels: ProviderProfileModel[],
  profileModelsAreAdditive: boolean,
): HarnessAdapter {
  const listImportableSessions = inner.listImportableSessions?.bind(inner);
  const importSession = inner.importSession?.bind(inner);
  const listCommands = inner.listCommands?.bind(inner);
  const listFeatures = inner.listFeatures?.bind(inner);
  const archiveNativeSession = inner.archiveNativeSession?.bind(inner);
  const unarchiveNativeSession = inner.unarchiveNativeSession?.bind(inner);

  return {
    provider,
    capabilities: inner.capabilities,
    harnessCapabilities: inner.harnessCapabilities,
    createSession: async (config, launchContext, options) =>
      wrapSessionProvider(
        provider,
        await inner.createSession(
          {
            ...config,
            provider: inner.provider,
          },
          launchContext,
          options,
        ),
      ),
    resumeSession: async (handle, overrides, launchContext, options) =>
      wrapSessionProvider(
        provider,
        await inner.resumeSession(
          {
            ...handle,
            provider: inner.provider,
          },
          overrides
            ? {
                ...overrides,
                provider: inner.provider,
              }
            : undefined,
          launchContext,
          options,
        ),
      ),
    fetchCatalog: async (options) => {
      const catalog = await inner.fetchCatalog(options);
      return {
        ...catalog,
        models: mergeModels(provider, profileModels, additionalModels, catalog.models, {
          profileModelsAreAdditive,
        }),
        modes: catalog.modes,
      };
    },
    resolveCreateConfig: inner.resolveCreateConfig?.bind(inner),
    isCreateConfigUnattended: inner.isCreateConfigUnattended?.bind(inner),
    listCommands: listCommands
      ? async (config, launchContext) =>
          await listCommands({ ...config, provider: inner.provider }, launchContext)
      : undefined,
    listFeatures: listFeatures
      ? async (config, launchContext) =>
          await listFeatures({ ...config, provider: inner.provider }, launchContext)
      : undefined,
    listImportableSessions: listImportableSessions
      ? async (options) => await listImportableSessions(options)
      : undefined,
    importSession: importSession
      ? async (input, context) => {
          const imported = await importSession(input, {
            ...context,
            config: {
              ...context.config,
              provider: inner.provider,
            },
            storedConfig: {
              ...context.storedConfig,
              provider: inner.provider,
            },
          });
          const persistence = mapPersistenceHandle(provider, imported.persistence);
          if (!persistence) {
            throw new Error(`Provider '${provider}' import did not return persistence`);
          }
          return {
            ...imported,
            session: wrapSessionProvider(provider, imported.session),
            config: {
              ...imported.config,
              provider,
            },
            persistence,
          };
        }
      : undefined,
    archiveNativeSession: archiveNativeSession
      ? async (handle, launchContext) =>
          await archiveNativeSession({ ...handle, provider: inner.provider }, launchContext)
      : undefined,
    unarchiveNativeSession: unarchiveNativeSession
      ? async (handle, launchContext) =>
          await unarchiveNativeSession({ ...handle, provider: inner.provider }, launchContext)
      : undefined,
    isAvailable: () => inner.isAvailable(),
    getDiagnostic: inner.getDiagnostic?.bind(inner),
  };
}

function createRegistryEntry(
  logger: Logger,
  provider: AgentProvider,
  resolved: ResolvedProvider,
): ProviderManifest {
  let loaded: Promise<HarnessAdapter> | null = null;
  const loadAdapter = (providerLogger: Logger = logger): Promise<HarnessAdapter> =>
    (loaded ??= createResolvedProviderAdapter(providerLogger, provider, resolved));
  const hasReplacementModels =
    resolved.profileModels.length > 0 && !resolved.profileModelsAreAdditive;
  const replacementModels = hasReplacementModels
    ? resolved.profileModels.map((model) => mapModel(provider, model))
    : [];

  const decorateModes = (modes: AgentMode[]): AgentMode[] =>
    modes.map((mode) => {
      if (mode.icon && mode.colorTier) return mode;
      const definitionMode = resolved.definition.modes.find((d) => d.id === mode.id);
      if (!definitionMode) return mode;
      return Object.assign({}, mode, {
        icon: mode.icon ?? definitionMode.icon,
        colorTier: mode.colorTier ?? definitionMode.colorTier,
      });
    });

  const hasStaticModes = resolved.definition.modes.length > 0;

  return {
    ...resolved.definition,
    enabled: resolved.enabled,
    source: resolved.source,
    derivedFromProviderId: resolved.derivedFromProviderId,
    loadAdapter,
    resolveCreateConfig: resolved.resolveCreateConfig,
    isCreateConfigUnattended: resolved.isCreateConfigUnattended,
    fetchCatalog: async (options: FetchCatalogOptions, adapter?: HarnessAdapter) => {
      const catalogAdapter = adapter ?? (await loadAdapter());
      if (hasReplacementModels) {
        // Replacement models skip runtime model discovery, but additionalModels
        // must still be merged on top. If modes are dynamic, probe for modes via
        // the single catalog API; otherwise use static/empty modes with no runtime.
        const models = mergeModelAdditions(provider, replacementModels, resolved.additionalModels);
        if (hasStaticModes) {
          return {
            models,
            modes: decorateModes(resolved.definition.modes),
            defaultModeId: resolved.definition.defaultModeId,
          };
        }
        const catalog = await catalogAdapter.fetchCatalog(options);
        return {
          ...catalog,
          models,
          modes: decorateModes(catalog.modes),
          defaultModeId: catalog.defaultModeId ?? resolved.definition.defaultModeId,
        };
      }

      const catalog = await catalogAdapter.fetchCatalog(options);
      return {
        ...catalog,
        models: mergeModels(
          provider,
          resolved.profileModels,
          resolved.additionalModels,
          catalog.models,
          {
            profileModelsAreAdditive: resolved.profileModelsAreAdditive,
          },
        ),
        modes: decorateModes(catalog.modes),
        defaultModeId: catalog.defaultModeId ?? resolved.definition.defaultModeId,
      };
    },
  };
}

async function createResolvedProviderAdapter(
  logger: Logger,
  provider: AgentProvider,
  resolved: ResolvedProvider,
): Promise<HarnessAdapter> {
  const inner = await resolved.loadBaseAdapter(logger);
  const hasModelOverrides =
    resolved.profileModels.length > 0 || resolved.additionalModels.length > 0;
  if (inner.provider === provider && !hasModelOverrides) {
    return inner;
  }
  return wrapAdapterProvider(
    provider,
    inner,
    resolved.profileModels,
    resolved.additionalModels,
    resolved.profileModelsAreAdditive,
  );
}

function buildResolvedBuiltinProviders(
  providerOverrides: Record<string, ProviderOverride>,
  runtimeSettings: AgentProviderRuntimeSettingsMap | undefined,
  options: Pick<BuildProviderRegistryOptions, "workspaceGitService" | "managedProcesses">,
  isDev: boolean,
): Map<string, ResolvedProvider> {
  const resolvedProviders = new Map<string, ResolvedProvider>();

  const definitions = isDev
    ? [...AGENT_PROVIDER_DEFINITIONS, ...DEV_AGENT_PROVIDER_DEFINITIONS]
    : AGENT_PROVIDER_DEFINITIONS;

  for (const definition of definitions) {
    const override = providerOverrides[definition.id];
    const loader = getProviderAdapterLoader(definition.id);
    const mergedRuntimeSettings = mergeRuntimeSettings(
      runtimeSettings?.[definition.id],
      toRuntimeSettings(override),
    );

    resolvedProviders.set(definition.id, {
      definition: applyOverrideToDefinition(definition, override),
      runtimeSettings: mergedRuntimeSettings,
      profileModels: override?.models ?? [],
      additionalModels: override?.additionalModels ?? [],
      profileModelsAreAdditive: false,
      enabled: override?.enabled ?? definition.enabledByDefault ?? true,
      source: "builtin",
      derivedFromProviderId: null,
      providerParams: override?.params,
      loadBaseAdapter: (logger) =>
        loader(logger, mergedRuntimeSettings, {
          workspaceGitService: options.workspaceGitService,
          managedProcesses: options.managedProcesses,
          providerParams: override?.params,
        }),
      resolveCreateConfig:
        definition.id === "opencode"
          ? resolveOpenCodeCreateConfig
          : resolveDefaultAgentCreateConfig,
      isCreateConfigUnattended:
        definition.id === "opencode"
          ? isOpenCodeCreateConfigUnattended
          : isDefaultAgentCreateConfigUnattended,
    });
  }

  return resolvedProviders;
}

function addDerivedProviders(
  resolvedProviders: Map<string, ResolvedProvider>,
  providerOverrides: Record<string, ProviderOverride>,
  options: Pick<BuildProviderRegistryOptions, "managedProcesses">,
): void {
  for (const [providerId, override] of Object.entries(providerOverrides)) {
    if (resolvedProviders.has(providerId) || BUILTIN_PROVIDER_IDS.includes(providerId)) {
      continue;
    }

    if (!override.extends) {
      throw new Error(`Custom provider '${providerId}' requires an extends value`);
    }

    if (override.extends === "acp") {
      if (!override.command || !isNonEmptyStringArray(override.command)) {
        throw new Error(`ACP provider '${providerId}' requires a command`);
      }
      // Capture command in const for closure - TypeScript can't track type refinement inside closures
      const command = override.command;

      resolvedProviders.set(providerId, {
        definition: createDerivedDefinition(
          providerId,
          {
            id: providerId,
            label: override.label ?? providerId,
            description: override.description ?? "Custom ACP provider",
            defaultModeId: null,
            modes: [],
          },
          override,
        ),
        runtimeSettings: toRuntimeSettings(override),
        profileModels: override.models ?? [],
        additionalModels: override.additionalModels ?? [],
        profileModelsAreAdditive: false,
        enabled: override.enabled !== false,
        source: "custom",
        derivedFromProviderId: null,
        providerParams: override.params,
        loadBaseAdapter: async (logger) => {
          const options = {
            logger,
            command,
            env: override.env,
            providerId,
            label: override.label ?? providerId,
            providerParams: override.params,
          };
          if (providerId === "cursor") {
            const { CursorACPHarnessAdapter } = await import("./providers/cursor-acp-agent.js");
            return new CursorACPHarnessAdapter(options);
          }
          const { GenericACPHarnessAdapter } = await import("./providers/generic-acp-agent.js");
          return new GenericACPHarnessAdapter(options);
        },
        resolveCreateConfig: resolveDefaultAgentCreateConfig,
        isCreateConfigUnattended: isDefaultAgentCreateConfigUnattended,
      });
      continue;
    }

    const baseProviderId = override.extends;
    const baseProvider = resolvedProviders.get(baseProviderId);
    if (!baseProvider) {
      throw new Error(
        `Custom provider '${providerId}' extends unknown provider '${baseProviderId}'`,
      );
    }

    const mergedRuntimeSettings = mergeRuntimeSettings(
      baseProvider.runtimeSettings,
      toRuntimeSettings(override),
    );
    const baseDefinition = baseProvider.definition;
    const baseLoader = getProviderAdapterLoader(baseProviderId);
    const providerParams = override.params ?? baseProvider.providerParams;

    resolvedProviders.set(providerId, {
      definition: createDerivedDefinition(providerId, baseDefinition, override),
      runtimeSettings: mergedRuntimeSettings,
      profileModels: override.models ?? [],
      additionalModels: override.additionalModels ?? [],
      profileModelsAreAdditive: false,
      enabled: override.enabled !== false,
      source: "custom",
      derivedFromProviderId: baseProviderId,
      providerParams,
      loadBaseAdapter: (logger) =>
        baseLoader(logger, mergedRuntimeSettings, {
          managedProcesses: options.managedProcesses,
          providerParams,
          customProvider: {
            id: providerId,
            label: override.label ?? providerId,
            extends: baseProviderId,
          },
        }),
      resolveCreateConfig: baseProvider.resolveCreateConfig,
      isCreateConfigUnattended: baseProvider.isCreateConfigUnattended,
    });
  }
}

export function buildProviderRegistry(
  logger: Logger,
  options?: BuildProviderRegistryOptions,
): Record<AgentProvider, ProviderManifest> {
  const runtimeSettings = options?.runtimeSettings;
  const providerOverrides = options?.providerOverrides ?? {};
  const resolvedProviders = buildResolvedBuiltinProviders(
    providerOverrides,
    runtimeSettings,
    {
      workspaceGitService: options?.workspaceGitService,
      managedProcesses: options?.managedProcesses,
    },
    options?.isDev === true,
  );
  addDerivedProviders(resolvedProviders, providerOverrides, {
    managedProcesses: options?.managedProcesses,
  });

  return Object.fromEntries(
    [...resolvedProviders.entries()].map(([provider, resolved]) => [
      provider,
      createRegistryEntry(logger, provider, resolved),
    ]),
  ) as Record<AgentProvider, ProviderManifest>;
}

export function getProviderIds(registry: Record<AgentProvider, ProviderManifest>): AgentProvider[] {
  return Object.keys(registry);
}

export async function shutdownHarnessAdapters(
  adapters: Iterable<HarnessAdapter>,
  logger: Logger,
): Promise<void> {
  await Promise.all(
    Array.from(adapters).map(async (adapter) => {
      if (!adapter.shutdown) return;
      try {
        await adapter.shutdown();
      } catch (error) {
        logger.warn({ err: error, provider: adapter.provider }, "Provider adapter shutdown failed");
      }
    }),
  );
}
