import { router, type Href } from "expo-router";
import { appProjectionRuntime } from "@/projection/projection-context";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { queryClient } from "@/query/query-client";
import {
  readWorkspaceRestoreStatus,
  setWorkspaceRestoreStatus,
} from "@/query/workspace-restore-state";
import { resolveNavigateToAgent, type NavigateToAgentInput } from "./resolve";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";

export type { NavigateToAgentInput } from "./resolve";

// Clears the transient restoring state if the daemon resolves refreshAgent without
// re-emitting a workspace_update (the directory-gone case), so the gate never spins
// forever. Recreating a worktree can require a git fetch, so the budget is generous
// to avoid flashing a false "failed" on a capable daemon doing slow real work.
const RESTORE_TIMEOUT_MS = 30000;

function restoreArchivedWorkspace(serverId: string, agentId: string, workspaceId: string): void {
  const snapshot = getHostRuntimeStore().getSnapshot(serverId);
  const client = snapshot?.client ?? null;
  if (!snapshot || !client || !isHostRuntimeConnected(snapshot)) {
    return;
  }

  const projection = appProjectionRuntime.store.getSnapshot(serverId);
  // Self-gate: only an archived agent whose workspace is absent needs restoring.
  // A still-present workspace or an in-flight restore is a no-op; fire-once is
  // derived from store state.
  const agent = projection.agents.get(agentId);
  if (!agent?.archivedAt) {
    return;
  }
  if (projection.workspaces.has(workspaceId)) {
    return;
  }
  if (readWorkspaceRestoreStatus(queryClient, serverId, workspaceId) === "restoring") {
    return;
  }

  // COMPAT(worktreeRestore): added in v0.1.97, drop the gate when floor >= v0.1.97
  // Single capability read for restore. An old daemon recreates nothing on
  // refresh_agent, so a gone directory would spin then flash a misleading
  // "couldn't restore". Surface an explicit "update your host" state instead.
  if (snapshot.serverInfo?.features?.worktreeRestore !== true) {
    setWorkspaceRestoreStatus(queryClient, serverId, workspaceId, "needs-host-upgrade");
    return;
  }

  setWorkspaceRestoreStatus(queryClient, serverId, workspaceId, "restoring");
  // The reducer guards "failed" so a late timeout after the descriptor lands is a no-op.
  setTimeout(() => {
    if (readWorkspaceRestoreStatus(queryClient, serverId, workspaceId) === "restoring") {
      setWorkspaceRestoreStatus(queryClient, serverId, workspaceId, "failed");
    }
  }, RESTORE_TIMEOUT_MS);
  client
    .refreshAgent(agentId)
    .catch(() => setWorkspaceRestoreStatus(queryClient, serverId, workspaceId, "failed"));
}

export function navigateToAgent(input: NavigateToAgentInput): string {
  return resolveNavigateToAgent(input, {
    readAgentNavTarget: ({ serverId, agentId }) => {
      const agent = appProjectionRuntime.store.getSnapshot(serverId).agents.get(agentId);
      return {
        agentWorkspaceId: agent?.workspaceId,
      };
    },
    navigateToHostAgent: (route) => {
      router.navigate(route as Href);
    },
    navigateToPreparedWorkspaceTab,
    restoreArchivedWorkspace: ({ serverId, agentId, workspaceId }) => {
      restoreArchivedWorkspace(serverId, agentId, workspaceId);
    },
  });
}
