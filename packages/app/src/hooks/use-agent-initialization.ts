import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@thoth/client/internal/daemon-client";
import { useAuthorityProjection, useProjectionRuntime } from "@/projection/projection-context";
import type {
  DaemonProjectionService,
  TimelineProjection,
} from "@/projection/authority-projection";
import {
  createInitDeferred,
  getInitDeferred,
  getInitKey,
  INIT_TIMEOUT_MS,
  rejectInitDeferred,
  refreshInitTimeout,
} from "@/utils/agent-initialization";
import { planInitialAgentTimelineSync, planTimelineTailFetch } from "@/timeline/timeline-sync-plan";
import { i18n } from "@/i18n/i18next";

export type SetAgentInitializing = (agentId: string, initializing: boolean) => void;

export function createHistorySyncTimeoutError(): Error {
  return new Error(`History sync timed out after ${Math.round(INIT_TIMEOUT_MS / 1000)}s`);
}

export function refreshAgentInitializationTimeout(input: {
  key: string;
  agentId: string;
  setAgentInitializing: SetAgentInitializing;
  timeline?: TimelineProjection;
}): void {
  refreshInitTimeout({
    key: input.key,
    onTimeout: () => {
      input.setAgentInitializing(input.agentId, false);
      rejectInitDeferred(input.key, createHistorySyncTimeoutError());
    },
  });
}

export interface EnsureAgentIsInitializedInput {
  serverId: string;
  agentId: string;
  client: Pick<DaemonClient, "fetchAgentTimeline"> | null;
  setAgentInitializing: SetAgentInitializing;
  timeline?: TimelineProjection;
  hostDisconnectedMessage?: string;
}

export function ensureAgentIsInitialized(input: EnsureAgentIsInitializedInput): Promise<void> {
  const { serverId, agentId, client, setAgentInitializing } = input;
  const key = getInitKey(serverId, agentId);
  const existing = getInitDeferred(key);
  if (existing) {
    return existing.promise;
  }

  const cursor =
    input.timeline?.epoch && input.timeline.startCursor && input.timeline.endCursor
      ? {
          epoch: input.timeline.epoch,
          startSeq: input.timeline.startCursor.seq,
          endSeq: input.timeline.endCursor.seq,
        }
      : undefined;
  const hasAuthoritativeHistory = input.timeline?.epoch !== null && input.timeline !== undefined;
  const timelineRequest = planInitialAgentTimelineSync({ cursor, hasAuthoritativeHistory });

  const deferred = createInitDeferred(key, timelineRequest.direction);
  refreshAgentInitializationTimeout({ key, agentId, setAgentInitializing });

  setAgentInitializing(agentId, true);

  if (!client) {
    setAgentInitializing(agentId, false);
    rejectInitDeferred(
      key,
      new Error(input.hostDisconnectedMessage ?? i18n.t("workspace.terminal.hostDisconnected")),
    );
    return deferred.promise;
  }

  client.fetchAgentTimeline(agentId, timelineRequest).catch((error) => {
    setAgentInitializing(agentId, false);
    rejectInitDeferred(key, error instanceof Error ? error : new Error(String(error)));
  });

  return deferred.promise;
}

export interface RefreshAgentInput {
  agentId: string;
  client: Pick<DaemonClient, "refreshAgent" | "fetchAgentTimeline"> | null;
  setAgentInitializing: SetAgentInitializing;
  hostDisconnectedMessage?: string;
}

export async function refreshAgent(input: RefreshAgentInput): Promise<void> {
  const { agentId, client, setAgentInitializing } = input;
  if (!client) {
    throw new Error(input.hostDisconnectedMessage ?? i18n.t("workspace.terminal.hostDisconnected"));
  }
  setAgentInitializing(agentId, true);

  try {
    await client.refreshAgent(agentId);
    await client.fetchAgentTimeline(agentId, planTimelineTailFetch());
  } catch (error) {
    setAgentInitializing(agentId, false);
    throw error;
  }
}

export function createSetAgentInitializing(
  getService: () => Pick<DaemonProjectionService, "setAgentTimelineLoading"> | null,
): SetAgentInitializing {
  return (agentId, initializing) => getService()?.setAgentTimelineLoading(agentId, initializing);
}

export function useAgentInitialization({
  serverId,
  client,
}: {
  serverId: string;
  client: DaemonClient | null;
}) {
  const { t } = useTranslation();
  const projectionRuntime = useProjectionRuntime();
  const timelines = useAuthorityProjection(serverId, (projection) => projection.timelines);
  const setAgentInitializing = useMemo(
    () => createSetAgentInitializing(() => projectionRuntime.service(serverId)),
    [projectionRuntime, serverId],
  );

  const ensureAgentIsInitializedCallback = useCallback(
    (agentId: string): Promise<void> =>
      ensureAgentIsInitialized({
        serverId,
        agentId,
        client,
        timeline: timelines.get(agentId),
        setAgentInitializing,
        hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
      }),
    [client, serverId, setAgentInitializing, t, timelines],
  );

  const refreshAgentCallback = useCallback(
    (agentId: string): Promise<void> =>
      refreshAgent({
        agentId,
        client,
        setAgentInitializing,
        hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
      }),
    [client, setAgentInitializing, t],
  );

  return {
    ensureAgentIsInitialized: ensureAgentIsInitializedCallback,
    refreshAgent: refreshAgentCallback,
  };
}
