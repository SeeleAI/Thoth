import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ToastApi } from "@/components/toast-host";
import { useAuthorityProjection, useProjectionRuntime } from "@/projection/projection-context";

export function useLoadOlderAgentHistory({
  serverId,
  agentId,
  toast,
}: {
  serverId: string;
  agentId: string;
  toast?: ToastApi | null;
}) {
  const { t } = useTranslation();
  const runtime = useProjectionRuntime();
  const timeline = useAuthorityProjection(serverId, (projection) =>
    projection.timelines.get(agentId),
  );
  const loadOlder = useCallback(() => {
    void runtime
      .service(serverId)
      ?.fetchOlder(agentId)
      .catch((error) => {
        console.warn("[Timeline] failed to load older agent history", agentId, error);
        toast?.show(t("loadOlderHistory.failed"), {
          durationMs: 2200,
          testID: "agent-load-older-history-toast",
        });
      });
  }, [agentId, runtime, serverId, t, toast]);

  return {
    isLoadingOlder: timeline?.loadingOlder ?? false,
    hasOlder: timeline?.hasOlder ?? false,
    progressKey:
      timeline?.epoch && timeline.startCursor
        ? `${timeline.epoch}:${timeline.startCursor.seq}`
        : null,
    loadOlder,
  };
}
