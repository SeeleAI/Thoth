import {
  timelineEstimateHeight,
  timelineType,
  type TimelineRenderItem,
} from "./timeline-view-registry";

export const DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD = 100;
export const DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS = 50;

type BottomAnchorE2ETestGlobals = typeof globalThis & {
  __THOTH_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD?: unknown;
  __THOTH_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS?: unknown;
};

function readPositiveIntegerOverride(value: unknown): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value as number);
  return normalized > 0 ? normalized : null;
}

export function getWebPartialVirtualizationThreshold(): number {
  const override = readPositiveIntegerOverride(
    (globalThis as BottomAnchorE2ETestGlobals).__THOTH_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD,
  );
  return override ?? DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD;
}

export function getWebMountedRecentStreamItems(): number {
  const override = readPositiveIntegerOverride(
    (globalThis as BottomAnchorE2ETestGlobals).__THOTH_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS,
  );
  return override ?? DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS;
}

export interface IndexedStreamItem {
  item: TimelineRenderItem;
  index: number;
}

export interface WebVirtualizedHistoryWindow {
  virtualizedEntries: IndexedStreamItem[];
  mountedEntries: IndexedStreamItem[];
}

export function estimateStreamItemHeight(item: TimelineRenderItem): number {
  return timelineEstimateHeight(item);
}

export function findMountedWindowStart(input: {
  items: TimelineRenderItem[];
  minMountedCount: number;
}): number {
  const { items, minMountedCount } = input;
  if (items.length <= minMountedCount) {
    return 0;
  }

  let startIndex = Math.max(items.length - minMountedCount, 0);
  while (startIndex > 0 && timelineType(items[startIndex]!) !== "user_message") {
    startIndex -= 1;
  }
  return startIndex;
}

export function splitWebVirtualizedHistory(input: {
  entries: IndexedStreamItem[];
  minMountedCount: number;
}): WebVirtualizedHistoryWindow {
  const startIndex = findMountedWindowStart({
    items: input.entries.map((entry) => entry.item),
    minMountedCount: input.minMountedCount,
  });
  return {
    virtualizedEntries: input.entries.slice(0, startIndex),
    mountedEntries: input.entries.slice(startIndex),
  };
}
