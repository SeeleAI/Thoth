import equal from "fast-deep-equal";
import type { WorkspaceStructure, WorkspaceStructureProject } from "@/projects/workspace-structure";
import { buildWorkspaceStructureProjects } from "@/projects/workspace-structure";
import type { AuthorityProjection, AuthorityProjectionStore } from "./authority-projection";
import type { WorkspaceDescriptor } from "./authority-model";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import type { DesktopBadgeWorkspaceStatus } from "@/utils/desktop-badge-state";

export type { DesktopBadgeWorkspaceStatus } from "@/utils/desktop-badge-state";
export type { WorkspaceStructure, WorkspaceStructureProject } from "@/projects/workspace-structure";

export interface SidebarOrderSnapshot {
  projectOrder: string[];
  workspaceOrderByProject: Record<string, string[]>;
}

const EMPTY_KEYS: string[] = [];
const EMPTY_STRUCTURE: WorkspaceStructure = { projects: [] };

export const workspaceEqualityFns = {
  identity: Object.is as (left: unknown, right: unknown) => boolean,
  deep: equal as (left: unknown, right: unknown) => boolean,
};

export function selectWorkspace(
  projection: AuthorityProjection,
  workspaceId: string | null | undefined,
): WorkspaceDescriptor | null {
  if (!workspaceId) return null;
  const key = resolveWorkspaceMapKeyByIdentity({
    workspaces: projection.workspaces,
    workspaceId,
  });
  return key ? (projection.workspaces.get(key) ?? null) : null;
}

export function selectWorkspaceFields<T>(
  projection: AuthorityProjection,
  workspaceId: string | null | undefined,
  project: (workspace: WorkspaceDescriptor) => T,
): T | null {
  const workspace = selectWorkspace(projection, workspaceId);
  return workspace ? project(workspace) : null;
}

export function selectWorkspaceDirectory(
  projection: AuthorityProjection,
  workspaceId: string | null | undefined,
): string | null {
  return selectWorkspace(projection, workspaceId)?.workspaceDirectory || null;
}

export function selectWorkspaceKeys(projection: AuthorityProjection): string[] {
  return [...projection.workspaces.keys()];
}

export function selectRecommendedProjectPaths(projection: AuthorityProjection): string[] {
  return [...projection.workspaces.values()]
    .map((workspace) => workspace.projectRootPath)
    .filter(Boolean);
}

export function selectHasWorkspaces(projection: AuthorityProjection): boolean {
  return projection.workspaces.size > 0;
}

export function selectWorkspaceStructureProjects(
  store: AuthorityProjectionStore,
  serverIds: readonly string[],
): WorkspaceStructureProject[] {
  const sessions = serverIds.flatMap((serverId) => {
    const projection = store.getSnapshot(serverId);
    return projection.workspaces.size === 0 && projection.emptyProjects.size === 0
      ? []
      : [
          {
            serverId,
            workspaces: projection.workspaces.values(),
            emptyProjects: projection.emptyProjects.values(),
          },
        ];
  });
  return sessions.length > 0 ? buildWorkspaceStructureProjects({ sessions }) : [];
}

export function selectWorkspaceStatusesForBadges(
  store: AuthorityProjectionStore,
): DesktopBadgeWorkspaceStatus[] {
  return store
    .getServerIds()
    .flatMap((serverId) => [...store.getSnapshot(serverId).workspaces.values()])
    .map((workspace) => workspace.status);
}

function applyStoredOrdering<T>(input: {
  items: T[];
  storedOrder: readonly string[];
  getKey: (item: T) => string;
}): T[] {
  if (input.items.length <= 1 || input.storedOrder.length === 0) return input.items;
  const items = new Map(input.items.map((item) => [input.getKey(item), item]));
  const orderedKeys = input.storedOrder.filter(
    (key, index) => items.has(key) && input.storedOrder.indexOf(key) === index,
  );
  if (orderedKeys.length === 0) return input.items;
  const ordered = new Set(orderedKeys);
  let index = 0;
  return input.items.map((item) => {
    if (!ordered.has(input.getKey(item))) return item;
    return items.get(orderedKeys[index++] ?? "") ?? item;
  });
}

export function selectProjectOrder(state: SidebarOrderSnapshot): string[] {
  return state.projectOrder ?? EMPTY_KEYS;
}

export function selectWorkspaceOrderByScope(state: SidebarOrderSnapshot): Record<string, string[]> {
  return state.workspaceOrderByProject ?? {};
}

export function composeWorkspaceStructure(input: {
  projects: WorkspaceStructureProject[];
  projectOrder: readonly string[];
  workspaceOrderByScope: Record<string, readonly string[]>;
}): WorkspaceStructure {
  if (input.projects.length === 0) return EMPTY_STRUCTURE;
  return {
    projects: applyStoredOrdering({
      items: input.projects.map((project) => ({
        ...project,
        workspaceKeys: applyStoredOrdering({
          items: project.workspaceKeys,
          storedOrder: input.workspaceOrderByScope[project.projectKey] ?? EMPTY_KEYS,
          getKey: (key) => key,
        }),
      })),
      storedOrder: input.projectOrder,
      getKey: (project) => project.projectKey,
    }),
  };
}
