export function resolveDesktopSidebarPresentation(active: boolean) {
  return {
    hidden: !active,
    pointerEvents: active ? ("auto" as const) : ("none" as const),
    accessibilityElementsHidden: !active,
    importantForAccessibility: active ? ("auto" as const) : ("no-hide-descendants" as const),
  };
}
