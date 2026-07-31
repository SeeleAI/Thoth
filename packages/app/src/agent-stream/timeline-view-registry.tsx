import type { ReactNode } from "react";
import type {
  AgentTimelineEntry,
  AgentTimelineItem,
  ToolCallTimelineItem,
} from "@thoth/protocol/agent-types";
import type { PendingAgentMessage } from "@/projection/pending-agent-messages";
import { estimateAssistantMessageHeightFromCache } from "@/utils/assistant-message-height-estimate";

export interface PendingTimelineItem {
  source: "pending";
  message: PendingAgentMessage;
}

export type CanonicalTimelineRenderItem = AgentTimelineEntry & {
  presentation?: PendingAgentMessage;
};
export type TimelineRenderItem = CanonicalTimelineRenderItem | PendingTimelineItem;
export type TimelineItemType = AgentTimelineItem["type"];
export type TypedTimelineEntry<T extends TimelineItemType> = CanonicalTimelineRenderItem & {
  item: Extract<AgentTimelineItem, { type: T }>;
};

export interface TimelineLayoutMeta {
  category: "user" | "assistant" | "tool" | "card" | "system";
  toolSequence: boolean;
}

export interface TimelineRenderLayout {
  assistantSpacing: "default" | "compactTop" | "compactBottom" | "compactBoth";
  isFirstInUserGroup: boolean;
  isLastInUserGroup: boolean;
  isLastInToolSequence: boolean;
}

export interface TimelineRenderContext {
  agentIsRunning: boolean;
  layout: TimelineRenderLayout;
  renderPendingUser(message: PendingAgentMessage, layout: TimelineRenderLayout): ReactNode;
  renderUser(entry: TypedTimelineEntry<"user_message">, layout: TimelineRenderLayout): ReactNode;
  renderAssistant(
    entry: TypedTimelineEntry<"assistant_message">,
    layout: TimelineRenderLayout,
  ): ReactNode;
  renderReasoning(
    entry: TypedTimelineEntry<"reasoning">,
    loading: boolean,
    layout: TimelineRenderLayout,
  ): ReactNode;
  renderTool(
    entry: CanonicalTimelineRenderItem & { item: ToolCallTimelineItem },
    layout: TimelineRenderLayout,
  ): ReactNode;
  renderClarify(entry: TypedTimelineEntry<"clarify_card">): ReactNode;
  renderIntentContract(entry: TypedTimelineEntry<"intent_contract_card">): ReactNode;
  renderLegacyExecutionPlan(entry: TypedTimelineEntry<"legacy_execution_plan">): ReactNode;
  renderRegisteredTask(entry: TypedTimelineEntry<"registered_task">): ReactNode;
  renderTodo(entry: TypedTimelineEntry<"todo">): ReactNode;
  renderError(entry: TypedTimelineEntry<"error">): ReactNode;
  renderCompaction(entry: TypedTimelineEntry<"compaction">): ReactNode;
}

interface TimelineItemView<T extends TimelineItemType> {
  meta: TimelineLayoutMeta;
  estimateHeight(entry: TypedTimelineEntry<T>): number;
  collectAssistantText?(entry: TypedTimelineEntry<T>): string | null;
  render(entry: TypedTimelineEntry<T>, context: TimelineRenderContext): ReactNode;
}

type TimelineItemViewRegistry = {
  [Type in TimelineItemType]: TimelineItemView<Type>;
};

