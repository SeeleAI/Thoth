import type { QueryClient } from "@tanstack/react-query";
import { agentHistoryQueryKey, allAgentHistoryQueryRootKey } from "@/hooks/agent-history-query-key";

export const ARCHIVE_AGENT_PENDING_QUERY_KEY = ["archive-agent-pending"] as const;

export interface ArchiveAgentInput {
  serverId: string;
  agentId: string;
}

export type ArchiveAgentPendingState = Record<string, true>;

interface SetAgentArchivingInput extends ArchiveAgentInput {
  queryClient: QueryClient;
  isArchiving: boolean;
}

interface IsAgentArchivingInput extends ArchiveAgentInput {
  queryClient: QueryClient;
}

export interface AgentsListQueryData {
  entries?: Array<{ agent?: { id?: string | null } | null } | null>;
}

export interface AgentHistoryQueryAgent {
  id?: string | null;
  serverId?: string | null;
  archivedAt?: Date | null;
}

export interface AgentHistoryQueryPage {
  agents?: AgentHistoryQueryAgent[];
}

export interface AgentHistoryQueryData {
  pages?: AgentHistoryQueryPage[];
}

export function toArchiveKey(input: ArchiveAgentInput): string {
  const serverId = input.serverId.trim();
  const agentId = input.agentId.trim();
  return serverId && agentId ? `${serverId}:${agentId}` : "";
}

export function readPendingState(queryClient: QueryClient): ArchiveAgentPendingState {
  return queryClient.getQueryData<ArchiveAgentPendingState>(ARCHIVE_AGENT_PENDING_QUERY_KEY) ?? {};
}

export function selectPendingArchiveAgentIds(
  pendingState: ArchiveAgentPendingState,
  serverId: string,
): ReadonlySet<string> {
  const prefix = `${serverId.trim()}:`;
  if (prefix === ":") return new Set();
  const agentIds = Object.keys(pendingState)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .filter(Boolean);
  return new Set(agentIds);
}

export function setAgentArchiving(input: SetAgentArchivingInput): void {
  const key = toArchiveKey(input);
  if (!key) return;
  input.queryClient.setQueryData<ArchiveAgentPendingState>(
    ARCHIVE_AGENT_PENDING_QUERY_KEY,
    (current) => {
      const state = current ?? {};
      if (input.isArchiving) return state[key] ? state : { ...state, [key]: true };
      if (!state[key]) return state;
      const next = { ...state };
      delete next[key];
      return next;
    },
  );
}

export function isAgentArchiving(input: IsAgentArchivingInput): boolean {
  const key = toArchiveKey(input);
  return key ? (readPendingState(input.queryClient)[key] ?? false) : false;
}

export function clearArchiveAgentPending(input: IsAgentArchivingInput): void {
  setAgentArchiving({ ...input, isArchiving: false });
}

export function removeAgentFromListPayload<T extends AgentsListQueryData | undefined>(
  payload: T,
  agentId: string,
): T {
  if (!payload || !Array.isArray(payload.entries) || !agentId) return payload;
  const entries = payload.entries.filter((entry) => entry?.agent?.id !== agentId);
  return entries.length === payload.entries.length ? payload : ({ ...payload, entries } as T);
}

export function removeAgentFromCachedLists(
  queryClient: QueryClient,
  input: ArchiveAgentInput,
): void {
  const agentId = input.agentId.trim();
  if (!agentId) return;
  for (const queryKey of [
    ["sidebarAgentsList", input.serverId],
    ["allAgents", input.serverId],
  ] as const) {
    queryClient.setQueryData<AgentsListQueryData | undefined>(queryKey, (current) =>
      removeAgentFromListPayload(current, agentId),
    );
  }
}

export function markAgentArchivedInHistoryPayload<T extends AgentHistoryQueryData | undefined>(
  payload: T,
  input: ArchiveAgentInput & { archivedAt: string },
): T {
  if (!payload || !Array.isArray(payload.pages) || !input.agentId) return payload;
  const archivedAt = new Date(input.archivedAt);
  if (Number.isNaN(archivedAt.getTime())) return payload;
  let changed = false;
  const pages = payload.pages.map((page) => {
    if (!Array.isArray(page.agents)) return page;
    let pageChanged = false;
    const agents = page.agents.map((agent) => {
      if (
        agent.id !== input.agentId ||
        (agent.serverId != null && agent.serverId !== input.serverId)
      ) {
        return agent;
      }
      changed = true;
      pageChanged = true;
      return { ...agent, archivedAt };
    });
    return pageChanged ? { ...page, agents } : page;
  });
  return changed ? ({ ...payload, pages } as T) : payload;
}

export function markAgentArchivedInHistoryCache(
  queryClient: QueryClient,
  input: ArchiveAgentInput & { archivedAt: string },
): void {
  queryClient.setQueryData<AgentHistoryQueryData | undefined>(
    agentHistoryQueryKey(input.serverId),
    (current) => markAgentArchivedInHistoryPayload(current, input),
  );
  queryClient.setQueriesData<AgentHistoryQueryData | undefined>(
    { queryKey: allAgentHistoryQueryRootKey() },
    (current) => markAgentArchivedInHistoryPayload(current, input),
  );
}

export interface ArchivedAgentCloseResult {
  agentId: string;
  archivedAt: string;
}

export function applyArchivedAgentCloseResults(input: {
  queryClient: QueryClient;
  serverId: string;
  results: ArchivedAgentCloseResult[];
  invalidateQueries?: boolean;
}): void {
  if (input.results.length === 0) return;
  for (const result of input.results) {
    removeAgentFromCachedLists(input.queryClient, {
      serverId: input.serverId,
      agentId: result.agentId,
    });
    markAgentArchivedInHistoryCache(input.queryClient, {
      serverId: input.serverId,
      agentId: result.agentId,
      archivedAt: result.archivedAt,
    });
  }
  if (input.invalidateQueries ?? true) {
    for (const queryKey of [
      ["sidebarAgentsList", input.serverId],
      ["allAgents", input.serverId],
      agentHistoryQueryKey(input.serverId),
      allAgentHistoryQueryRootKey(),
    ]) {
      void input.queryClient.invalidateQueries({ queryKey });
    }
  }
}
