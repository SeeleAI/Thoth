import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { deriveStreamTurnTiming } from "./turn-time";
import type { TimelineRenderItem } from "@/agent-stream/timeline-view-registry";
import { timelineEntry } from "@/test-fixtures/timeline";

function entryAt(item: Parameters<typeof timelineEntry>[0], timestamp: Date): TimelineRenderItem {
  const entry = timelineEntry(item, 1);
  return { ...entry, timestamp: timestamp.toISOString() };
}

function user(id: string, timestamp: Date): TimelineRenderItem {
  return entryAt({ type: "user_message", messageId: id, text: id }, timestamp);
}

function assistant(id: string, timestamp: Date): TimelineRenderItem {
  return entryAt({ type: "assistant_message", messageId: id, text: id }, timestamp);
}

describe("deriveStreamTurnTiming", () => {
  it("uses the last user message as the running turn start", () => {
    const firstUserAt = new Date("2026-05-15T00:00:00.000Z");
    const secondUserAt = new Date("2026-05-15T00:01:00.000Z");

    const timing = deriveStreamTurnTiming({
      agentStatus: "running",
      tail: [
        user("u1", firstUserAt),
        assistant("a1", new Date("2026-05-15T00:00:05.000Z")),
        user("u2", secondUserAt),
      ],
      head: [assistant("a2", new Date("2026-05-15T00:01:04.000Z"))],
    });

    assert.deepEqual(timing.runningStartedAt, secondUserAt);
    assert.equal(timing.byAssistantId.has("a2"), false);
  });

  it("derives completed turn timing from user and assistant item timestamps", () => {
    const userAt = new Date("2026-05-15T00:00:00.000Z");
    const assistantAt = new Date("2026-05-15T00:00:07.000Z");

    const timing = deriveStreamTurnTiming({
      agentStatus: "idle",
      tail: [
        user("u1", userAt),
        assistant("a1", assistantAt),
        user("u2", new Date("2026-05-15T00:01:00.000Z")),
      ],
      head: [],
    });

    assert.deepEqual(timing.byAssistantId.get("a1"), {
      startedAt: userAt,
      completedAt: assistantAt,
      durationMs: 7000,
    });
  });

  it("maps multiple assistant chunks in one turn to the same timing", () => {
    const userAt = new Date("2026-05-15T00:00:00.000Z");
    const firstAssistantAt = new Date("2026-05-15T00:00:03.000Z");
    const lastAssistantAt = new Date("2026-05-15T00:00:07.000Z");

    const timing = deriveStreamTurnTiming({
      agentStatus: "idle",
      tail: [
        user("u1", userAt),
        assistant("a1", firstAssistantAt),
        assistant("a2", lastAssistantAt),
      ],
      head: [],
    });

    const expected = {
      startedAt: userAt,
      completedAt: lastAssistantAt,
      durationMs: 7000,
    };
    assert.deepEqual(timing.byAssistantId.get("a1"), expected);
    assert.deepEqual(timing.byAssistantId.get("a2"), expected);
  });
});
