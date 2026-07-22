import type { AgentFeature, AgentFeatureToggle } from "../agent-sdk-types.js";

const CODEX_FAST_MODE_SUPPORTED_MODEL_PREFIXES = ["gpt-5", "gpt-4.1", "o3", "o4-mini"] as const;

export const CODEX_FAST_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "fast_mode",
  label: "Fast",
  description: "Priority inference at 2x usage",
  tooltip: "Toggle fast mode",
  icon: "zap",
};

function normalizeCodexModelId(modelId: string | null | undefined): string | null {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

export function codexModelSupportsFastMode(modelId: string | null | undefined): boolean {
  const normalizedModelId = normalizeCodexModelId(modelId);
  if (!normalizedModelId) {
    return false;
  }
  return CODEX_FAST_MODE_SUPPORTED_MODEL_PREFIXES.some(
    (prefix) => normalizedModelId === prefix || normalizedModelId.startsWith(prefix),
  );
}

export function buildCodexFeatures(input: {
  modelId: string | null | undefined;
  fastModeEnabled: boolean;
}): AgentFeature[] {
  const features: AgentFeature[] = [];

  if (codexModelSupportsFastMode(input.modelId)) {
    features.push({
      ...CODEX_FAST_MODE_FEATURE,
      value: input.fastModeEnabled,
    });
  }

  return features;
}
