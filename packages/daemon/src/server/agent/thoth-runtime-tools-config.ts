import type { AgentMetadata } from "@thoth/drivers/agent-runtime";

export type ThothRuntimeToolScope =
  | "clarify"
  | "clarify_audit"
  | "contract_audit"
  | "loop_planexec"
  | "loop_review";

export interface ThothRuntimeToolsConfig {
  enabled: true;
  scope: ThothRuntimeToolScope;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readThothRuntimeToolsConfig(config: {
  extra?: unknown | null;
}): ThothRuntimeToolsConfig | null {
  const runtime = readRecord(readRecord(config.extra)?.thothRuntimeTools);
  if (runtime?.enabled !== true || typeof runtime.scope !== "string") {
    return null;
  }
  const scopes: readonly ThothRuntimeToolScope[] = [
    "clarify",
    "clarify_audit",
    "contract_audit",
    "loop_planexec",
    "loop_review",
  ];
  return scopes.includes(runtime.scope as ThothRuntimeToolScope)
    ? { enabled: true, scope: runtime.scope as ThothRuntimeToolScope }
    : null;
}

export function withThothRuntimeTools<T>(
  config: T & { extra?: AgentMetadata | null },
  runtime: ThothRuntimeToolsConfig,
): Omit<T, "extra"> & { extra: AgentMetadata } {
  return {
    ...config,
    extra: {
      ...(config.extra ?? {}),
      thothRuntimeTools: {
        enabled: true,
        scope: runtime.scope,
      },
    },
  };
}
