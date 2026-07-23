import { lazy, Suspense } from "react";
import type { ExplorerSidebarProps } from "@/components/explorer-sidebar";
import { selectIsFileExplorerOpen, usePanelStore } from "@/stores/panel-store";

const DesktopExplorerSidebar = lazy(() =>
  import("@/components/explorer-sidebar").then((module) => ({
    default: module.ExplorerSidebar,
  })),
);
const CompactExplorerSidebar = lazy(() =>
  import("@/components/explorer-sidebar").then((module) => ({
    default: module.CompactExplorerSidebar,
  })),
);

export function LazyExplorerSidebar(props: ExplorerSidebarProps) {
  const isOpen = usePanelStore((state) => selectIsFileExplorerOpen(state, { isCompact: false }));
  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      <DesktopExplorerSidebar {...props} />
    </Suspense>
  );
}

export function LazyCompactExplorerSidebar(props: ExplorerSidebarProps) {
  const isOpen = usePanelStore((state) => selectIsFileExplorerOpen(state, { isCompact: true }));
  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      <CompactExplorerSidebar {...props} />
    </Suspense>
  );
}
