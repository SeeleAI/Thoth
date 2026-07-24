import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceDescriptor } from "@/projection/authority-model";
import { normalizeWorkspaceOpaqueId, normalizeWorkspacePath } from "@/utils/workspace-identity";

export interface PendingWorkspaceArchive {
  workspaceId: string;
  workspaceDirectory: string | null;
}

export type WorkspaceArchivePendingState = Record<string, PendingWorkspaceArchive>;

export function workspaceArchivePendingQueryKey(serverId: string) {
  return ["workspace-archive-pending", serverId.trim()] as const;
}

export function readWorkspaceArchivePendingState(
  queryClient: QueryClient,
  serverId: string,
): WorkspaceArchivePendingState {
  return (
    queryClient.getQueryData<WorkspaceArchivePendingState>(
      workspaceArchivePendingQueryKey(serverId),
    ) ?? {}
  );
}

export function markWorkspaceArchivePending(input: {
  queryClient: QueryClient;
  serverId: string;
  workspaceId: string;
  workspaceDirectory?: string | null;
}): void {
  const serverId = input.serverId.trim();
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if (!serverId || !workspaceId) return;
  input.queryClient.setQueryData<WorkspaceArchivePendingState>(
    workspaceArchivePendingQueryKey(serverId),
    (current) => ({
      ...(current ?? {}),
      [workspaceId]: {
        workspaceId,
        workspaceDirectory: normalizeWorkspacePath(input.workspaceDirectory),
      },
    }),
  );
}

export function clearWorkspaceArchivePending(input: {
  queryClient: QueryClient;
  serverId: string;
  workspaceId: string;
}): void {
  const serverId = input.serverId.trim();
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if (!serverId || !workspaceId) return;
  input.queryClient.setQueryData<WorkspaceArchivePendingState>(
    workspaceArchivePendingQueryKey(serverId),
    (current) => {
      if (!current?.[workspaceId]) return current ?? {};
      const next = { ...current };
      delete next[workspaceId];
      return next;
    },
  );
}

export function isWorkspaceArchivePending(input: {
  queryClient: QueryClient;
  serverId: string;
  workspaceId?: string | null;
  workspaceDirectory?: string | null;
}): boolean {
  const serverId = input.serverId.trim();
  if (!serverId) return false;
  const pending = readWorkspaceArchivePendingState(input.queryClient, serverId);
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if (workspaceId && pending[workspaceId]) return true;
  const workspaceDirectory = normalizeWorkspacePath(input.workspaceDirectory);
  return workspaceDirectory
    ? Object.values(pending).some((archive) => archive.workspaceDirectory === workspaceDirectory)
    : false;
}

export function shouldSuppressWorkspaceForLocalArchive(input: {
  queryClient: QueryClient;
  serverId: string;
  workspace: WorkspaceDescriptor;
}): boolean {
  return isWorkspaceArchivePending({
    queryClient: input.queryClient,
    serverId: input.serverId,
    workspaceId: input.workspace.id,
    workspaceDirectory: input.workspace.workspaceDirectory,
  });
}
