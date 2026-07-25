import type { TurnTiming } from "@/timeline/turn-time";
import { getGapBetweenStreamItems } from "./spacing";
import type { StreamFrameChildOrder, StreamStrategy } from "./strategy";
import {
  hasPendingAuthorityDecision,
  timelineId,
  timelineMeta,
  timelineType,
  type TimelineRenderItem,
} from "./timeline-view-registry";

export type StreamToolSequence = "single" | "first" | "middle" | "last" | "none";

export interface TurnFooterHost {
  itemId: string;
  items: TimelineRenderItem[];
  timing?: TurnTiming;
  startIndex: number;
}

export interface StreamLayoutItem {
  item: TimelineRenderItem;
  index: number;
  items: TimelineRenderItem[];
  aboveItem: TimelineRenderItem | null;
  belowItem: TimelineRenderItem | null;
  gapBelow: number;
  assistantSpacing: "default" | "compactTop" | "compactBottom" | "compactBoth";
  completedFooter: TurnFooterHost | null;
  toolSequence: StreamToolSequence;
  isFirstInUserGroup: boolean;
  isLastInUserGroup: boolean;
  isLastInToolSequence: boolean;
  frameOrder: StreamFrameChildOrder;
}

export interface StreamLayout {
  history: StreamLayoutItem[];
  liveHead: StreamLayoutItem[];
  auxiliaryTurnFooter: TurnFooterHost | null;
}

export interface StreamLayoutInput {
  strategy: StreamStrategy;
  agentStatus: string;
  history: TimelineRenderItem[];
  liveHead: TimelineRenderItem[];
  timingByAssistantId: Map<string, TurnTiming>;
}

interface LayoutSegmentInput {
  strategy: StreamStrategy;
  agentStatus: string;
  items: TimelineRenderItem[];
  timingByAssistantId: Map<string, TurnTiming>;
  auxiliaryTurnFooter: TurnFooterHost | null;
  frameOrder: StreamFrameChildOrder;
  boundaryIndex: number | null;
  boundaryAboveItem: TimelineRenderItem | null;
  boundaryBelowItem: TimelineRenderItem | null;
}

function createTurnFooterHost(input: {
  item: TimelineRenderItem;
  items: TimelineRenderItem[];
  index: number;
  timingByAssistantId: Map<string, TurnTiming>;
}): TurnFooterHost {
  return {
    itemId: timelineId(input.item),
    items: input.items,
    timing: input.timingByAssistantId.get(timelineId(input.item)),
    startIndex: input.index,
  };
}

function findLatestAssistantIndexInTurn(input: {
  strategy: StreamStrategy;
  items: TimelineRenderItem[];
  startIndex: number;
}): number | null {
  for (
    let index = input.startIndex;
    index >= 0 && index < input.items.length;
    index = input.strategy.getNeighborIndex(index, "above")
  ) {
    const item = input.items[index];
    if (!item || timelineType(item) === "user_message") {
      return null;
    }
    if (timelineType(item) === "assistant_message") {
      return index;
    }
  }
  return null;
}

function resolveAuxiliaryTurnFooter(input: StreamLayoutInput): TurnFooterHost | null {
  if (hasPendingAuthorityDecision(input.liveHead) || hasPendingAuthorityDecision(input.history)) {
    return null;
  }
  if (input.agentStatus === "running") {
    return null;
  }

  const footerItems = input.liveHead.length > 0 ? input.liveHead : input.history;
  const latestIndex = input.strategy.getLatestItemIndex(footerItems);
  if (latestIndex === null) {
    return null;
  }

  const assistantIndex = findLatestAssistantIndexInTurn({
    strategy: input.strategy,
    items: footerItems,
    startIndex: latestIndex,
  });
  if (assistantIndex === null) {
    return null;
  }

  const item = footerItems[assistantIndex];
  if (!item || timelineType(item) !== "assistant_message") {
    return null;
  }

  return createTurnFooterHost({
    item,
    items: footerItems,
    index: assistantIndex,
    timingByAssistantId: input.timingByAssistantId,
  });
}

