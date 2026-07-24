import type { AgentLifecycleStatus } from "@thoth/protocol/agent-lifecycle";
import type { Agent } from "@/projection/authority-model";

export function reconcilePreviousAgentStatuses(
  previousStatuses: Map<string, AgentLifecycleStatus>,
  sessionAgents: Map<string, Agent> | undefined,
): Map<string, AgentLifecycleStatus> {
  if (!sessionAgents) {
    return new Map();
  }

  const nextStatuses = new Map(previousStatuses);
  const seenAgentIds = new Set<string>();

  for (const agent of sessionAgents.values()) {
    seenAgentIds.add(agent.id);
    if (!nextStatuses.has(agent.id)) {
      nextStatuses.set(agent.id, agent.status);
    }
  }

  for (const agentId of nextStatuses.keys()) {
    if (!seenAgentIds.has(agentId)) {
      nextStatuses.delete(agentId);
    }
  }

  return nextStatuses;
}
