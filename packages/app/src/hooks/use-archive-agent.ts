import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { agentHistoryQueryKey, allAgentHistoryQueryRootKey } from "./agent-history-query-key";
import {
  ARCHIVE_AGENT_PENDING_QUERY_KEY,
  applyArchivedAgentCloseResults,
  clearArchiveAgentPending,
  selectPendingArchiveAgentIds,
  setAgentArchiving,
  toArchiveKey,
  type ArchiveAgentInput,
  type ArchiveAgentPendingState,
} from "@/query/agent-archive-state";

function useArchiveAgentPendingQuery() {
  return useQuery({
    queryKey: ARCHIVE_AGENT_PENDING_QUERY_KEY,
    queryFn: async (): Promise<ArchiveAgentPendingState> => ({}),
    initialData: {} as ArchiveAgentPendingState,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function usePendingArchiveAgentIds(serverId: string): ReadonlySet<string> {
  const pendingQuery = useArchiveAgentPendingQuery();
  return useMemo(
    () => selectPendingArchiveAgentIds(pendingQuery.data ?? {}, serverId),
    [pendingQuery.data, serverId],
  );
}

export function useArchiveAgent() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const pendingQuery = useArchiveAgentPendingQuery();

  const archiveMutation = useMutation({
    mutationFn: async (input: ArchiveAgentInput): Promise<{ archivedAt: string }> => {
      const client = getHostRuntimeStore().getClient(input.serverId);
      if (!client) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      return await client.archiveAgent(input.agentId);
    },
    onMutate: (input) => {
      setAgentArchiving({
        queryClient,
        serverId: input.serverId,
        agentId: input.agentId,
        isArchiving: true,
      });
    },
    onSuccess: (result, input) => {
      applyArchivedAgentCloseResults({
        queryClient,
        serverId: input.serverId,
        results: [{ agentId: input.agentId, archivedAt: result.archivedAt }],
        invalidateQueries: false,
      });
    },
    onSettled: (_result, _error, input) => {
      clearArchiveAgentPending({
        queryClient,
        serverId: input.serverId,
        agentId: input.agentId,
      });
      void queryClient.invalidateQueries({
        queryKey: ["sidebarAgentsList", input.serverId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["allAgents", input.serverId],
      });
      void queryClient.invalidateQueries({
        queryKey: agentHistoryQueryKey(input.serverId),
      });
      void queryClient.invalidateQueries({
        queryKey: allAgentHistoryQueryRootKey(),
      });
    },
  });

  const archiveMutateAsync = archiveMutation.mutateAsync;

  const archiveAgent = useCallback(
    async (input: ArchiveAgentInput): Promise<void> => {
      await archiveMutateAsync(input);
    },
    [archiveMutateAsync],
  );

  const isArchivingAgent = useCallback(
    (input: ArchiveAgentInput): boolean => {
      const key = toArchiveKey(input);
      if (!key) {
        return false;
      }
      return (pendingQuery.data ?? {})[key] ?? false;
    },
    [pendingQuery.data],
  );

  return {
    archiveAgent,
    isArchivingAgent,
  };
}
