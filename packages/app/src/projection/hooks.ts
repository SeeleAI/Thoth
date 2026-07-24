import { useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useAuthorityProjection, useAuthorityProjections } from "./projection-context";
import {
  composeWorkspaceStructure,
  selectHasWorkspaces,
  selectProjectOrder,
  selectRecommendedProjectPaths,
  selectWorkspace,
  selectWorkspaceDirectory,
  selectWorkspaceFields,
  selectWorkspaceKeys,
  selectWorkspaceOrderByScope,
  selectWorkspaceStatusesForBadges,
  selectWorkspaceStructureProjects,
  workspaceEqualityFns,
  type WorkspaceStructure,
} from "./workspace-selectors";
import type { WorkspaceDescriptor } from "./authority-model";
import type { DesktopBadgeWorkspaceStatus } from "@/utils/desktop-badge-state";

export type {
  DesktopBadgeWorkspaceStatus,
  WorkspaceStructure,
  WorkspaceStructureProject,
} from "./workspace-selectors";

export function useWorkspace(
  serverId: string | null,
  workspaceId: string | null,
): WorkspaceDescriptor | null {
  return useAuthorityProjection(serverId ?? "", (projection) => {
    return serverId ? selectWorkspace(projection, workspaceId) : null;
  });
}

export function useWorkspaceFields<T>(
  serverId: string | null,
  workspaceId: string | null,
  project: (workspace: WorkspaceDescriptor) => T,
): T | null {
  return useAuthorityProjection(
    serverId ?? "",
    (projection) => (serverId ? selectWorkspaceFields(projection, workspaceId, project) : null),
    workspaceEqualityFns.deep,
  );
}

export function useWorkspaceExists(serverId: string | null, workspaceId: string | null): boolean {
  return useWorkspace(serverId, workspaceId) !== null;
}

export function useHasHydratedAgents(serverId: string | null): boolean {
  return useAuthorityProjection(serverId ?? "", (projection) =>
    Boolean(serverId && projection.hydration.agents === "ready"),
  );
}

export function useHasHydratedWorkspaces(serverId: string | null): boolean {
  return useAuthorityProjection(serverId ?? "", (projection) =>
    Boolean(serverId && projection.hydration.workspaces === "ready"),
  );
}

export function useWorkspaceDirectory(
  serverId: string | null,
  workspaceId: string | null,
): string | null {
  return useAuthorityProjection(serverId ?? "", (projection) =>
    serverId ? selectWorkspaceDirectory(projection, workspaceId) : null,
  );
}

export function useWorkspaceStructure(serverIds: string[]): WorkspaceStructure {
  const projects = useAuthorityProjections((store) => {
    return selectWorkspaceStructureProjects(store, serverIds);
  }, workspaceEqualityFns.deep);
  const projectOrder = useStoreWithEqualityFn(
    useSidebarOrderStore,
    selectProjectOrder,
    workspaceEqualityFns.deep,
  );
  const workspaceOrderByScope = useStoreWithEqualityFn(
    useSidebarOrderStore,
    selectWorkspaceOrderByScope,
    workspaceEqualityFns.deep,
  );
  return useMemo(
    () => composeWorkspaceStructure({ projects, projectOrder, workspaceOrderByScope }),
    [projectOrder, projects, workspaceOrderByScope],
  );
}

export function useWorkspaceKeys(serverId: string | null): string[] {
  return useAuthorityProjection(
    serverId ?? "",
    (projection) => (serverId ? selectWorkspaceKeys(projection) : []),
    workspaceEqualityFns.deep,
  );
}

export function useRecommendedProjectPaths(serverId: string | null): string[] {
  return useAuthorityProjection(
    serverId ?? "",
    (projection) => (serverId ? selectRecommendedProjectPaths(projection) : []),
    workspaceEqualityFns.deep,
  );
}

export function useHasWorkspaces(serverId: string | null): boolean {
  return useAuthorityProjection(serverId ?? "", (projection) =>
    Boolean(serverId && selectHasWorkspaces(projection)),
  );
}

export function useWorkspaceStatusesForBadges(): DesktopBadgeWorkspaceStatus[] {
  return useAuthorityProjections(selectWorkspaceStatusesForBadges, workspaceEqualityFns.deep);
}
