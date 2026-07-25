import { describe, expect, it } from "vitest";
import { computeFloatingPosition, type FloatingRect } from "./floating-core";

const DISPLAY: FloatingRect = { x: 0, y: 0, width: 400, height: 300 };

describe("computeFloatingPosition", () => {
  it("aligns a bottom surface with its trigger", () => {
    expect(
      computeFloatingPosition({
        triggerRect: { x: 80, y: 40, width: 120, height: 30 },
        contentSize: { width: 160, height: 100 },
        displayArea: DISPLAY,
        side: "bottom",
        align: "start",
        offset: 6,
      }),
    ).toEqual({ x: 80, y: 76, actualSide: "bottom" });
  });

  it("flips vertically when the requested side cannot fit", () => {
    expect(
      computeFloatingPosition({
        triggerRect: { x: 120, y: 250, width: 80, height: 30 },
        contentSize: { width: 120, height: 100 },
        displayArea: DISPLAY,
        side: "bottom",
        align: "center",
        offset: 6,
      }),
    ).toEqual({ x: 100, y: 144, actualSide: "top" });
  });

  it("preserves tooltip cross-axis alignment and horizontal flipping", () => {
    expect(
      computeFloatingPosition({
        triggerRect: { x: 4, y: 100, width: 24, height: 40 },
        contentSize: { width: 100, height: 60 },
        displayArea: DISPLAY,
        side: "left",
        align: "center",
        offset: 6,
      }),
    ).toEqual({ x: 34, y: 90, actualSide: "right" });
  });

  it("preserves dropdown left-side positioning without cross-axis alignment", () => {
    expect(
      computeFloatingPosition({
        triggerRect: { x: 180, y: 100, width: 40, height: 40 },
        contentSize: { width: 100, height: 60 },
        displayArea: DISPLAY,
        side: "left",
        align: "end",
        offset: 6,
        flipHorizontal: false,
        alignHorizontalSides: false,
      }),
    ).toEqual({ x: 74, y: 100, actualSide: "left" });
  });
});
