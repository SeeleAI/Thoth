import type {
  DaemonClient,
  FetchAgentHistoryEntry,
  FetchAgentHistoryOptions,
} from "@thoth/client/internal/daemon-client";
import {
  normalizeWorkspaceOpaqueId,
  resolveWorkspaceMapKeyByIdentity,
} from "@/utils/workspace-identity";
import type { Agent } from "@/projection/authority-model";
import { appProjectionRuntime } from "@/projection/projection-context";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";

const WORKSPACE_AGENT_HISTORY_PAGE_LIMIT = 200;
const WORKSPACE_AGENT_HISTORY_SORT: NonNullable<FetchAgentHistoryOptions["sort"]> = [
  { key: "updated_at", direction: "desc" },
];

const historyRestoreInFlight = new Map<string, Promise<boolean>>();
const historyRestoreAttempted = new Set<string>();

function restoreKey(serverId: string, workspaceId: string): string {
  return `${serverId}:${workspaceId}`;
}

function resolveWorkspaceIdForSession(input: {
  serverId: string;
  workspaceId: string;
}): string | null {
  const projection = appProjectionRuntime.store.getSnapshot(input.serverId);
  return (
    resolveWorkspaceMapKeyByIdentity({
      workspaces: projection.workspaces,
      workspaceId: input.workspaceId,
    }) ?? normalizeWorkspaceOpaqueId(input.workspaceId)
  );
}

function workspaceIdsMatch(
  agentWorkspaceId: string | null | undefined,
  workspaceId: string,
): boolean {
  return normalizeWorkspaceOpaqueId(agentWorkspaceId) === workspaceId;
}

function compareAgentActivityDescending(a: Agent, b: Agent): number {
  return b.lastActivityAt.getTime() - a.lastActivityAt.getTime();
}

function selectLatestAgentForWorkspace(input: {
  serverId: string;
  workspaceId: string;
}): Agent | null {
  const candidates: Agent[] = [];
  for (const agent of appProjectionRuntime.store.getSnapshot(input.serverId).agents.values()) {
    if (workspaceIdsMatch(agent.workspaceId, input.workspaceId) && !agent.archivedAt) {
      candidates.push(agent);
    }
  }

  return candidates.sort(compareAgentActivityDescending)[0] ?? null;
}

function focusWorkspaceAgentTab(input: {
  serverId: string;
  workspaceId: string;
  agentId: string;
}): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return false;
  }

  const layoutStore = useWorkspaceLayoutStore.getState();
  layoutStore.retainRestoredAgent(workspaceKey, input.agentId);
  return (
    layoutStore.openTabFocused(workspaceKey, {
      kind: "agent",
      agentId: input.agentId,
    }) !== null
  );
}

function upsertHistoryEntries(input: {
  serverId: string;
  entries: FetchAgentHistoryEntry[];
}): Agent[] {
  if (input.entries.length === 0) {
    return [];
  }

  const service = appProjectionRuntime.service(input.serverId);
  if (!service) throw new Error("Projection service is not attached");
  return input.entries.map((entry) => service.acceptAgentSnapshot(entry.agent, entry.project));
}

async function fetchWorkspaceHistoryAgent(input: {
  serverId: string;
  workspaceId: string;
  client: Pick<DaemonClient, "fetchAgentHistory">;
}): Promise<Agent | null> {
  const payload = await input.client.fetchAgentHistory({
    sort: WORKSPACE_AGENT_HISTORY_SORT,
    page: { limit: WORKSPACE_AGENT_HISTORY_PAGE_LIMIT },
  });
  const matchingEntries = payload.entries.filter((entry) =>
    workspaceIdsMatch(entry.agent.workspaceId, input.workspaceId),
  );
  const restoredAgents = upsertHistoryEntries({
    serverId: input.serverId,
    entries: matchingEntries,
  });
  return (
    restoredAgents.filter((agent) => !agent.archivedAt).sort(compareAgentActivityDescending)[0] ??
    null
  );
}

export async function restoreWorkspaceAgentTabFromHistory(input: {
  serverId: string;
  workspaceId: string;
  client?: Pick<DaemonClient, "fetchAgentHistory"> | null;
  force?: boolean;
}): Promise<boolean> {
  const resolvedWorkspaceId = resolveWorkspaceIdForSession({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!resolvedWorkspaceId) {
    return false;
  }

  const key = restoreKey(input.serverId, resolvedWorkspaceId);
  const knownAgent = selectLatestAgentForWorkspace({
    serverId: input.serverId,
    workspaceId: resolvedWorkspaceId,
  });
  if (knownAgent) {
    historyRestoreAttempted.add(key);
    return focusWorkspaceAgentTab({
      serverId: input.serverId,
      workspaceId: resolvedWorkspaceId,
      agentId: knownAgent.id,
    });
  }

  if (!input.client) {
    return false;
  }
  if (!input.force && historyRestoreAttempted.has(key)) {
    return false;
  }

  const existing = historyRestoreInFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    historyRestoreAttempted.add(key);
    const historyAgent = await fetchWorkspaceHistoryAgent({
      serverId: input.serverId,
      workspaceId: resolvedWorkspaceId,
      client: input.client!,
    });
    if (!historyAgent) {
      return false;
    }
    return focusWorkspaceAgentTab({
      serverId: input.serverId,
      workspaceId: resolvedWorkspaceId,
      agentId: historyAgent.id,
    });
  })().finally(() => {
    historyRestoreInFlight.delete(key);
  });

  historyRestoreInFlight.set(key, promise);
  return promise;
}

export function resetWorkspaceAgentHistoryRestoreForTests(): void {
  historyRestoreInFlight.clear();
  historyRestoreAttempted.clear();
}
