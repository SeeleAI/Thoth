import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@thoth/client/internal/daemon-client";
import {
  buildAgentAttentionNotificationPayload,
  type AgentAttentionNotificationPayload,
  type NotificationPermissionRequest,
} from "@thoth/protocol/agent-attention-notification";
import { useClientActivity } from "@/hooks/use-client-activity";
import { usePushTokenRegistration } from "@/hooks/use-push-token-registration";
import { prefetchProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeIsConnected, useHostRuntimeServerInfo } from "@/runtime/host-runtime";
import { useProjectionRuntime } from "@/projection/projection-context";
import { useUiPreferencesStore } from "@/stores/ui-preferences-store";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceSetupStore } from "@/stores/workspace-setup-store";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { applyCheckoutStatusUpdateFromEvent } from "@/git/checkout-status-cache";
import { getInitKey, resolveInitDeferred } from "@/utils/agent-initialization";
import { getIsAppActivelyVisible } from "@/utils/app-visibility";
import { isDaemonClientClosedError } from "@/utils/error-messages";
import { sendOsNotification } from "@/utils/os-notifications";

const REVALIDATION_DEBOUNCE_MS = 300;

export interface DaemonProjectionHostProps {
  children: ReactNode;
  serverId: string;
  client: DaemonClient;
}

function latestAssistantText(
  runtime: ReturnType<typeof useProjectionRuntime>,
  serverId: string,
  agentId: string,
): string | null {
  const entries = runtime.store.getSnapshot(serverId).timelines.get(agentId)?.entries ?? [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const item = entries[index]?.item;
    if (item?.type === "assistant_message") return item.text;
  }
  return null;
}

function latestPermission(
  runtime: ReturnType<typeof useProjectionRuntime>,
  serverId: string,
  agentId: string,
): NotificationPermissionRequest | null {
  const pending = runtime.store.getSnapshot(serverId).agents.get(agentId)?.pendingPermissions;
  return (pending?.[pending.length - 1] as NotificationPermissionRequest | undefined) ?? null;
}

