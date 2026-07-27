import { describe, expect, it } from "vitest";
import {
  INITIAL_VISIBLE_SIDEBAR_ITEMS,
  resolveLimitedSidebarGroup,
} from "./use-limited-sidebar-group";

describe("resolveLimitedSidebarGroup", () => {
  it("renders at most 20 rows before expansion and all rows afterwards", () => {
    const items = Array.from({ length: 27 }, (_, index) => index);

    const limited = resolveLimitedSidebarGroup(items, false);
    const expanded = resolveLimitedSidebarGroup(items, true);

    expect(limited.visibleItems).toEqual(items.slice(0, INITIAL_VISIBLE_SIDEBAR_ITEMS));
    expect(limited.canToggle).toBe(true);
    expect(expanded.visibleItems).toEqual(items);
    expect(expanded.canToggle).toBe(true);
  });

  it("does not expose a toggle for a small group", () => {
    expect(resolveLimitedSidebarGroup([1, 2], false).canToggle).toBe(false);
  });
});
