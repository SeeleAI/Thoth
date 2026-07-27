import { useCallback, useMemo, useState } from "react";

export const INITIAL_VISIBLE_SIDEBAR_ITEMS = 20;

export function resolveLimitedSidebarGroup<T>(
  items: readonly T[],
  expanded: boolean,
): {
  visibleItems: T[];
  canToggle: boolean;
} {
  return {
    visibleItems: expanded ? items.slice() : items.slice(0, INITIAL_VISIBLE_SIDEBAR_ITEMS),
    canToggle: items.length > INITIAL_VISIBLE_SIDEBAR_ITEMS,
  };
}

export function useLimitedSidebarGroup<T>(items: readonly T[]) {
  const [expanded, setExpanded] = useState(false);
  const { visibleItems, canToggle } = useMemo(
    () => resolveLimitedSidebarGroup(items, expanded),
    [expanded, items],
  );
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);

  return { visibleItems, expanded, canToggle, toggleExpanded };
}
