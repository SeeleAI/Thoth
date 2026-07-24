import type { TimelineViewModel } from "@/projection/timeline-view-model";

export function resolveAssistantTurnBoundaryMessageId(input: {
  items: readonly TimelineViewModel[];
  startIndex: number;
}): string | undefined {
  const item = input.items[input.startIndex];
  if (item?.kind !== "assistant_message") {
    return undefined;
  }
  // Forking without the selected assistant's durable message id would send the wrong slice.
  return item.messageId || undefined;
}
