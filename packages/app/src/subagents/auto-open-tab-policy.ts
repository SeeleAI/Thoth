import type { Agent } from "@/projection/authority-model";

export function shouldAutoOpenAgentTab(agent: Pick<Agent, "parentAgentId">): boolean {
  return !agent.parentAgentId;
}
