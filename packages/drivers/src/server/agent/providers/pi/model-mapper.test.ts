import { describe, expect, it } from "vitest";
import { mapPiModel } from "./model-mapper.js";

function model(thinking?: {
  efforts?: string[];
  defaultLevel?: string;
  effortMap?: Record<string, string>;
}) {
  return {
    provider: "openrouter",
    id: "reasoning-model",
    reasoning: true,
    ...(thinking ? { thinking } : {}),
  };
}

describe("OMP-flavored Pi model thinking", () => {
  it("exposes only the efforts reported by the model and honors an in-subset default", () => {
    const mapped = mapPiModel(
      model({ efforts: ["low", "high"], defaultLevel: "high", effortMap: { low: "l", high: "h" } }),
      "omp",
    );
    expect(mapped.thinkingOptions?.map((option) => [option.id, option.isDefault ?? false])).toEqual(
      [
        ["low", false],
        ["high", true],
      ],
    );
    expect(mapped.defaultThinkingOptionId).toBe("high");
  });

  it("falls back to the lowest recognizable reported effort, not medium", () => {
    const mapped = mapPiModel(model({ efforts: ["high", "low"], defaultLevel: "medium" }), "omp");
    expect(mapped.thinkingOptions?.map((option) => option.id)).toEqual(["low", "high"]);
    expect(mapped.defaultThinkingOptionId).toBe("low");
  });

  it("uses the full compatibility set only when legacy OMP reports no efforts", () => {
    expect(mapPiModel(model(), "omp").thinkingOptions?.map((option) => option.id)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(mapPiModel(model({ efforts: ["future-ultra"] }), "omp").thinkingOptions).toBeUndefined();
  });

  it("keeps ordinary Pi's established thinking catalog unchanged", () => {
    const mapped = mapPiModel(model({ efforts: ["low"] }), "pi");
    expect(mapped.thinkingOptions?.map((option) => option.id)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(mapped.defaultThinkingOptionId).toBe("medium");
  });
});
