import { describe, expect, it } from "vitest";
import type { TurnTiming } from "@/timeline/turn-time";
import type { TimelineRenderItem } from "./timeline-view-registry";
import { timelineId } from "./timeline-view-registry";
import {
  assistantTimelineEntry,
  reasoningTimelineEntry,
  toolTimelineEntry,
  userTimelineEntry,
} from "@/test-fixtures/timeline";
import {
  orderHeadForStreamRenderStrategy,
  orderTailForStreamRenderStrategy,
  type StreamStrategy,
} from "./strategy";
import { resolveStreamRenderStrategy } from "./strategy-resolver";
import { layoutStream, type StreamLayout, type StreamLayoutItem } from "./layout";

function timestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

type TimelineItemWithId = TimelineRenderItem & { id: string };

function withId(item: TimelineRenderItem, id = timelineId(item)): TimelineItemWithId {
  return { ...item, id };
}

function userMessage(id: string, seed: number): TimelineItemWithId {
  return withId(userTimelineEntry(id, seed), id);
}

function assistantMessage(
  id: string,
  seed: number,
  block?: { groupId: string; index: number },
): TimelineItemWithId {
  void block;
  return withId(assistantTimelineEntry(id, seed), id);
}

function toolCall(id: string, seed: number): TimelineItemWithId {
  return withId(toolTimelineEntry({ id, seed }), id);
}

function pendingAuthorityToolCall(id: string, seed: number): TimelineItemWithId {
  return withId(
    toolTimelineEntry({
      id,
      seed,
      name: "clarify",
      status: "running",
      detail: {
        type: "plain_text",
        label: "需求拆解",
        text: "正在拆解需求边界。",
        icon: "brain",
      },
      metadata: {
        thothAuthorityDecision: true,
        pendingAuthorityDecision: true,
      },
    }),
    id,
  );
}

function thought(id: string, seed: number): TimelineItemWithId {
  const item = reasoningTimelineEntry(id, seed);
  return withId(item);
}

function timingFor(...ids: string[]): Map<string, TurnTiming> {
  const timing = {
    startedAt: timestamp(1),
    completedAt: timestamp(9),
    durationMs: 8000,
  };
  return new Map(ids.map((id) => [id, timing]));
}

function strategyFor(platform: "web" | "android"): StreamStrategy {
  return resolveStreamRenderStrategy({
    platform,
    isMobileBreakpoint: false,
  });
}

function layoutFor(input: {
  platform: "web" | "android";
  agentStatus?: string;
  tail: TimelineRenderItem[];
  head?: TimelineRenderItem[];
  timingIds?: string[];
}): StreamLayout {
  const strategy = strategyFor(input.platform);
  return layoutStream({
    strategy,
    agentStatus: input.agentStatus ?? "idle",
    history: orderTailForStreamRenderStrategy({
      strategy,
      streamItems: input.tail,
    }),
    liveHead: orderHeadForStreamRenderStrategy({
      strategy,
      streamHead: input.head ?? [],
    }),
    timingByAssistantId: timingFor(...(input.timingIds ?? [])),
  });
}

function footerOwners(layout: StreamLayout): string[] {
  const owners = [
    ...layout.history.flatMap((item) => (item.completedFooter ? [timelineId(item.item)] : [])),
    ...layout.liveHead.flatMap((item) => (item.completedFooter ? [timelineId(item.item)] : [])),
    ...(layout.auxiliaryTurnFooter ? [layout.auxiliaryTurnFooter.itemId] : []),
  ];
  return owners;
}

function findLayoutItem(layout: StreamLayout, id: string): StreamLayoutItem {
  const item = [...layout.history, ...layout.liveHead].find(
    (candidate) => timelineId(candidate.item) === id,
  );
  if (!item) {
    throw new Error(`Missing layout item ${id}`);
  }
  return item;
}

