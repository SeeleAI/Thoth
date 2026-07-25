import { timelineMeta, timelineType, type TimelineRenderItem } from "./timeline-view-registry";
import { SPACING } from "@/styles/theme";

const isUserMessageItem = (item?: TimelineRenderItem | null) =>
  item ? timelineType(item) === "user_message" : false;
const isToolSequenceItem = (item?: TimelineRenderItem | null) =>
  item ? timelineMeta(item).toolSequence : false;

export function getGapBetweenStreamItems(
  item: TimelineRenderItem | null,
  belowItem: TimelineRenderItem | null,
): number {
  if (!item || !belowItem) {
    return 0;
  }

  if (isUserMessageItem(item) && isUserMessageItem(belowItem)) {
    return SPACING[1];
  }
  if (isToolSequenceItem(item) && isToolSequenceItem(belowItem)) {
    return 0;
  }
  if (timelineType(item) === "user_message" && isToolSequenceItem(belowItem)) {
    return SPACING[4];
  }
  if (timelineType(item) === "assistant_message" && isToolSequenceItem(belowItem)) {
    return SPACING[1];
  }
  if (isToolSequenceItem(item) && timelineType(belowItem) === "assistant_message") {
    return SPACING[1];
  }
  return SPACING[4];
}