export function DaemonProjectionHost({ children, serverId, client }: DaemonProjectionHostProps) {
  const queryClient = useQueryClient();
  const projectionRuntime = useProjectionRuntime();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const serverInfo = useHostRuntimeServerInfo(serverId);
  const focusedAgentId = useUiPreferencesStore(
    (state) => state.focusedAgentByServer.get(serverId) ?? null,
  );
  const focusedTerminalId = useUiPreferencesStore(
    (state) => state.focusedTerminalByServer.get(serverId) ?? null,
  );
  const clearDraftInput = useDraftStore((state) => state.clearDraftInput);
  const upsertWorkspaceSetupProgress = useWorkspaceSetupStore((state) => state.upsertProgress);
  const removeWorkspaceSetup = useWorkspaceSetupStore((state) => state.removeWorkspace);
  const clearWorkspaceSetupServer = useWorkspaceSetupStore((state) => state.clearServer);
  const appStateRef = useRef(AppState.currentState);
  const attentionNotifiedRef = useRef<Map<string, number>>(new Map());
  const revalidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revalidationInFlightRef = useRef<Promise<void> | null>(null);
  const revalidationQueuedRef = useRef(false);
  const hasHydratedConnectionRef = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      appStateRef.current = state;
    });
    return () => subscription.remove();
  }, []);

  const flushRevalidation = useCallback(() => {
    if (!isConnected) return;
    const service = projectionRuntime.service(serverId);
    if (!service) return;
    if (revalidationInFlightRef.current) {
      revalidationQueuedRef.current = true;
      return;
    }
    const run = service
      .revalidate()
      .catch((error) => {
        if (!isDaemonClientClosedError(error)) {
          console.error("[Projection] authoritative revalidation failed", { serverId, error });
        }
      })
      .finally(() => {
        if (revalidationInFlightRef.current === run) revalidationInFlightRef.current = null;
        if (!revalidationQueuedRef.current) return;
        revalidationQueuedRef.current = false;
        revalidationTimerRef.current = setTimeout(() => {
          revalidationTimerRef.current = null;
          flushRevalidation();
        }, REVALIDATION_DEBOUNCE_MS);
      });
    revalidationInFlightRef.current = run;
  }, [isConnected, projectionRuntime, serverId]);

  const scheduleRevalidation = useCallback(() => {
    if (!isConnected) return;
    revalidationQueuedRef.current = true;
    if (revalidationTimerRef.current) return;
    revalidationTimerRef.current = setTimeout(() => {
      revalidationTimerRef.current = null;
      if (!revalidationQueuedRef.current) return;
      revalidationQueuedRef.current = false;
      flushRevalidation();
    }, REVALIDATION_DEBOUNCE_MS);
  }, [flushRevalidation, isConnected]);

  useEffect(() => {
    hasHydratedConnectionRef.current = false;
    return projectionRuntime.attach(client, serverId);
  }, [client, projectionRuntime, serverId]);

  useEffect(() => {
    if (!isConnected) return;
    if (!hasHydratedConnectionRef.current) {
      hasHydratedConnectionRef.current = true;
      flushRevalidation();
      return;
    }
    scheduleRevalidation();
  }, [client, flushRevalidation, isConnected, scheduleRevalidation]);

  useEffect(
    () => () => {
      if (revalidationTimerRef.current) clearTimeout(revalidationTimerRef.current);
    },
    [],
  );

  useClientActivity({
    client,
    focusedAgentId,
    focusedTerminalId,
    onAppResumed: scheduleRevalidation,
  });
  usePushTokenRegistration({ client, serverId });

  useEffect(() => {
    if (isConnected && serverInfo?.features?.providersSnapshot) {
      prefetchProvidersSnapshot(serverId, client);
    }
  }, [client, isConnected, serverId, serverInfo]);

  const notifyAgentAttention = useCallback(
    (input: {
      agentId: string;
      reason: "finished" | "error" | "permission";
      timestamp: string;
      notification?: AgentAttentionNotificationPayload;
    }) => {
      if (input.reason === "error") return;
      const focused = useUiPreferencesStore.getState().focusedAgentByServer.get(serverId) ?? null;
      if (getIsAppActivelyVisible(appStateRef.current) && focused === input.agentId) return;
      const timestamp = new Date(input.timestamp).getTime();
      if ((attentionNotifiedRef.current.get(input.agentId) ?? 0) >= timestamp) return;
      attentionNotifiedRef.current.set(input.agentId, timestamp);
      const notification =
        input.notification ??
        buildAgentAttentionNotificationPayload({
          reason: input.reason,
          serverId,
          agentId: input.agentId,
          assistantMessage:
            input.reason === "finished"
              ? latestAssistantText(projectionRuntime, serverId, input.agentId)
              : null,
          permissionRequest:
            input.reason === "permission"
              ? latestPermission(projectionRuntime, serverId, input.agentId)
              : null,
        });
      void sendOsNotification({
        title: notification.title,
        body: notification.body,
        data: notification.data,
      });
    },
    [projectionRuntime, serverId],
  );

  useEffect(() => {
    const unsubscribers = [
      client.on("agent_stream", (message) => {
        if (message.type !== "agent_stream" || message.payload.internal) return;
        const { agentId, event } = message.payload;
        if (event.type === "attention_required" && event.shouldNotify) {
          notifyAgentAttention({
            agentId,
            reason: event.reason,
            timestamp: event.timestamp,
            notification: event.notification,
          });
        }
      }),
      client.on("fetch_agent_timeline_response", (message) => {
        if (message.type !== "fetch_agent_timeline_response") return;
        const payload = message.payload;
        if (
          payload.agent?.internal === true ||
          payload.agent?.labels.surface === "thoth-loop" ||
          payload.error ||
          payload.hasNewer
        ) {
          return;
        }
        useCreateFlowStore.getState().clearByAgent({ serverId, agentId: payload.agentId });
        resolveInitDeferred(getInitKey(serverId, payload.agentId));
      }),
      client.on("checkout_status_update", (message) => {
        if (message.type === "checkout_status_update") {
          applyCheckoutStatusUpdateFromEvent({ queryClient, serverId, message });
        }
      }),
      client.on("workspace_setup_progress", (message) => {
        if (message.type === "workspace_setup_progress") {
          upsertWorkspaceSetupProgress({ serverId, payload: message.payload });
        }
      }),
      client.on("workspace_setup_status_response", (message) => {
        if (message.type !== "workspace_setup_status_response" || !message.payload.snapshot) return;
        upsertWorkspaceSetupProgress({
          serverId,
          payload: { workspaceId: message.payload.workspaceId, ...message.payload.snapshot },
        });
      }),
      client.on("workspace_update", (message) => {
        if (message.type === "workspace_update" && message.payload.kind === "remove") {
          removeWorkspaceSetup({ serverId, workspaceId: message.payload.id });
        }
      }),
      client.on("agent_deleted", (message) => {
        if (message.type === "agent_deleted") {
          clearDraftInput({
            draftKey: buildDraftStoreKey({ serverId, agentId: message.payload.agentId }),
          });
        }
      }),
      client.on("terminal_attention_required", (message) => {
        if (message.type !== "terminal_attention_required" || !message.payload.shouldNotify) return;
        void sendOsNotification({
          title: message.payload.title,
          body: message.payload.body,
          data: {
            serverId: message.payload.serverId ?? serverId,
            terminalId: message.payload.terminalId,
            cwd: message.payload.cwd,
            ...(message.payload.workspaceId ? { workspaceId: message.payload.workspaceId } : {}),
          },
        });
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [
    clearDraftInput,
    client,
    notifyAgentAttention,
    queryClient,
    removeWorkspaceSetup,
    serverId,
    upsertWorkspaceSetupProgress,
  ]);

  useEffect(
    () => () => {
      clearWorkspaceSetupServer(serverId);
    },
    [clearWorkspaceSetupServer, serverId],
  );

  return children;
}
