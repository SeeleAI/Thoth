import type { Agent } from "@/projection/authority-model";
import type { WorkspaceTabSnapshot } from "@/stores/workspace-layout-actions";
import { shouldAutoOpenAgentTab } from "@/subagents/policies";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export interface WorkspaceAgentVisibility {
  activeAgentIds: Set<string>;
  autoOpenAgentIds: Set<string>;
  knownAgentIds: Set<string>;
  archivedAgentIds?: Set<string>;
  restorableAgentIds?: Set<string>;
}

function agentBelongsToWorkspace(agent: Agent, workspaceId: string): boolean {
  return normalizeWorkspaceOpaqueId(agent.workspaceId) === workspaceId;
}

export function deriveWorkspaceAgentVisibility(input: {
  agents: ReadonlyMap<string, Agent> | undefined;
  workspaceId: string | null | undefined;
}): WorkspaceAgentVisibility {
  const { agents } = input;
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if (!agents || !workspaceId) {
    return {
      activeAgentIds: new Set<string>(),
      autoOpenAgentIds: new Set<string>(),
      knownAgentIds: new Set<string>(),
      archivedAgentIds: new Set<string>(),
      restorableAgentIds: new Set<string>(),
    };
  }

  const activeAgentIds = new Set<string>();
  const autoOpenAgentIds = new Set<string>();
  const knownAgentIds = new Set<string>();
  const archivedAgentIds = new Set<string>();
  const restorableAgentIds = new Set<string>();
  for (const agent of agents.values()) {
    if (!agentBelongsToWorkspace(agent, workspaceId)) {
      continue;
    }
    knownAgentIds.add(agent.id);
    if (agent.archivedAt) {
      archivedAgentIds.add(agent.id);
    }
    if (!agent.archivedAt && agent.projectPlacement) {
      activeAgentIds.add(agent.id);
      if (shouldAutoOpenAgentTab(agent)) {
        autoOpenAgentIds.add(agent.id);
      }
    } else if (!agent.archivedAt) {
      restorableAgentIds.add(agent.id);
    }
  }

  return { activeAgentIds, autoOpenAgentIds, knownAgentIds, archivedAgentIds, restorableAgentIds };
}

export function buildWorkspaceTabSnapshot(input: {
  agentVisibility: WorkspaceAgentVisibility;
  agentsHydrated: boolean;
  terminalsHydrated: boolean;
  knownTerminalIds: Iterable<string>;
  standaloneTerminalIds: Iterable<string>;
  hasActivePendingDraftCreate: boolean;
}): WorkspaceTabSnapshot {
  return {
    agentsHydrated: input.agentsHydrated,
    terminalsHydrated: input.terminalsHydrated,
    activeAgentIds: input.agentVisibility.activeAgentIds,
    autoOpenAgentIds: input.agentVisibility.autoOpenAgentIds,
    knownAgentIds: input.agentVisibility.knownAgentIds,
    archivedAgentIds: input.agentVisibility.archivedAgentIds ?? new Set<string>(),
    restorableAgentIds: input.agentVisibility.restorableAgentIds ?? new Set<string>(),
    knownTerminalIds: input.knownTerminalIds,
    standaloneTerminalIds: input.standaloneTerminalIds,
    hasActivePendingDraftCreate: input.hasActivePendingDraftCreate,
  };
}

export function workspaceAgentVisibilityEqual(
  a: WorkspaceAgentVisibility,
  b: WorkspaceAgentVisibility,
): boolean {
  return (
    setsEqual(a.activeAgentIds, b.activeAgentIds) &&
    setsEqual(a.autoOpenAgentIds, b.autoOpenAgentIds) &&
    setsEqual(a.knownAgentIds, b.knownAgentIds) &&
    setsEqual(a.archivedAgentIds ?? new Set<string>(), b.archivedAgentIds ?? new Set<string>()) &&
    setsEqual(a.restorableAgentIds ?? new Set<string>(), b.restorableAgentIds ?? new Set<string>())
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false;
    }
  }
  return true;
}

// Prune agent tabs that are no longer active once agents are hydrated.
// Lazy restored history tabs are preserved, while archived session-directory agents
// still get pruned so archiving on one client closes the tab on all clients.
export function shouldPruneWorkspaceAgentTab(input: {
  agentId: string;
  agentsHydrated: boolean;
  activeAgentIds: Set<string>;
  restorableAgentIds?: Set<string>;
}): boolean {
  if (!input.agentId.trim()) {
    return false;
  }
  if (!input.agentsHydrated) {
    return false;
  }
  return !input.activeAgentIds.has(input.agentId) && !input.restorableAgentIds?.has(input.agentId);
}
