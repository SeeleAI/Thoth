import { describe, expect, it } from "vitest";
import { clampFileLineSelection, fileLineSelectionScrollOffset } from "./line-navigation";

describe("read-only file line navigation", () => {
  it("clamps an assistant file-link range to the current file", () => {
    expect(clampFileLineSelection({ lineStart: 12, lineEnd: 40, lineCount: 20 })).toEqual({
      lineStart: 12,
      lineEnd: 20,
    });
    expect(clampFileLineSelection({ lineStart: 99, lineCount: 20 })).toEqual({
      lineStart: 20,
      lineEnd: 20,
    });
  });

  it("uses a deterministic zero-based scroll offset for the selected first line", () => {
    expect(fileLineSelectionScrollOffset({ lineStart: 12, lineEnd: 20 }, 18)).toBe(198);
  });

  it("does not manufacture a selection for invalid or empty files", () => {
    expect(clampFileLineSelection({ lineStart: 0, lineCount: 20 })).toBeNull();
    expect(clampFileLineSelection({ lineStart: 1, lineCount: 0 })).toBeNull();
  });
});
