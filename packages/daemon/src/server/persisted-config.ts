import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  AgentProviderRuntimeSettingsMapSchema,
  migrateProviderSettings,
  ProviderOverridesSchema,
} from "@thoth/drivers/internal/server/agent/provider-launch-config";
import type { AgentProviderRuntimeSettingsMap } from "@thoth/drivers/internal/server/agent/provider-launch-config";
import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";
import { TerminalProfileSchema } from "@thoth/protocol/messages";
import { DEFAULT_DIRECT_DAEMON_ENDPOINT } from "@thoth/protocol/daemon-endpoints";

export const LogLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);
export const LogFormatSchema = z.enum(["pretty", "json"]);

const LogConfigSchema = z
  .object({
    // Legacy global log settings (kept for backwards compatibility).
    level: LogLevelSchema.optional(),
    format: LogFormatSchema.optional(),

    console: z
      .object({
        level: LogLevelSchema.optional(),
        format: LogFormatSchema.optional(),
      })
      .strict()
      .optional(),

    file: z
      .object({
        level: LogLevelSchema.optional(),
        path: z.string().min(1).optional(),
        rotate: z
          .object({
            maxSize: z.string().min(1).optional(),
            maxFiles: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const WorktreesConfigSchema = z
  .object({
    root: z.string().min(1).optional(),
  })
  .strict();

const BcryptHashSchema = z.string().regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, {
  message: "Expected a bcrypt hash",
});

const DaemonAuthSchema = z
  .object({
    password: BcryptHashSchema.optional(),
  })
  .strict();

const FeatureWebUiSchema = z
  .object({
    enabled: z.boolean().optional(),
    distDir: z.string().min(1).optional(),
  })
  .strict();

const StructuredGenerationProviderConfigSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    thinkingOptionId: z.string().min(1).optional(),
  })
  .strict();

const ThothConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(["quick", "loop"]).optional(),
    clarifyStrength: z.enum(["none", "auto", "light", "balanced", "dive"]).optional(),
    loopStrength: z
      .enum(["auto", "one_plan_one_do", "light", "balanced", "run_until_stopped"])
      .optional(),
    selectedBackgroundTaskId: z.string().min(1).nullable().optional(),
  })
  .strict();

const ProviderControlConfigSchema = z
  .object({
    runMode: z.enum(["default", "plan"]).optional(),
  })
  .strict();

const AgentMetadataGenerationSchema = z
  .object({
    providers: z.array(StructuredGenerationProviderConfigSchema).optional(),
  })
  .strict();

const BUILTIN_PROVIDER_IDS = ["claude", "codex", "copilot", "opencode", "pi", "omp"] as const;

function isLegacyProviderEntry(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const command = (value as Record<string, unknown>).command;
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return false;
  }

  return typeof (command as Record<string, unknown>).mode === "string";
}

function normalizeAgentProviders(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const rawProviders = value as Record<string, unknown>;
  const hasLegacyEntries = Object.values(rawProviders).some((entry) =>
    isLegacyProviderEntry(entry),
  );
  if (!hasLegacyEntries) {
    return value;
  }

  const legacyEntries: Record<string, unknown> = {};
  const normalizedEntries: Record<string, unknown> = {};

  for (const [providerId, providerValue] of Object.entries(rawProviders)) {
    if (isLegacyProviderEntry(providerValue)) {
      legacyEntries[providerId] = providerValue;
      continue;
    }
    normalizedEntries[providerId] = providerValue;
  }

  const parsedLegacyEntries = AgentProviderRuntimeSettingsMapSchema.safeParse(legacyEntries);
  if (!parsedLegacyEntries.success) {
    return value;
  }

  return {
    ...normalizedEntries,
    ...migrateProviderSettings(parsedLegacyEntries.data, [...BUILTIN_PROVIDER_IDS]),
  };
}

