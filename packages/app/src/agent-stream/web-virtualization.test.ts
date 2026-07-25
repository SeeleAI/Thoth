import { describe, expect, it } from "vitest";
import type { TimelineRenderItem } from "./timeline-view-registry";
import { timelineId } from "./timeline-view-registry";
import {
  assistantTimelineEntry,
  reasoningTimelineEntry,
  timelineTimestamp,
  toolTimelineEntry,
  userTimelineEntry,
} from "@/test-fixtures/timeline";
import {
  clearAssistantImageMetadataCache,
  setAssistantImageMetadata,
} from "@/utils/assistant-image-metadata";
import {
  DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS,
  DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD,
  estimateStreamItemHeight,
  findMountedWindowStart,
  getWebMountedRecentStreamItems,
  getWebPartialVirtualizationThreshold,
  splitWebVirtualizedHistory,
  type IndexedStreamItem,
} from "./web-virtualization";

const userMessage = userTimelineEntry;
const assistantMessage = assistantTimelineEntry;
const toolCall = (id: string, seed: number) => toolTimelineEntry({ id, seed });
const thought = reasoningTimelineEntry;

function indexEntries(items: TimelineRenderItem[]): IndexedStreamItem[] {
  return items.map((item, index) => ({ item, index }));
}

describe("findMountedWindowStart", () => {
  it("keeps all items mounted when the chat is below the threshold", () => {
    const items = [userMessage("u1", 1), assistantMessage("a1", 2)];

    expect(
      findMountedWindowStart({
        items,
        minMountedCount: 50,
      }),
    ).toBe(0);
  });

  it("rewinds to the previous user boundary when the cutoff lands inside a turn", () => {
    const items: TimelineRenderItem[] = [];
    for (let index = 0; index < 30; index += 1) {
      const seed = index * 3;
      items.push(userMessage(`u${index}`, seed + 1));
      items.push(toolCall(`t${index}`, seed + 2));
      items.push(assistantMessage(`a${index}`, seed + 3));
    }

    expect(
      findMountedWindowStart({
        items,
        minMountedCount: 50,
      }),
    ).toBe(39);
  });
});

describe("splitWebVirtualizedHistory", () => {
  it("splits older entries into the virtualized section and keeps the recent window mounted", () => {
    const items: TimelineRenderItem[] = [];
    for (let index = 0; index < 30; index += 1) {
      const seed = index * 2;
      items.push(userMessage(`u${index}`, seed + 1));
      items.push(assistantMessage(`a${index}`, seed + 2));
    }

    const window = splitWebVirtualizedHistory({
      entries: indexEntries(items),
      minMountedCount: 50,
    });

    expect(window.virtualizedEntries).toHaveLength(10);
    expect(timelineId(window.virtualizedEntries[0]!.item)).toBe("u0");
    expect(timelineId(window.virtualizedEntries.at(-1)!.item)).toBe("a4");
    expect(timelineId(window.mountedEntries[0]!.item)).toBe("u5");
    expect(window.mountedEntries).toHaveLength(50);
  });
});

describe("estimateStreamItemHeight", () => {
  it("uses compact estimates for collapsed tool sequence rows", () => {
    expect(estimateStreamItemHeight(toolCall("tool", 1))).toBe(40);
    expect(estimateStreamItemHeight(thought("thought", 2))).toBe(40);
  });

  it("uses a larger estimate for user messages with image attachments", () => {
    const item: TimelineRenderItem = {
      ...userMessage("u-image", 1, "image"),
      presentation: {
        messageId: "u-image",
        text: "image",
        timestamp: timelineTimestamp(1),
        status: "confirmed",
        attachments: [],
        images: [
          {
            id: "att-1",
            mimeType: "image/png",
            storageType: "desktop-file",
            storageKey: "/tmp/screenshot.png",
            fileName: "screenshot.png",
            byteSize: 1024,
            createdAt: Date.now(),
          },
        ],
      },
    };

    expect(estimateStreamItemHeight(item)).toBe(220);
  });

  it("uses cached assistant image metadata when available", () => {
    clearAssistantImageMetadataCache();
    setAssistantImageMetadata(
      {
        source: "https://example.com/tall.png",
      },
      { width: 800, height: 1600 },
    );

    const item = assistantMessage(
      "a-image",
      2,
      "Look at this\n\n![Screenshot](https://example.com/tall.png)",
    );

    expect(estimateStreamItemHeight(item)).toBeGreaterThan(220);
  });
});

describe("web virtualization test overrides", () => {
  it("uses defaults unless explicit positive integer overrides are present", () => {
    const globalWithOverrides = globalThis as typeof globalThis & {
      __THOTH_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD?: unknown;
      __THOTH_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS?: unknown;
    };
    const previousThreshold = globalWithOverrides.__THOTH_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD;
    const previousMounted = globalWithOverrides.__THOTH_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS;

    try {
      delete globalWithOverrides.__THOTH_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD;
      delete globalWithOverrides.__THOTH_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS;
      expect(getWebPartialVirtualizationThreshold()).toBe(
        DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD,
      );
      expect(getWebMountedRecentStreamItems()).toBe(DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS);

      globalWithOverrides.__THOTH_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD = 6;
      globalWithOverrides.__THOTH_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS = 4;
      expect(getWebPartialVirtualizationThreshold()).toBe(6);
      expect(getWebMountedRecentStreamItems()).toBe(4);
    } finally {
      if (previousThreshold === undefined) {
        delete globalWithOverrides.__THOTH_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD;
      } else {
        globalWithOverrides.__THOTH_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD = previousThreshold;
      }
      if (previousMounted === undefined) {
        delete globalWithOverrides.__THOTH_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS;
      } else {
        globalWithOverrides.__THOTH_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS = previousMounted;
      }
    }
  });
});
