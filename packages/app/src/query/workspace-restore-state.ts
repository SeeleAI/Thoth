import { useQuery, type QueryClient } from "@tanstack/react-query";

export type WorkspaceRestoreStatus = "restoring" | "failed" | "needs-host-upgrade";

export function workspaceRestoreQueryKey(serverId: string, workspaceId: string) {
  return ["workspace-restore", serverId, workspaceId] as const;
}

export function readWorkspaceRestoreStatus(
  queryClient: QueryClient,
  serverId: string,
  workspaceId: string,
): WorkspaceRestoreStatus | null {
  return (
    queryClient.getQueryData<WorkspaceRestoreStatus>(
      workspaceRestoreQueryKey(serverId, workspaceId),
    ) ?? null
  );
}

export function setWorkspaceRestoreStatus(
  queryClient: QueryClient,
  serverId: string,
  workspaceId: string,
  status: WorkspaceRestoreStatus | null,
): void {
  queryClient.setQueryData(workspaceRestoreQueryKey(serverId, workspaceId), status);
}

export function useWorkspaceRestoreStatus(
  serverId: string | null,
  workspaceId: string | null,
): WorkspaceRestoreStatus | null {
  return useQuery({
    queryKey: workspaceRestoreQueryKey(serverId ?? "", workspaceId ?? ""),
    queryFn: async () => null,
    initialData: null as WorkspaceRestoreStatus | null,
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: Boolean(serverId && workspaceId),
  }).data;
}
