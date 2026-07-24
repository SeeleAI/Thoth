import {
  clearWorkspaceArchivePending,
  markWorkspaceArchivePending,
} from "@/query/workspace-archive-state";
import type { QueryClient } from "@tanstack/react-query";
import { i18n } from "@/i18n/i18next";

export interface WorkspaceArchiveTarget {
  serverId: string;
  workspaceId: string;
  workspaceDirectory?: string | null;
}

interface WorkspaceArchiveClient {
  archiveWorkspace: (workspaceId: string) => Promise<{ error: string | null }>;
}

export interface WorkspaceArchiveFailure {
  serverId: string;
  workspaceId: string;
  error: unknown;
}

function isWorkspaceArchiveFailure(error: unknown): error is WorkspaceArchiveFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    "serverId" in error &&
    typeof error.serverId === "string" &&
    "workspaceId" in error &&
    typeof error.workspaceId === "string" &&
    "error" in error
  );
}

function hideWorkspaceOptimistically(
  queryClient: QueryClient,
  workspace: WorkspaceArchiveTarget,
): void {
  markWorkspaceArchivePending({
    queryClient,
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
    workspaceDirectory: workspace.workspaceDirectory,
  });
}

function restoreOptimisticallyHiddenWorkspace(input: {
  queryClient: QueryClient;
  serverId: string;
  workspaceId: string;
}): void {
  clearWorkspaceArchivePending({
    queryClient: input.queryClient,
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
}

async function archiveWorkspaceOrThrow(input: {
  client: WorkspaceArchiveClient;
  workspaceId: string;
}): Promise<void> {
  const payload = await input.client.archiveWorkspace(input.workspaceId);
  if (payload.error) {
    throw new Error(payload.error);
  }
}

export async function archiveWorkspaceOptimistically(input: {
  queryClient: QueryClient;
  client: WorkspaceArchiveClient;
  workspace: WorkspaceArchiveTarget;
  afterHide?: () => void;
}): Promise<void> {
  hideWorkspaceOptimistically(input.queryClient, input.workspace);
  input.afterHide?.();

  try {
    await archiveWorkspaceOrThrow({
      client: input.client,
      workspaceId: input.workspace.workspaceId,
    });
  } catch (error) {
    restoreOptimisticallyHiddenWorkspace({
      queryClient: input.queryClient,
      serverId: input.workspace.serverId,
      workspaceId: input.workspace.workspaceId,
    });
    throw error;
  }
}

export async function archiveWorkspacesOptimistically(input: {
  queryClient: QueryClient;
  getClient: (serverId: string) => WorkspaceArchiveClient | null;
  workspaces: WorkspaceArchiveTarget[];
}): Promise<WorkspaceArchiveFailure[]> {
  const results = await Promise.allSettled(
    input.workspaces.map(async (workspace) => {
      const client = input.getClient(workspace.serverId);
      if (!client) {
        throw {
          serverId: workspace.serverId,
          workspaceId: workspace.workspaceId,
          error: new Error(i18n.t("sidebar.workspace.toasts.hostDisconnected")),
        } satisfies WorkspaceArchiveFailure;
      }

      try {
        await archiveWorkspaceOptimistically({
          queryClient: input.queryClient,
          client,
          workspace,
        });
      } catch (error) {
        throw {
          serverId: workspace.serverId,
          workspaceId: workspace.workspaceId,
          error,
        } satisfies WorkspaceArchiveFailure;
      }
    }),
  );

  return results.flatMap((result) =>
    result.status === "rejected" && isWorkspaceArchiveFailure(result.reason) ? [result.reason] : [],
  );
}