export const timelineItemViewRegistry = {
  user_message: {
    meta: { category: "user", toolSequence: false },
    estimateHeight: (entry) => (entry.presentation?.images.length ? 220 : 96),
    render: (entry, context) => context.renderUser(entry, context.layout),
  },
  assistant_message: {
    meta: { category: "assistant", toolSequence: false },
    estimateHeight: (entry) => estimateAssistantMessageHeightFromCache(entry.item.text) ?? 220,
    collectAssistantText: (entry) => entry.item.text,
    render: (entry, context) => context.renderAssistant(entry, context.layout),
  },
  reasoning: {
    meta: { category: "tool", toolSequence: true },
    estimateHeight: () => 40,
    render: (entry, context) =>
      context.renderReasoning(entry, context.agentIsRunning, context.layout),
  },
  clarify_card: {
    meta: { category: "card", toolSequence: false },
    estimateHeight: () => 360,
    render: (entry, context) => context.renderClarify(entry),
  },
  intent_contract_card: {
    meta: { category: "card", toolSequence: false },
    estimateHeight: () => 460,
    render: (entry, context) => context.renderIntentContract(entry),
  },
  legacy_execution_plan: {
    meta: { category: "card", toolSequence: false },
    estimateHeight: () => 380,
    render: (entry, context) => context.renderLegacyExecutionPlan(entry),
  },
  registered_task: {
    meta: { category: "card", toolSequence: false },
    estimateHeight: () => 220,
    render: (entry, context) => context.renderRegisteredTask(entry),
  },
  tool_call: {
    meta: { category: "tool", toolSequence: true },
    estimateHeight: () => 40,
    render: (entry, context) => context.renderTool(entry, context.layout),
  },
  todo: {
    meta: { category: "tool", toolSequence: true },
    estimateHeight: () => 144,
    render: (entry, context) => context.renderTodo(entry),
  },
  error: {
    meta: { category: "system", toolSequence: false },
    estimateHeight: () => 88,
    render: (entry, context) => context.renderError(entry),
  },
  compaction: {
    meta: { category: "system", toolSequence: false },
    estimateHeight: () => 72,
    render: (entry, context) => context.renderCompaction(entry),
  },
} satisfies TimelineItemViewRegistry;

export function isPendingTimelineItem(item: TimelineRenderItem): item is PendingTimelineItem {
  return "source" in item && item.source === "pending";
}

export function timelineType(item: TimelineRenderItem): TimelineItemType {
  return isPendingTimelineItem(item) ? "user_message" : item.item.type;
}

export function timelineId(item: TimelineRenderItem): string {
  if (isPendingTimelineItem(item)) return item.message.messageId;
  if (
    (item.item.type === "user_message" || item.item.type === "assistant_message") &&
    item.item.messageId
  ) {
    return item.item.messageId;
  }
  if (item.item.type === "tool_call" && item.item.callId) return item.item.callId;
  return `${item.seqStart}:${item.seqEnd}`;
}

export function timelineTimestamp(item: TimelineRenderItem): Date {
  return isPendingTimelineItem(item) ? item.message.timestamp : new Date(item.timestamp);
}

export function timelineMeta(item: TimelineRenderItem): TimelineLayoutMeta {
  if (isPendingTimelineItem(item)) return timelineItemViewRegistry.user_message.meta;
  return timelineItemViewRegistry[item.item.type].meta;
}

export function timelineEstimateHeight(item: TimelineRenderItem): number {
  if (isPendingTimelineItem(item)) return item.message.images.length ? 220 : 96;
  const view = timelineItemViewRegistry[item.item.type] as TimelineItemView<TimelineItemType>;
  return view.estimateHeight(item as TypedTimelineEntry<TimelineItemType>);
}

export function timelineAssistantText(item: TimelineRenderItem): string | null {
  if (isPendingTimelineItem(item) || item.item.type !== "assistant_message") return null;
  return item.item.text;
}

export function hasPendingAuthorityDecision(items: readonly TimelineRenderItem[]): boolean {
  return items.some((entry) => {
    if (isPendingTimelineItem(entry)) return false;
    const item = entry.item;
    if (
      (item.type === "clarify_card" || item.type === "intent_contract_card") &&
      item.card.submitted === false
    ) {
      return true;
    }
    return (
      item.type === "tool_call" &&
      item.status === "running" &&
      item.metadata?.thothAuthorityDecision === true &&
      item.metadata?.pendingAuthorityDecision !== false
    );
  });
}

export function renderTimelineItem(
  item: TimelineRenderItem,
  context: TimelineRenderContext,
): ReactNode {
  if (isPendingTimelineItem(item)) {
    return context.renderPendingUser(item.message, context.layout);
  }
  const view = timelineItemViewRegistry[item.item.type] as TimelineItemView<TimelineItemType>;
  return view.render(item as TypedTimelineEntry<TimelineItemType>, context);
}
