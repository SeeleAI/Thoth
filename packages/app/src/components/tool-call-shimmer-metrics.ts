export interface ToolCallShimmerMetricsInput {
  label: string;
  secondaryLabel: string | undefined;
  isLoading: boolean;
  isWeb: boolean;
  isNative: boolean;
  labelRowWidth: number;
  labelRowHeight: number;
  labelOffsetX: number;
  labelWidth: number;
  secondaryOffsetX: number;
  secondaryWidth: number;
}

export function computeToolCallShimmerMetrics(input: ToolCallShimmerMetricsInput) {
  const totalShimmerChars = input.label.trim().length + (input.secondaryLabel?.trim().length ?? 0);
  const shortTextDurationAdjustment = totalShimmerChars <= 12 ? 0.25 : 0;
  const shimmerDuration = Math.max(
    1,
    Math.min(2.3, 1.25 + totalShimmerChars * 0.008 - shortTextDurationAdjustment),
  );
  const nativeShimmerPeakWidth = Math.max(
    32,
    Math.min(120, input.labelRowWidth > 0 ? input.labelRowWidth * 0.28 : 0),
  );
  const isWebShimmer = input.isLoading && input.isWeb;
  // React Native Web only registers the layout observer when onLayout exists at mount. Retained
  // badges therefore measure while idle so a later loading transition starts with a real track.
  const shouldMeasureWebShimmer = input.isWeb;
  const shouldMeasureNativeShimmer = input.isLoading && input.isNative;
  const isNativeShimmer =
    shouldMeasureNativeShimmer && input.labelRowWidth > 0 && input.labelRowHeight > 0;
  const webShimmerSpanStartX = input.labelOffsetX;
  const webShimmerSpanEndX = input.secondaryLabel
    ? input.secondaryOffsetX + input.secondaryWidth
    : input.labelOffsetX + input.labelWidth;
  const webShimmerSpanWidth = Math.max(1, webShimmerSpanEndX - webShimmerSpanStartX);
  const webShimmerPeakWidth = Math.max(42, Math.min(120, webShimmerSpanWidth * 0.22));
  const webShimmerTrackStart = webShimmerSpanStartX - webShimmerPeakWidth;
  const webShimmerTrackEnd = webShimmerSpanEndX;
  return {
    shimmerDuration,
    nativeShimmerPeakWidth,
    isWebShimmer,
    shouldMeasureWebShimmer,
    shouldMeasureNativeShimmer,
    isNativeShimmer,
    webShimmerPeakWidth,
    webShimmerTrackStart,
    webShimmerTrackEnd,
  };
}