function findTurnEndIndexInSegment(input: {
  strategy: StreamStrategy;
  items: TimelineRenderItem[];
  startIndex: number;
}): number {
  let endIndex = input.startIndex;
  for (
    let index = input.strategy.getNeighborIndex(input.startIndex, "below");
    index >= 0 && index < input.items.length;
    index = input.strategy.getNeighborIndex(index, "below")
  ) {
    const item = input.items[index];
    if (!item || timelineType(item) === "user_message") {
      break;
    }
    endIndex = index;
  }
  return endIndex;
}

function shouldRenderCompletedFooter(input: {
  strategy: StreamStrategy;
  items: TimelineRenderItem[];
  index: number;
  item: TimelineRenderItem;
  belowItem: TimelineRenderItem | null;
  agentStatus: string;
  auxiliaryTurnFooter: TurnFooterHost | null;
  boundaryIndex: number | null;
  boundaryBelowItem: TimelineRenderItem | null;
}): boolean {
  if (
    timelineType(input.item) !== "assistant_message" ||
    input.auxiliaryTurnFooter?.itemId === timelineId(input.item) ||
    hasPendingAuthorityDecision(input.items)
  ) {
    return false;
  }

  if (
    (input.belowItem && timelineType(input.belowItem) === "user_message") ||
    (input.belowItem === null && input.agentStatus !== "running")
  ) {
    return true;
  }

  if (!isToolSequenceItem(input.belowItem)) {
    return false;
  }

  const sameSegmentBelowItem = input.strategy.getNeighborItem(input.items, input.index, "below");
  if (
    !sameSegmentBelowItem ||
    !input.belowItem ||
    timelineId(sameSegmentBelowItem) !== timelineId(input.belowItem)
  ) {
    return false;
  }

  const turnEndIndex = findTurnEndIndexInSegment({
    strategy: input.strategy,
    items: input.items,
    startIndex: input.index,
  });
  const belowTurnItem = getSegmentNeighbor({
    strategy: input.strategy,
    items: input.items,
    index: turnEndIndex,
    relation: "below",
    boundaryIndex: input.boundaryIndex,
    boundaryItem: input.boundaryBelowItem,
  });
  if (
    input.agentStatus === "running" &&
    (!belowTurnItem || timelineType(belowTurnItem) !== "user_message")
  ) {
    return false;
  }
  const assistantIndex = findLatestAssistantIndexInTurn({
    strategy: input.strategy,
    items: input.items,
    startIndex: turnEndIndex,
  });
  return assistantIndex === input.index;
}

function isToolSequenceItem(item: TimelineRenderItem | null): item is TimelineRenderItem {
  return item ? timelineMeta(item).toolSequence : false;
}

function getToolSequence(input: {
  item: TimelineRenderItem;
  aboveItem: TimelineRenderItem | null;
  belowItem: TimelineRenderItem | null;
}): StreamToolSequence {
  if (!isToolSequenceItem(input.item)) {
    return "none";
  }

  const hasAbove = isToolSequenceItem(input.aboveItem);
  const hasBelow = isToolSequenceItem(input.belowItem);
  if (hasAbove && hasBelow) {
    return "middle";
  }
  if (hasAbove) {
    return "last";
  }
  if (hasBelow) {
    return "first";
  }
  return "single";
}

function getSegmentNeighbor(input: {
  strategy: StreamStrategy;
  items: TimelineRenderItem[];
  index: number;
  relation: "above" | "below";
  boundaryIndex: number | null;
  boundaryItem: TimelineRenderItem | null;
}): TimelineRenderItem | null {
  const neighbor = input.strategy.getNeighborItem(input.items, input.index, input.relation);
  if (neighbor) {
    return neighbor;
  }
  if (input.index === input.boundaryIndex) {
    return input.boundaryItem;
  }
  return null;
}

