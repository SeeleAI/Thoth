import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@/test-fixtures/timeline";
import { timelineEntry, userTimelineEntry } from "@/test-fixtures/timeline";
import { resolveAssistantTurnBoundaryMessageId } from "./turn-boundary";

const userMessage = userTimelineEntry;

function assistantMessage(
  id: string,
  seed: number,
  messageId?: string,
): TimelineEntry<"assistant_message"> {
  return timelineEntry(
    { type: "assistant_message", text: id, ...(messageId ? { messageId } : {}) },
    seed,
  );
}

describe("resolveAssistantTurnBoundaryMessageId", () => {
  it("uses the selected assistant message id", () => {
    const selected = assistantMessage("assistant-1", 2, "msg-assistant-1");

    expect(
      resolveAssistantTurnBoundaryMessageId({
        items: [userMessage("user-1", 1), selected],
        startIndex: 1,
      }),
    ).toBe("msg-assistant-1");
  });

  it("does not borrow a boundary id from another assistant in the same turn", () => {
    const first = assistantMessage("assistant-1", 2, "msg-assistant-1");
    const selected = assistantMessage("assistant-2", 3);

    expect(
      resolveAssistantTurnBoundaryMessageId({
        items: [userMessage("user-1", 1), first, selected],
        startIndex: 2,
      }),
    ).toBeUndefined();
  });

  it("requires the selected item to be an assistant message", () => {
    expect(
      resolveAssistantTurnBoundaryMessageId({
        items: [userMessage("user-1", 1), assistantMessage("assistant-1", 2, "msg-assistant-1")],
        startIndex: 0,
      }),
    ).toBeUndefined();
  });
});
