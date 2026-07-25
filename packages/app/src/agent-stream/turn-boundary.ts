import { isPendingTimelineItem, type TimelineRenderItem } from "./timeline-view-registry";

export function resolveAssistantTurnBoundaryMessageId(input: {
  items: readonly TimelineRenderItem[];
  startIndex: number;
}): string | undefined {
  const item = input.items[input.startIndex];
  if (!item || isPendingTimelineItem(item) || item.item.type !== "assistant_message") {
    return undefined;
  }
  // Forking without the selected assistant's durable message id would send the wrong slice.
  return item.item.messageId || undefined;
}
