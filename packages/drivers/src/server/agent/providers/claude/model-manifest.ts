import type { AgentModelDefinition, AgentSelectOption } from "../../harness-contract.js";

type ClaudeEffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

interface ClaudeModelManifestEntry {
  id: string;
  label: string;
  description: string;
  defaultPriority?: number;
  minimumClaudeCodeVersion?: string;
  contextWindowMaxTokens: number;
  effortLevels?: readonly ClaudeEffortLevel[];
  supportsThinkingDisabled?: boolean;
}

const EFFORT_LEVELS = {
  standard: ["low", "medium", "high", "max"],
  xhigh: ["low", "medium", "high", "xhigh", "max"],
} as const satisfies Record<string, readonly ClaudeEffortLevel[]>;

const EFFORT_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
} as const satisfies Record<ClaudeEffortLevel, string>;

const DISABLED_THINKING_OPTION_ID = "off";
const ULTRACODE_THINKING_OPTION_ID = "ultracode";

export const CLAUDE_MODEL_MANIFEST: readonly ClaudeModelManifestEntry[] = [
  {
    id: "claude-opus-5[1m]",
    label: "Opus 5 1M",
    description: "Opus 5 with 1M context window",
    defaultPriority: 2,
    minimumClaudeCodeVersion: "2.1.219",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: EFFORT_LEVELS.xhigh,
    supportsThinkingDisabled: true,
  },
  {
    id: "claude-opus-5",
    label: "Opus 5",
    description: "Opus 5 · 200K context window",
    minimumClaudeCodeVersion: "2.1.219",
    contextWindowMaxTokens: 200_000,
    effortLevels: EFFORT_LEVELS.xhigh,
    supportsThinkingDisabled: true,
  },
  {
    id: "claude-fable-5[1m]",
    label: "Fable 5 1M",
    description: "Fable 5 with 1M context window",
    minimumClaudeCodeVersion: "2.1.169",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: EFFORT_LEVELS.xhigh,
  },
  {
    id: "claude-fable-5",
    label: "Fable 5",
    description: "Fable 5 · Most powerful model",
    minimumClaudeCodeVersion: "2.1.169",
    contextWindowMaxTokens: 200_000,
    effortLevels: EFFORT_LEVELS.xhigh,
  },
  {
    id: "claude-opus-4-8[1m]",
    label: "Opus 4.8 1M",
    description: "Opus 4.8 with 1M context window",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: EFFORT_LEVELS.xhigh,
    supportsThinkingDisabled: true,
  },
  {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    description: "Opus 4.8 · Previous release",
    defaultPriority: 1,
    contextWindowMaxTokens: 200_000,
    effortLevels: EFFORT_LEVELS.xhigh,
    supportsThinkingDisabled: true,
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    description: "Sonnet 5 · Best for everyday tasks",
    contextWindowMaxTokens: 200_000,
    effortLevels: EFFORT_LEVELS.xhigh,
    supportsThinkingDisabled: true,
  },
  {
    id: "claude-sonnet-5[1m]",
    label: "Sonnet 5 1M",
    description: "Sonnet 5 with 1M context window",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: EFFORT_LEVELS.xhigh,
    supportsThinkingDisabled: true,
  },
  {
    id: "claude-opus-4-7[1m]",
    label: "Opus 4.7 1M",
    description: "Opus 4.7 with 1M context window",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: EFFORT_LEVELS.xhigh,
    supportsThinkingDisabled: true,
  },
  {
    id: "claude-opus-4-7",
    label: "Opus 4.7",
    description: "Opus 4.7 · Previous release",
    contextWindowMaxTokens: 200_000,
    effortLevels: EFFORT_LEVELS.xhigh,
    supportsThinkingDisabled: true,
  },
  {
    id: "claude-opus-4-6[1m]",
    label: "Opus 4.6 1M",
    description: "Opus 4.6 with 1M context window",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: EFFORT_LEVELS.standard,
    supportsThinkingDisabled: true,
  },
  {
    id: "claude-opus-4-6",
    label: "Opus 4.6",
    description: "Opus 4.6 · Most capable for complex work",
    contextWindowMaxTokens: 200_000,
    effortLevels: EFFORT_LEVELS.standard,
    supportsThinkingDisabled: true,
  },
  {
    id: "claude-sonnet-4-6[1m]",
    label: "Sonnet 4.6 1M",
    description: "Sonnet 4.6 with 1M context window",
    contextWindowMaxTokens: 1_000_000,
    effortLevels: EFFORT_LEVELS.standard,
    supportsThinkingDisabled: true,
  },
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    description: "Sonnet 4.6 · Best for everyday tasks",
    contextWindowMaxTokens: 200_000,
    effortLevels: EFFORT_LEVELS.standard,
    supportsThinkingDisabled: true,
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    description: "Haiku 4.5 · Fastest for quick answers",
    contextWindowMaxTokens: 200_000,
  },
] as const;

