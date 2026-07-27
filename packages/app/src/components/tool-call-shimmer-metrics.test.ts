import { describe, expect, it } from "vitest";
import { computeToolCallShimmerMetrics } from "./tool-call-shimmer-metrics";

const BASE_INPUT = {
  label: "Read",
  secondaryLabel: "src/index.ts",
  isWeb: true,
  isNative: false,
  labelRowWidth: 180,
  labelRowHeight: 20,
  labelOffsetX: 12,
  labelWidth: 36,
  secondaryOffsetX: 56,
  secondaryWidth: 92,
};

describe("computeToolCallShimmerMetrics", () => {
  it("retains web layout measurement before a grouped badge enters loading", () => {
    const idle = computeToolCallShimmerMetrics({ ...BASE_INPUT, isLoading: false });
    const loading = computeToolCallShimmerMetrics({ ...BASE_INPUT, isLoading: true });

    expect(idle.shouldMeasureWebShimmer).toBe(true);
    expect(idle.isWebShimmer).toBe(false);
    expect(loading.shouldMeasureWebShimmer).toBe(true);
    expect(loading.isWebShimmer).toBe(true);
    expect(loading.webShimmerTrackEnd).toBeGreaterThan(loading.webShimmerTrackStart);
  });

  it("does not attach the retained measurement observer on native", () => {
    const native = computeToolCallShimmerMetrics({
      ...BASE_INPUT,
      isLoading: true,
      isWeb: false,
      isNative: true,
    });

    expect(native.shouldMeasureWebShimmer).toBe(false);
    expect(native.shouldMeasureNativeShimmer).toBe(true);
  });
});
