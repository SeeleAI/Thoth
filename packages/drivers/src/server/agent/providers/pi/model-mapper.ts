import type { AgentModelDefinition, AgentSelectOption } from "../../harness-contract.js";
import type { PiModel, PiThinkingLevel } from "./rpc-types.js";

export type PiAdapterFlavor = "pi" | "omp";

export const DEFAULT_PI_THINKING_LEVEL: PiThinkingLevel = "medium";

const PI_THINKING_OPTIONS: ReadonlyArray<{
  id: PiThinkingLevel;
  label: string;
  description: string;
}> = [
  { id: "off", label: "Off", description: "No extra reasoning" },
  { id: "minimal", label: "Minimal", description: "Light reasoning" },
  { id: "low", label: "Low", description: "Faster reasoning" },
  { id: "medium", label: "Medium", description: "Balanced reasoning" },
  { id: "high", label: "High", description: "Deeper reasoning" },
  { id: "xhigh", label: "XHigh", description: "Extra-high reasoning" },
];

const OMP_THINKING_OPTIONS: ReadonlyArray<(typeof PI_THINKING_OPTIONS)[number]> = [
  ...PI_THINKING_OPTIONS,
  { id: "max", label: "Max", description: "Maximum reasoning" },
];

function mapOptions(
  options: ReadonlyArray<(typeof OMP_THINKING_OPTIONS)[number]>,
  defaultId: PiThinkingLevel,
): AgentSelectOption[] {
  return options.map((option) => ({
    ...option,
    ...(option.id === defaultId ? { isDefault: true } : {}),
  }));
}

function resolveThinking(
  model: PiModel,
  flavor: PiAdapterFlavor,
): {
  thinkingOptions: AgentSelectOption[] | undefined;
  defaultThinkingOptionId: string | undefined;
} {
  if (!model.reasoning) return { thinkingOptions: undefined, defaultThinkingOptionId: undefined };
  if (flavor === "pi") {
    return {
      thinkingOptions: mapOptions(PI_THINKING_OPTIONS, DEFAULT_PI_THINKING_LEVEL),
      defaultThinkingOptionId: DEFAULT_PI_THINKING_LEVEL,
    };
  }

  const reportedEfforts = model.thinking?.efforts;
  if (!reportedEfforts || reportedEfforts.length === 0) {
    return {
      thinkingOptions: mapOptions(OMP_THINKING_OPTIONS, DEFAULT_PI_THINKING_LEVEL),
      defaultThinkingOptionId: DEFAULT_PI_THINKING_LEVEL,
    };
  }

  const reported = new Set([...reportedEfforts, ...Object.keys(model.thinking?.effortMap ?? {})]);
  const supported = OMP_THINKING_OPTIONS.filter((option) => reported.has(option.id));
  if (supported.length === 0) {
    return { thinkingOptions: undefined, defaultThinkingOptionId: undefined };
  }
  const reportedDefault = model.thinking?.defaultLevel;
  const defaultId = supported.some((option) => option.id === reportedDefault)
    ? (reportedDefault as PiThinkingLevel)
    : supported[0]!.id;
  return {
    thinkingOptions: mapOptions(supported, defaultId),
    defaultThinkingOptionId: defaultId,
  };
}

export function mapPiModel(model: PiModel, flavor: PiAdapterFlavor): AgentModelDefinition {
  const thinking = resolveThinking(model, flavor);
  return {
    provider: "pi",
    id: `${model.provider}/${model.id}`,
    label: `${model.provider}/${model.name ?? model.id}`,
    description: `${model.provider}/${model.id}`,
    metadata: { provider: model.provider, modelId: model.id, flavor },
    ...thinking,
  };
}
