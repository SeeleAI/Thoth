import { describe, expect, it } from "vitest";
import { resolveDesktopSidebarPresentation } from "./desktop-sidebar-presentation";

describe("resolveDesktopSidebarPresentation", () => {
  it("keeps the tree mountable while removing hidden desktop sidebar interaction", () => {
    expect(resolveDesktopSidebarPresentation(false)).toEqual({
      hidden: true,
      pointerEvents: "none",
      accessibilityElementsHidden: true,
      importantForAccessibility: "no-hide-descendants",
    });
    expect(resolveDesktopSidebarPresentation(true)).toEqual({
      hidden: false,
      pointerEvents: "auto",
      accessibilityElementsHidden: false,
      importantForAccessibility: "auto",
    });
  });
});