function layoutSegment(input: LayoutSegmentInput): StreamLayoutItem[] {
  return input.items.map((item, index) => {
    const aboveItem = getSegmentNeighbor({
      strategy: input.strategy,
      items: input.items,
      index,
      relation: "above",
      boundaryIndex: input.boundaryIndex,
      boundaryItem: input.boundaryAboveItem,
    });
    const belowItem = getSegmentNeighbor({
      strategy: input.strategy,
      items: input.items,
      index,
      relation: "below",
      boundaryIndex: input.boundaryIndex,
      boundaryItem: input.boundaryBelowItem,
    });
    const completedFooter = shouldRenderCompletedFooter({
      strategy: input.strategy,
      items: input.items,
      index,
      item,
      belowItem,
      agentStatus: input.agentStatus,
      auxiliaryTurnFooter: input.auxiliaryTurnFooter,
      boundaryIndex: input.boundaryIndex,
      boundaryBelowItem: input.boundaryBelowItem,
    })
      ? createTurnFooterHost({
          item,
          items: input.items,
          index,
          timingByAssistantId: input.timingByAssistantId,
        })
      : null;

    return {
      item,
      index,
      items: input.items,
      aboveItem,
      belowItem,
      gapBelow: completedFooter ? 0 : getGapBetweenStreamItems(item, belowItem),
      assistantSpacing: "default",
      completedFooter,
      toolSequence: getToolSequence({ item, aboveItem, belowItem }),
      isFirstInUserGroup:
        timelineType(item) === "user_message" &&
        (!aboveItem || timelineType(aboveItem) !== "user_message"),
      isLastInUserGroup:
        timelineType(item) === "user_message" &&
        (!belowItem || timelineType(belowItem) !== "user_message"),
      isLastInToolSequence: isToolSequenceItem(item) && !isToolSequenceItem(belowItem),
      frameOrder: input.frameOrder,
    };
  });
}

// Keyed by history array identity; inner key encodes the inputs that affect history layout.
// History layout is stable across text-chunk flushes because the liveHead boundary item's
// kind and id don't change when only its text grows.
const historyLayoutCache = new WeakMap<TimelineRenderItem[], Map<string, StreamLayoutItem[]>>();

export function layoutStream(input: StreamLayoutInput): StreamLayout {
  const auxiliaryTurnFooter = resolveAuxiliaryTurnFooter(input);
  const historyBoundaryIndex = input.strategy.getHistoryLiveBoundaryIndex(input.history);
  const liveHeadBoundaryIndex = input.strategy.getLiveHeadHistoryBoundaryIndex(input.liveHead);
  const historyBoundaryItem =
    historyBoundaryIndex === null ? null : (input.history[historyBoundaryIndex] ?? null);
  const liveHeadBoundaryItem =
    liveHeadBoundaryIndex === null ? null : (input.liveHead[liveHeadBoundaryIndex] ?? null);
  const frameOrder = input.strategy.getFrameChildOrder();

  let history: StreamLayoutItem[];
  if (input.history.length > 0) {
    // The cache key encodes every input that can change history layout. liveHeadBoundaryItem.id
    // and .kind are stable across text-only flushes (text growth doesn't change what kind of
    // item borders history), so cached layout stays valid between flushes.
    const historyCacheKey = [
      input.agentStatus,
      frameOrder,
      historyBoundaryIndex ?? "null",
      liveHeadBoundaryItem ? timelineId(liveHeadBoundaryItem) : "null",
      liveHeadBoundaryItem ? timelineType(liveHeadBoundaryItem) : "null",
      auxiliaryTurnFooter?.itemId ?? "null",
    ].join(":");
    let byKey = historyLayoutCache.get(input.history);
    if (!byKey) {
      byKey = new Map();
      historyLayoutCache.set(input.history, byKey);
    }
    const cached = byKey.get(historyCacheKey);
    if (cached) {
      history = cached;
    } else {
      history = layoutSegment({
        strategy: input.strategy,
        agentStatus: input.agentStatus,
        items: input.history,
        timingByAssistantId: input.timingByAssistantId,
        auxiliaryTurnFooter,
        frameOrder,
        boundaryIndex: historyBoundaryIndex,
        boundaryAboveItem: null,
        boundaryBelowItem: liveHeadBoundaryItem,
      });
      byKey.set(historyCacheKey, history);
    }
  } else {
    history = [];
  }

  const liveHead = layoutSegment({
    strategy: input.strategy,
    agentStatus: input.agentStatus,
    items: input.liveHead,
    timingByAssistantId: input.timingByAssistantId,
    auxiliaryTurnFooter,
    frameOrder,
    boundaryIndex: liveHeadBoundaryIndex,
    boundaryAboveItem: historyBoundaryItem,
    boundaryBelowItem: null,
  });

  return {
    history,
    liveHead,
    auxiliaryTurnFooter,
  };
}
