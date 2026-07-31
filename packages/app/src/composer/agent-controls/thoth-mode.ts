import type { ThothRuntimeLoopStrength } from "@thoth/protocol/thoth-runtime-contract";
import type { ThothTurnSnapshot } from "@thoth/protocol/messages";

type ThothModeConfig = {
  enabled?: boolean;
  mode?: string;
  clarifyStrength?: string;
  loopStrength?: string;
};

export function isThothModeEnabled(config: ThothModeConfig | null | undefined): boolean {
  if (config?.enabled !== undefined) {
    return config.enabled;
  }

  // Configs written before the explicit switch existed already represent a deliberate
  // Thoth choice when they carry a structured Clarify or Loop value. Empty legacy
  // config is the new product default: raw provider conversation.
  return (
    config?.mode === "loop" ||
    config?.clarifyStrength === "auto" ||
    config?.clarifyStrength === "light" ||
    config?.clarifyStrength === "balanced" ||
    config?.clarifyStrength === "dive"
  );
}

export function resolveThothLoopStrength(value: unknown): ThothRuntimeLoopStrength {
  return value === "one_plan_one_do" ||
    value === "light" ||
    value === "balanced" ||
    value === "run_until_stopped"
    ? value
    : "one_plan_one_do";
}

export function buildThothTurnSnapshot(
  config: ThothModeConfig | null | undefined,
): ThothTurnSnapshot {
  if (!isThothModeEnabled(config)) {
    return { enabled: false };
  }
  return config?.mode === "loop"
    ? {
        enabled: true,
        executionMode: "loop",
        clarifyStrength: "auto",
        loopStrength: resolveThothLoopStrength(config.loopStrength),
      }
    : {
        enabled: true,
        executionMode: "quick",
        clarifyStrength: "auto",
      };
}
