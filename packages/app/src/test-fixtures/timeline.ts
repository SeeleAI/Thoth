import type {
  AgentTimelineEntry,
  AgentTimelineItem,
  ToolCallDetail,
  ToolCallTimelineItem,
} from "@thoth/protocol/agent-types";

export type TimelineEntry<T extends AgentTimelineItem["type"] = AgentTimelineItem["type"]> =
  AgentTimelineEntry & { item: Extract<AgentTimelineItem, { type: T }> };

export function timelineTimestamp(seed: number): Date {
  return new Date(Date.UTC(2026, 0, 1) + seed * 1000);
}

export function timelineEntry<TItem extends AgentTimelineItem>(
  item: TItem,
  seed: number,
  provider = "codex",
): AgentTimelineEntry & { item: TItem } {
  return {
    provider,
    item,
    timestamp: timelineTimestamp(seed).toISOString(),
    seqStart: seed,
    seqEnd: seed,
    sourceSeqRanges: [{ startSeq: seed, endSeq: seed }],
    collapsed: [],
  };
}

export function userTimelineEntry(
  id: string,
  seed: number,
  text = id,
): TimelineEntry<"user_message"> {
  return timelineEntry({ type: "user_message", messageId: id, text }, seed);
}

export function assistantTimelineEntry(
  id: string,
  seed: number,
  text = id,
): TimelineEntry<"assistant_message"> {
  return timelineEntry({ type: "assistant_message", messageId: id, text }, seed);
}

export function reasoningTimelineEntry(text: string, seed: number): TimelineEntry<"reasoning"> {
  return timelineEntry({ type: "reasoning", text }, seed);
}

export function toolTimelineEntry(input: {
  id: string;
  seed: number;
  name?: string;
  status?: ToolCallTimelineItem["status"];
  detail?: ToolCallDetail;
  metadata?: Record<string, unknown>;
}): TimelineEntry<"tool_call"> {
  const status = input.status ?? "completed";
  const base = {
    type: "tool_call" as const,
    callId: input.id,
    name: input.name ?? "shell",
    detail: input.detail ?? { type: "shell", command: "echo hi" },
    metadata: input.metadata,
  };
  const item: ToolCallTimelineItem =
    status === "failed" ? { ...base, status, error: "failed" } : { ...base, status, error: null };
  return timelineEntry(item, input.seed);
}