export function getClaudeManifestModels(claudeCodeVersion?: string): AgentModelDefinition[] {
  const available = CLAUDE_MODEL_MANIFEST.filter((model) =>
    isModelAvailableInClaudeCode(model, claudeCodeVersion),
  );
  const defaultModel = available.reduce<ClaudeModelManifestEntry | undefined>(
    (selected, candidate) =>
      (candidate.defaultPriority ?? 0) > (selected?.defaultPriority ?? 0) ? candidate : selected,
    undefined,
  );

  return available.map((model) => ({
    provider: "claude",
    id: model.id,
    label: model.label,
    description: model.description,
    ...(model === defaultModel ? { isDefault: true } : {}),
    contextWindowMaxTokens: model.contextWindowMaxTokens,
    ...(model.effortLevels
      ? {
          thinkingOptions: buildThinkingOptions(
            model.effortLevels,
            model.supportsThinkingDisabled === true,
          ),
          defaultThinkingOptionId: model.effortLevels[0],
        }
      : {}),
  }));
}

function buildThinkingOptions(
  effortLevels: readonly ClaudeEffortLevel[],
  supportsThinkingDisabled: boolean,
): AgentSelectOption[] {
  return [
    ...(supportsThinkingDisabled ? [{ id: DISABLED_THINKING_OPTION_ID, label: "Off" }] : []),
    ...effortLevels.map((id) => ({ id, label: EFFORT_LABELS[id] })),
    ...(effortLevels.includes("xhigh")
      ? [{ id: ULTRACODE_THINKING_OPTION_ID, label: "Ultra Code" }]
      : []),
  ];
}

function isModelAvailableInClaudeCode(
  model: ClaudeModelManifestEntry,
  claudeCodeVersion: string | undefined,
): boolean {
  return (
    !model.minimumClaudeCodeVersion ||
    claudeCodeVersion === undefined ||
    compareVersions(claudeCodeVersion, model.minimumClaudeCodeVersion) >= 0
  );
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseClaudeCodeVersion(left);
  const rightParts = parseClaudeCodeVersion(right);
  if (!leftParts || !rightParts) return -1;
  for (let index = 0; index < leftParts.length; index++) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export function parseClaudeCodeVersion(value: string): [number, number, number] | null {
  const match =
    value.match(/\b(\d+)\.(\d+)\.(\d+)\s+\(Claude Code\)/i) ??
    value.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function normalizeClaudeRuntimeModelId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  if (CLAUDE_MODEL_MANIFEST.some((model) => model.id === trimmed)) return trimmed;

  const majorMinor = trimmed.match(
    /claude[-_ ](opus|sonnet|haiku)[-_ ]+(\d+)[-.](\d{1,2})(?=\D|$)/i,
  );
  if (majorMinor) {
    const suffix = trimmed.toLowerCase().includes("[1m]") ? "[1m]" : "";
    const normalized = `claude-${majorMinor[1].toLowerCase()}-${majorMinor[2]}-${majorMinor[3]}${suffix}`;
    return CLAUDE_MODEL_MANIFEST.some((model) => model.id === normalized) ? normalized : null;
  }

  const singleSegment = trimmed.match(/claude[-_ ](fable|opus|sonnet|haiku)[-_ ]+(\d+)/i);
  if (!singleSegment) return null;
  const suffix = trimmed.toLowerCase().includes("[1m]") ? "[1m]" : "";
  const preferred = `claude-${singleSegment[1].toLowerCase()}-${singleSegment[2]}${suffix}`;
  const fallback = `claude-${singleSegment[1].toLowerCase()}-${singleSegment[2]}`;
  return CLAUDE_MODEL_MANIFEST.some((model) => model.id === preferred)
    ? preferred
    : CLAUDE_MODEL_MANIFEST.some((model) => model.id === fallback)
      ? fallback
      : null;
}
