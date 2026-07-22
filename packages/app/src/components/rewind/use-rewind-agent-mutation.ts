import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import type { DaemonClient } from "@thoth/client/internal/daemon-client";
import type { RewindMode } from "./use-rewind-capabilities";
import { useRewindComposerRestore } from "./composer-restore";
import { useSessionStore } from "@/stores/session-store";
import { shouldRestoreComposerForRewindMode } from "./rewind-mode";
import { clearOptimisticUserMessages } from "@/types/stream";

interface UseRewindAgentMutationInput {
  serverId?: string;
  agentId?: string;
  messageId?: string;
  client?: DaemonClient | null;
}

interface RewindAgentInput {
  mode: RewindMode;
  rewoundText: string;
}

export function useRewindAgentMutation(input: UseRewindAgentMutationInput): {
  rewindAgent: (input: RewindAgentInput) => Promise<void>;
  isPending: boolean;
} {
  const toast = useToast();
  const { t } = useTranslation();
  const composerRestore = useRewindComposerRestore();
  const { isPending, mutateAsync } = useMutation({
    mutationFn: async ({ mode }: RewindAgentInput) => {
      if (!input.client || !input.agentId || !input.messageId) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const rewind = await input.client.rewindAgent(input.agentId, input.messageId, mode);
      if (mode !== "files") {
        if (input.serverId) {
          const session = useSessionStore.getState().sessions[input.serverId];
          useSessionStore.getState().setAgentStreamState(input.serverId, input.agentId, {
            tail: rewind.reset
              ? []
              : clearOptimisticUserMessages(session?.agentStreamTail.get(input.agentId) ?? []),
            head: rewind.reset
              ? []
              : clearOptimisticUserMessages(session?.agentStreamHead.get(input.agentId) ?? []),
          });
          if (rewind.reset) {
            useSessionStore.getState().setAgentTimelineCursor(input.serverId, (previous) => {
              const next = new Map(previous);
              next.delete(input.agentId!);
              return next;
            });
          }
        }
        await input.client.fetchAgentTimeline(input.agentId, {
          direction: "tail",
          projection: "projected",
        });
      }
    },
    onSuccess: (_data, variables) => {
      if (!shouldRestoreComposerForRewindMode(variables.mode)) {
        return;
      }
      composerRestore?.restoreTextIfComposerEmpty(variables.rewoundText);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("rewind.errors.failed"));
    },
  });

  const rewindAgent = useCallback(
    async (rewindInput: RewindAgentInput) => {
      if (isPending) {
        return;
      }
      await mutateAsync(rewindInput);
    },
    [isPending, mutateAsync],
  );

  return {
    rewindAgent,
    isPending,
  };
}
