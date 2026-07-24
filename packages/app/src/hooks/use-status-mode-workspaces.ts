import { useMemo } from "react";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useAuthorityProjections } from "@/projection/projection-context";
import type { Agent, WorkspaceDescriptor } from "@/projection/authority-model";
import {
  buildSidebarStatusWorkspacePlacements,
  type SidebarStatusWorkspacePlacement,
  type SidebarWorkspacePlacement,
} from "./use-sidebar-workspaces-list";

const EMPTY_WORKSPACES: SidebarStatusWorkspacePlacement[] = [];
const EMPTY_STATUS_SESSIONS: StatusModeSession[] = [];
const EMPTY_PENDING_CREATE_ATTEMPTS: ReturnType<
  typeof useCreateFlowStore.getState
>["pendingByDraftId"] = {};

interface StatusModeSessionSource {
  workspaces: ReadonlyMap<string, WorkspaceDescriptor>;
  agents: ReadonlyMap<string, Agent>;
}

export interface StatusModeSession {
  serverId: string;
  workspaces: ReadonlyMap<string, WorkspaceDescriptor>;
  agents: ReadonlyMap<string, Agent>;
}

export function selectStatusModeSessions(
  sessions: Record<string, StatusModeSessionSource | undefined>,
  serverIds: readonly string[],
): StatusModeSession[] {
  const statusSessions: StatusModeSession[] = [];
  for (const serverId of serverIds) {
    const session = sessions[serverId];
    if (!session) {
      continue;
    }
    statusSessions.push({
      serverId,
      workspaces: session.workspaces,
      agents: session.agents,
    });
  }
  return statusSessions;
}

export function areStatusModeSessionsEqual(
  left: readonly StatusModeSession[],
  right: readonly StatusModeSession[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftSession = left[index];
    const rightSession = right[index];
    if (
      !leftSession ||
      !rightSession ||
      leftSession.serverId !== rightSession.serverId ||
      leftSession.workspaces !== rightSession.workspaces ||
      leftSession.agents !== rightSession.agents
    ) {
      return false;
    }
  }
  return true;
}

export function useStatusModeWorkspacePlacements(input: {
  placements: SidebarWorkspacePlacement[];
  enabled?: boolean;
}): SidebarStatusWorkspacePlacement[] {
  const isEnabled = input.enabled !== false && input.placements.length > 0;
  const serverIds = useMemo(
    () => Array.from(new Set(input.placements.map((placement) => placement.serverId))),
    [input.placements],
  );
  const statusSessions = useAuthorityProjections(
    (store) =>
      isEnabled
        ? serverIds.map((serverId) => ({ serverId, ...store.getSnapshot(serverId) }))
        : EMPTY_STATUS_SESSIONS,
    areStatusModeSessionsEqual,
  );
  const pendingCreateAttempts = useCreateFlowStore((state) =>
    isEnabled ? state.pendingByDraftId : EMPTY_PENDING_CREATE_ATTEMPTS,
  );

  return useMemo(() => {
    if (!isEnabled) {
      return EMPTY_WORKSPACES;
    }

    return buildSidebarStatusWorkspacePlacements({
      placements: input.placements,
      sessions: statusSessions,
      pendingCreateAttempts,
    });
  }, [input.placements, isEnabled, pendingCreateAttempts, statusSessions]);
}