describe("layoutStream", () => {
  it.each(["web", "android"] as const)(
    "keeps split assistant block spacing identical to unsplit history on %s",
    (platform) => {
      const firstBlock = assistantMessage("turn:block:0", 2, { groupId: "turn", index: 0 });
      const secondBlock = assistantMessage("turn:block:1", 3, { groupId: "turn", index: 1 });
      const thirdBlock = assistantMessage("turn:block:2", 4, { groupId: "turn", index: 2 });
      const splitLayout = layoutFor({
        platform,
        agentStatus: "running",
        tail: [userMessage("u1", 1), firstBlock],
        head: [secondBlock, thirdBlock],
        timingIds: [firstBlock.id, secondBlock.id, thirdBlock.id],
      });
      const unsplitLayout = layoutFor({
        platform,
        agentStatus: "running",
        tail: [userMessage("u1", 1), firstBlock, secondBlock, thirdBlock],
        timingIds: [firstBlock.id, secondBlock.id, thirdBlock.id],
      });

      expect(timelineId(findLayoutItem(splitLayout, firstBlock.id).belowItem!)).toBe(
        secondBlock.id,
      );
      expect(timelineId(findLayoutItem(splitLayout, secondBlock.id).aboveItem!)).toBe(
        firstBlock.id,
      );
      expect(findLayoutItem(splitLayout, firstBlock.id).assistantSpacing).toBe(
        findLayoutItem(unsplitLayout, firstBlock.id).assistantSpacing,
      );
      expect(findLayoutItem(splitLayout, secondBlock.id).assistantSpacing).toBe(
        findLayoutItem(unsplitLayout, secondBlock.id).assistantSpacing,
      );
      expect(findLayoutItem(splitLayout, firstBlock.id).gapBelow).toBe(
        findLayoutItem(unsplitLayout, firstBlock.id).gapBelow,
      );
      expect(findLayoutItem(splitLayout, secondBlock.id).gapBelow).toBe(
        findLayoutItem(unsplitLayout, secondBlock.id).gapBelow,
      );
    },
  );

  it("does not duplicate footers when a native assistant turn spans history and live head", () => {
    const historyBlock = assistantMessage("turn:block:0", 2, { groupId: "turn", index: 0 });
    const headBlock = assistantMessage("turn:head", 3, { groupId: "turn", index: 1 });
    const layout = layoutFor({
      platform: "android",
      tail: [userMessage("u1", 1), historyBlock],
      head: [headBlock],
      timingIds: [historyBlock.id, headBlock.id],
    });

    expect(footerOwners(layout)).toEqual([headBlock.id]);
    expect(timelineId(findLayoutItem(layout, historyBlock.id).belowItem!)).toBe(headBlock.id);
    expect(findLayoutItem(layout, historyBlock.id).completedFooter).toBeNull();
  });

  it("does not duplicate footers when a web assistant turn spans history and live head", () => {
    const historyBlock = assistantMessage("turn:block:0", 2, { groupId: "turn", index: 0 });
    const headBlock = assistantMessage("turn:head", 3, { groupId: "turn", index: 1 });
    const layout = layoutFor({
      platform: "web",
      tail: [userMessage("u1", 1), historyBlock],
      head: [headBlock],
      timingIds: [historyBlock.id, headBlock.id],
    });

    expect(footerOwners(layout)).toEqual([headBlock.id]);
    expect(timelineId(findLayoutItem(layout, historyBlock.id).belowItem!)).toBe(headBlock.id);
    expect(timelineId(findLayoutItem(layout, headBlock.id).aboveItem!)).toBe(historyBlock.id);
  });

  it("keeps the completed footer visually after the assistant after a native user reply", () => {
    const assistant = assistantMessage("a1", 2);
    const layout = layoutFor({
      platform: "android",
      tail: [userMessage("u1", 1), assistant, userMessage("u2", 3)],
      timingIds: [assistant.id],
    });
    const assistantRow = findLayoutItem(layout, assistant.id);

    expect(layout.auxiliaryTurnFooter).toBeNull();
    expect(assistantRow.completedFooter?.itemId).toBe(assistant.id);
    expect(timelineId(assistantRow.belowItem!)).toBe("u2");
    expect(assistantRow.frameOrder).toBe("footer-then-content");
  });

  it("keeps forward stream content before its completed footer", () => {
    const assistant = assistantMessage("a1", 2);
    const layout = layoutFor({
      platform: "web",
      tail: [userMessage("u1", 1), assistant, userMessage("u2", 3)],
      timingIds: [assistant.id],
    });
    const assistantRow = findLayoutItem(layout, assistant.id);

    expect(assistantRow.completedFooter?.itemId).toBe(assistant.id);
    expect(assistantRow.frameOrder).toBe("content-then-footer");
  });

  it("compacts assistant block spacing across the history and live-head boundary", () => {
    const historyBlock = assistantMessage("turn:block:0", 2, { groupId: "turn", index: 0 });
    const headBlock = assistantMessage("turn:head", 3, { groupId: "turn", index: 1 });
    const layout = layoutFor({
      platform: "android",
      tail: [userMessage("u1", 1), historyBlock],
      head: [headBlock],
      timingIds: [historyBlock.id, headBlock.id],
    });

    expect(findLayoutItem(layout, historyBlock.id).assistantSpacing).toBe("default");
    expect(findLayoutItem(layout, headBlock.id).assistantSpacing).toBe("default");
  });

  it.each(["web", "android"] as const)(
    "keeps split tool sequencing and gapBelow identical to unsplit history on %s",
    (platform) => {
      const shell = toolCall("tool-1", 2);
      const thinking = thought("thought-1", 3);
      const assistant = assistantMessage("a1", 4);
      const splitLayout = layoutFor({
        platform,
        tail: [userMessage("u1", 1), shell],
        head: [thinking, assistant],
      });
      const unsplitLayout = layoutFor({
        platform,
        tail: [userMessage("u1", 1), shell, thinking, assistant],
      });

      expect(timelineId(findLayoutItem(splitLayout, shell.id).belowItem!)).toBe(thinking.id);
      expect(timelineId(findLayoutItem(splitLayout, thinking.id).aboveItem!)).toBe(shell.id);
      expect(findLayoutItem(splitLayout, shell.id).toolSequence).toBe(
        findLayoutItem(unsplitLayout, shell.id).toolSequence,
      );
      expect(findLayoutItem(splitLayout, thinking.id).toolSequence).toBe(
        findLayoutItem(unsplitLayout, thinking.id).toolSequence,
      );
      expect(findLayoutItem(splitLayout, shell.id).gapBelow).toBe(
        findLayoutItem(unsplitLayout, shell.id).gapBelow,
      );
      expect(findLayoutItem(splitLayout, thinking.id).gapBelow).toBe(
        findLayoutItem(unsplitLayout, thinking.id).gapBelow,
      );
    },
  );

  it("computes tool sequence position from strategy-aware neighbors", () => {
    const shell = toolCall("tool-1", 2);
    const thinking = thought("thought-1", 3);
    const layout = layoutFor({
      platform: "android",
      tail: [userMessage("u1", 1), shell, thinking, assistantMessage("a1", 4)],
    });

    expect(findLayoutItem(layout, shell.id).toolSequence).toBe("first");
    expect(findLayoutItem(layout, thinking.id).toolSequence).toBe("last");
  });

  it("keeps bottom and inline footer ownership mutually exclusive", () => {
    const assistant = assistantMessage("a1", 2);
    const layout = layoutFor({
      platform: "web",
      tail: [userMessage("u1", 1), assistant],
      timingIds: [assistant.id],
    });

    expect(layout.auxiliaryTurnFooter?.itemId).toBe(assistant.id);
    expect(findLayoutItem(layout, assistant.id).completedFooter).toBeNull();
    expect(footerOwners(layout)).toEqual([assistant.id]);
  });

  it.each(["web", "android"] as const)(
    "keeps inline footer on an assistant turn with trailing tool rows before the next user on %s",
    (platform) => {
      const assistant = assistantMessage("a1", 2);
      const tool = toolCall("tool-1", 3);
      const layout = layoutFor({
        platform,
        tail: [userMessage("u1", 1), assistant, tool, userMessage("u2", 4)],
        timingIds: [assistant.id],
      });

      expect(layout.auxiliaryTurnFooter).toBeNull();
      expect(findLayoutItem(layout, assistant.id).completedFooter?.itemId).toBe(assistant.id);
      expect(footerOwners(layout)).toEqual([assistant.id]);
    },
  );

  it.each(["web", "android"] as const)(
    "uses the latest assistant for an inline footer when a turn has multiple assistant blocks on %s",
    (platform) => {
      const firstAssistant = assistantMessage("a1", 2);
      const firstTool = toolCall("tool-1", 3);
      const latestAssistant = assistantMessage("a2", 4);
      const latestTool = toolCall("tool-2", 5);
      const layout = layoutFor({
        platform,
        tail: [
          userMessage("u1", 1),
          firstAssistant,
          firstTool,
          latestAssistant,
          latestTool,
          userMessage("u2", 6),
        ],
        timingIds: [firstAssistant.id, latestAssistant.id],
      });

      expect(layout.auxiliaryTurnFooter).toBeNull();
      expect(findLayoutItem(layout, firstAssistant.id).completedFooter).toBeNull();
      expect(findLayoutItem(layout, latestAssistant.id).completedFooter?.itemId).toBe(
        latestAssistant.id,
      );
      expect(footerOwners(layout)).toEqual([latestAssistant.id]);
    },
  );

  it.each(["web", "android"] as const)(
    "keeps bottom footer on the latest assistant turn when trailing tool rows end the turn on %s",
    (platform) => {
      const assistant = assistantMessage("a1", 2);
      const tool = toolCall("tool-1", 3);
      const layout = layoutFor({
        platform,
        tail: [userMessage("u1", 1), assistant, tool],
        timingIds: [assistant.id],
      });

      expect(layout.auxiliaryTurnFooter?.itemId).toBe(assistant.id);
      expect(findLayoutItem(layout, assistant.id).completedFooter).toBeNull();
      expect(footerOwners(layout)).toEqual([assistant.id]);
    },
  );

  it.each(["web", "android"] as const)(
    "does not render a completed footer before tool rows while the turn is running on %s",
    (platform) => {
      const assistant = assistantMessage("a1", 2);
      const tool = toolCall("tool-1", 3);
      const layout = layoutFor({
        platform,
        agentStatus: "running",
        tail: [userMessage("u1", 1), assistant, tool],
        timingIds: [assistant.id],
      });

      expect(layout.auxiliaryTurnFooter).toBeNull();
      expect(findLayoutItem(layout, assistant.id).completedFooter).toBeNull();
      expect(footerOwners(layout)).toEqual([]);
    },
  );

  it.each(["web", "android"] as const)(
    "does not render a completed footer while a Thoth authority decision is pending on %s",
    (platform) => {
      const assistant = assistantMessage("a1", 2);
      const tool = pendingAuthorityToolCall("authority-1", 3);
      const layout = layoutFor({
        platform,
        agentStatus: "idle",
        tail: [userMessage("u1", 1), assistant, tool],
        timingIds: [assistant.id],
      });

      expect(layout.auxiliaryTurnFooter).toBeNull();
      expect(findLayoutItem(layout, assistant.id).completedFooter).toBeNull();
      expect(footerOwners(layout)).toEqual([]);
    },
  );
});
