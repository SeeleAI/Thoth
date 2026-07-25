import { describe, expect, it } from "vitest";
import { SPACING } from "@/styles/theme";
import {
  assistantTimelineEntry,
  reasoningTimelineEntry,
  toolTimelineEntry,
  userTimelineEntry,
} from "@/test-fixtures/timeline";
import { getGapBetweenStreamItems } from "./spacing";

describe("getGapBetweenStreamItems", () => {
  it("uses no gap without a current item", () => {
    expect(getGapBetweenStreamItems(null, userTimelineEntry("u", 1))).toBe(0);
  });

  it("uses no gap without a following item", () => {
    expect(getGapBetweenStreamItems(userTimelineEntry("u", 1), null)).toBe(0);
  });

  it("keeps adjacent user messages compact", () => {
    expect(getGapBetweenStreamItems(userTimelineEntry("u1", 1), userTimelineEntry("u2", 2))).toBe(
      SPACING[1],
    );
  });

  it("collapses adjacent tool calls", () => {
    expect(
      getGapBetweenStreamItems(
        toolTimelineEntry({ id: "t1", seed: 1 }),
        toolTimelineEntry({ id: "t2", seed: 2 }),
      ),
    ).toBe(0);
  });

  it("collapses reasoning followed by a tool call", () => {
    expect(
      getGapBetweenStreamItems(
        reasoningTimelineEntry("thinking", 1),
        toolTimelineEntry({ id: "t", seed: 2 }),
      ),
    ).toBe(0);
  });

  it("uses the tool lead-in gap after a user message", () => {
    expect(
      getGapBetweenStreamItems(userTimelineEntry("u", 1), reasoningTimelineEntry("thinking", 2)),
    ).toBe(SPACING[4]);
  });

  it("keeps assistant-to-tool spacing compact", () => {
    expect(
      getGapBetweenStreamItems(
        assistantTimelineEntry("a", 1),
        toolTimelineEntry({ id: "t", seed: 2 }),
      ),
    ).toBe(SPACING[1]);
  });

  it("keeps tool-to-assistant spacing compact", () => {
    expect(
      getGapBetweenStreamItems(
        toolTimelineEntry({ id: "t", seed: 1 }),
        assistantTimelineEntry("a", 2),
      ),
    ).toBe(SPACING[1]);
  });

  it("uses the standard gap between assistant messages", () => {
    expect(
      getGapBetweenStreamItems(assistantTimelineEntry("a1", 1), assistantTimelineEntry("a2", 2)),
    ).toBe(SPACING[4]);
  });

  it("uses the standard gap from an assistant to a user message", () => {
    expect(
      getGapBetweenStreamItems(assistantTimelineEntry("a", 1), userTimelineEntry("u", 2)),
    ).toBe(SPACING[4]);
  });
});
