import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { projectsQueryKey } from "@/hooks/use-projects";
import { useProjectionRuntime } from "@/projection/projection-context";
import { useHostFeature } from "@/runtime/host-features";
import { openProjectDirectly, type OpenProjectResult } from "@/hooks/open-project";

export function useOpenProject(
  serverId: string | null,
): (path: string) => Promise<OpenProjectResult> {
  const normalizedServerId = serverId?.trim() ?? "";
  const client = useHostRuntimeClient(normalizedServerId);
  const isConnected = useHostRuntimeIsConnected(normalizedServerId);
  const queryClient = useQueryClient();
  const projectionRuntime = useProjectionRuntime();
  const canAddProject = useHostFeature(normalizedServerId, "projectAdd");

  return useCallback(
    async (path: string) => {
      const result = await openProjectDirectly({
        serverId: normalizedServerId,
        projectPath: path,
        isConnected,
        canAddProject,
        client,
        revalidate: async () => {
          const service = projectionRuntime.service(normalizedServerId);
          if (!service) throw new Error("Projection service is not attached");
          await service.refreshWorkspaces();
        },
      });
      // The aggregated projects query derives the project list from a fetch
      // that now includes empty projects; refetch so a freshly-added project
      // (no workspace yet) is immediately editable instead of only after a
      // restart.
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: projectsQueryKey });
      }
      return result;
    },
    [canAddProject, client, isConnected, normalizedServerId, projectionRuntime, queryClient],
  );
}
