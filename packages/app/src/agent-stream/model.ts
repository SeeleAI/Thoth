import type { ReactNode } from "react";
import { deriveStreamTurnTiming, type StreamTurnTiming } from "@/timeline/turn-time";
import type { TimelineRenderItem } from "./timeline-view-registry";
import {
  findMountedWindowStart,
  getWebMountedRecentStreamItems,
  getWebPartialVirtualizationThreshold,
} from "./web-virtualization";
import { orderHeadForStreamRenderStrategy, orderTailForStreamRenderStrategy } from "./strategy";
import { resolveStreamRenderStrategy } from "./strategy-resolver";

export interface StreamRenderSegments {
  historyVirtualized: TimelineRenderItem[];
  historyMounted: TimelineRenderItem[];
  liveHead: TimelineRenderItem[];
}

export interface StreamHistoryBoundary {
  hasVirtualizedHistory: boolean;
  hasMountedHistory: boolean;
  hasLiveHead: boolean;
}

export interface StreamRenderAuxiliary {
  pendingPermissions: ReactNode;
  turnFooter: ReactNode;
}

export interface AgentStreamRenderModel {
  history: TimelineRenderItem[];
  segments: StreamRenderSegments;
  turnTiming: StreamTurnTiming;
  boundary: StreamHistoryBoundary;
  auxiliary: StreamRenderAuxiliary;
}

export interface BuildAgentStreamRenderModelInput {
  agentStatus: string;
  tail: TimelineRenderItem[];
  head: TimelineRenderItem[];
  platform: "web" | "native";
  isMobileBreakpoint: boolean;
}

const EMPTY_STREAM_ITEMS: TimelineRenderItem[] = [];
const EMPTY_AUXILIARY: StreamRenderAuxiliary = {
  pendingPermissions: null,
  turnFooter: null,
};

const orderedTailCache = new WeakMap<TimelineRenderItem[], Map<string, TimelineRenderItem[]>>();
const orderedHeadCache = new WeakMap<TimelineRenderItem[], Map<string, TimelineRenderItem[]>>();
const splitHistoryCache = new WeakMap<
  TimelineRenderItem[],
  Map<string, Pick<AgentStreamRenderModel, "history" | "segments">>
>();
const turnTimingCache = new WeakMap<
  TimelineRenderItem[],
  WeakMap<TimelineRenderItem[], Map<string, StreamTurnTiming>>
>();

function getOrderedItems(params: {
  cache: WeakMap<TimelineRenderItem[], Map<string, TimelineRenderItem[]>>;
  source: TimelineRenderItem[];
  cacheKey: string;
  order: (items: TimelineRenderItem[]) => TimelineRenderItem[];
}): TimelineRenderItem[] {
  const { cache, source, cacheKey, order } = params;
  let cachedByKey = cache.get(source);
  if (!cachedByKey) {
    cachedByKey = new Map();
    cache.set(source, cachedByKey);
  }
  const cached = cachedByKey.get(cacheKey);
  if (cached) {
    return cached;
  }
  const ordered = order(source);
  cachedByKey.set(cacheKey, ordered);
  return ordered;
}

function splitOrderedTail(params: {
  orderedTail: TimelineRenderItem[];
  platform: "web" | "native";
  isMobileBreakpoint: boolean;
}): Pick<AgentStreamRenderModel, "history" | "segments"> {
  const { orderedTail, platform, isMobileBreakpoint } = params;
  const shouldSplitHistory =
    platform === "web" &&
    !isMobileBreakpoint &&
    orderedTail.length > getWebPartialVirtualizationThreshold();
  const cacheKey = `${platform}:${isMobileBreakpoint}:${getWebMountedRecentStreamItems()}:${shouldSplitHistory}`;
  let cachedByKey = splitHistoryCache.get(orderedTail);
  if (!cachedByKey) {
    cachedByKey = new Map();
    splitHistoryCache.set(orderedTail, cachedByKey);
  }
  const cached = cachedByKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!shouldSplitHistory) {
    const unsplit = {
      history: orderedTail,
      segments: {
        historyVirtualized: EMPTY_STREAM_ITEMS,
        historyMounted: orderedTail,
        liveHead: EMPTY_STREAM_ITEMS,
      },
    } satisfies Pick<AgentStreamRenderModel, "history" | "segments">;
    cachedByKey.set(cacheKey, unsplit);
    return unsplit;
  }

  const mountedWindowStart = findMountedWindowStart({
    items: orderedTail,
    minMountedCount: getWebMountedRecentStreamItems(),
  });
  const split = {
    history: orderedTail,
    segments: {
      historyVirtualized: orderedTail.slice(0, mountedWindowStart),
      historyMounted: orderedTail.slice(mountedWindowStart),
      liveHead: EMPTY_STREAM_ITEMS,
    },
  } satisfies Pick<AgentStreamRenderModel, "history" | "segments">;
  cachedByKey.set(cacheKey, split);
  return split;
}

function getTurnTiming(params: {
  agentStatus: string;
  tail: TimelineRenderItem[];
  head: TimelineRenderItem[];
}): StreamTurnTiming {
  let cachedByHead = turnTimingCache.get(params.tail);
  if (!cachedByHead) {
    cachedByHead = new WeakMap();
    turnTimingCache.set(params.tail, cachedByHead);
  }
  let cachedByStatus = cachedByHead.get(params.head);
  if (!cachedByStatus) {
    cachedByStatus = new Map();
    cachedByHead.set(params.head, cachedByStatus);
  }
  const cached = cachedByStatus.get(params.agentStatus);
  if (cached) {
    return cached;
  }
  const timing = deriveStreamTurnTiming(params);
  cachedByStatus.set(params.agentStatus, timing);
  return timing;
}

export function buildAgentStreamRenderModel(
  input: BuildAgentStreamRenderModelInput,
): AgentStreamRenderModel {
  const strategy = resolveStreamRenderStrategy({
    platform: input.platform === "web" ? "web" : "native",
    isMobileBreakpoint: input.isMobileBreakpoint,
  });
  const orderingCacheKey = `${input.platform}:${input.isMobileBreakpoint}`;
  const orderedTail = getOrderedItems({
    cache: orderedTailCache,
    source: input.tail,
    cacheKey: orderingCacheKey,
    order: (items) =>
      orderTailForStreamRenderStrategy({
        strategy,
        streamItems: items,
      }),
  });
  const orderedHead = getOrderedItems({
    cache: orderedHeadCache,
    source: input.head,
    cacheKey: orderingCacheKey,
    order: (items) =>
      orderHeadForStreamRenderStrategy({
        strategy,
        streamHead: items,
      }),
  });
  const splitHistory = splitOrderedTail({
    orderedTail,
    platform: input.platform,
    isMobileBreakpoint: input.isMobileBreakpoint,
  });
  const turnTiming = getTurnTiming({
    agentStatus: input.agentStatus,
    tail: input.tail,
    head: input.head,
  });

  return {
    history: splitHistory.history,
    segments: {
      ...splitHistory.segments,
      liveHead: orderedHead,
    },
    turnTiming,
    boundary: {
      hasVirtualizedHistory: splitHistory.segments.historyVirtualized.length > 0,
      hasMountedHistory: splitHistory.segments.historyMounted.length > 0,
      hasLiveHead: orderedHead.length > 0,
    },
    auxiliary: EMPTY_AUXILIARY,
  };
}