export const PersistedConfigSchema = z
  .object({
    $schema: z.string().optional(),

    // v1 schema marker
    version: z.literal(1).optional(),

    // v1 config layout
    daemon: z
      .object({
        listen: z.string().optional(),
        hostnames: z.union([z.literal(true), z.array(z.string())]).optional(),
        allowedHosts: z.union([z.literal(true), z.array(z.string())]).optional(),
        trustedProxies: z.union([z.literal(true), z.array(z.string())]).optional(),
        mcp: z
          .object({
            enabled: z.boolean().optional(),
            injectIntoAgents: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
        autoArchiveAfterMerge: z.boolean().optional(),
        enableTerminalAgentHooks: z.boolean().optional(),
        appendSystemPrompt: z.string().optional(),
        terminalProfiles: z.array(TerminalProfileSchema).optional(),
        cors: z
          .object({
            allowedOrigins: z.array(z.string()).optional(),
          })
          .strict()
          .optional(),
        relay: z
          .object({
            enabled: z.boolean().optional(),
            endpoint: z.string().optional(),
            publicEndpoint: z.string().optional(),
            useTls: z.boolean().optional(),
            publicUseTls: z.boolean().optional(),
          })
          .strict()
          .optional(),
        serviceProxy: z
          .object({
            // COMPAT(serviceProxyEnabled): added 2026-06-02, remove after 2026-12-02.
            // Parsed only to suppress optional public/listen layers for old configs;
            // localhost service proxying remains always enabled.
            enabled: z.boolean().optional(),
            listen: z.string().optional(),
            publicBaseUrl: z.url().optional(),
          })
          .strict()
          .optional(),
        auth: DaemonAuthSchema.optional(),
      })
      .strict()
      .transform(({ allowedHosts, ...daemon }) => {
        const hostnames = daemon.hostnames ?? allowedHosts;
        return hostnames === undefined ? daemon : { ...daemon, hostnames };
      })
      .optional(),

    app: z
      .object({
        baseUrl: z.string().optional(),
      })
      .strict()
      .optional(),

    thoth: ThothConfigSchema.optional(),
    providerControl: ProviderControlConfigSchema.optional(),
    worktrees: WorktreesConfigSchema.optional(),
    agents: z
      .object({
        providers: z.preprocess(normalizeAgentProviders, ProviderOverridesSchema).optional(),
        metadataGeneration: AgentMetadataGenerationSchema.optional(),
      })
      .strict()
      .optional(),
    features: z
      .object({
        webUi: FeatureWebUiSchema.optional(),
      })
      .strict()
      .optional(),

    log: LogConfigSchema.optional(),
  })
  .strict();

type PersistedConfigSchemaOutput = z.infer<typeof PersistedConfigSchema>;

export type PersistedConfig = Omit<PersistedConfigSchemaOutput, "agents"> & {
  agents?: Omit<NonNullable<PersistedConfigSchemaOutput["agents"]>, "providers"> & {
    providers?: AgentProviderRuntimeSettingsMap;
  };
};

const CONFIG_FILENAME = "config.json";
const DEFAULT_PERSISTED_CONFIG = PersistedConfigSchema.parse({
  version: 1,
  daemon: {
    listen: DEFAULT_DIRECT_DAEMON_ENDPOINT,
    cors: {
      allowedOrigins: ["https://app.thoth.seeles.ai"],
    },
    relay: {
      enabled: true,
    },
  },
  app: {
    baseUrl: "https://app.thoth.seeles.ai",
  },
}) as PersistedConfig;

interface LoggerLike {
  child(bindings: Record<string, unknown>): LoggerLike;
  info(...args: unknown[]): void;
}

function getConfigPath(thothHome: string): string {
  return path.join(thothHome, CONFIG_FILENAME);
}

function getLogger(logger: LoggerLike | undefined): LoggerLike | undefined {
  return logger?.child({ module: "config" });
}

function stripRemovedVoiceConfig(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }

  const root = { ...(parsed as Record<string, unknown>) };
  delete root.providers;
  const features = root.features;
  if (features && typeof features === "object" && !Array.isArray(features)) {
    const nextFeatures = { ...(features as Record<string, unknown>) };
    delete nextFeatures.dictation;
    delete nextFeatures.voiceMode;
    root.features = nextFeatures;
  }
  return root;
}

function stripRemovedWorkspaceSecretaryConfig(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  const root = { ...(parsed as Record<string, unknown>) };
  delete root.workspaceSecretary;
  return root;
}

export function loadPersistedConfig(thothHome: string, logger?: LoggerLike): PersistedConfig {
  const log = getLogger(logger);
  const configPath = getConfigPath(thothHome);

  if (!existsSync(configPath)) {
    try {
      writePrivateFileAtomicSync(
        configPath,
        JSON.stringify(DEFAULT_PERSISTED_CONFIG, null, 2) + "\n",
      );
      log?.info(`Initialized config file at ${configPath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[Config] Failed to initialize ${configPath}: ${message}`, { cause: err });
    }
  }

  let raw: string;
  try {
    ensurePrivateFile(configPath);
    raw = readFileSync(configPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Config] Failed to read ${configPath}: ${message}`, {
      cause: err,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Config] Invalid JSON in ${configPath}: ${message}`, {
      cause: err,
    });
  }

  const migrated = stripRemovedVoiceConfig(stripRemovedWorkspaceSecretaryConfig(parsed));
  const result = PersistedConfigSchema.safeParse(migrated);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[Config] Invalid config in ${configPath}:\n${issues}`);
  }

  log?.info(`Loaded from ${configPath}`);
  return result.data as PersistedConfig;
}

export function savePersistedConfig(
  thothHome: string,
  config: PersistedConfig,
  logger?: LoggerLike,
): void {
  const log = getLogger(logger);
  const configPath = getConfigPath(thothHome);

  const result = PersistedConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[Config] Invalid config to save:\n${issues}`);
  }

  try {
    writePrivateFileAtomicSync(configPath, JSON.stringify(result.data, null, 2) + "\n");
    log?.info(`Saved to ${configPath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Config] Failed to write ${configPath}: ${message}`, {
      cause: err,
    });
  }
}
