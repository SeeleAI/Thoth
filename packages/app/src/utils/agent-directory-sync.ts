import type { FetchAgentsEntry } from "@thoth/client/internal/daemon-client";
import type { Agent } from "@/projection/authority-model";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { resolveProjectPlacement } from "@/utils/project-placement";

export function buildAgentDirectoryState(input: {
  serverId: string;
  entries: FetchAgentsEntry[];
}): { agents: Map<string, Agent> } {
  const agents = new Map<string, Agent>();
  for (const entry of input.entries) {
    const normalized = normalizeAgentSnapshot(entry.agent, input.serverId);
    agents.set(normalized.id, {
      ...normalized,
      projectPlacement: resolveProjectPlacement({
        projectPlacement: entry.project,
        cwd: normalized.cwd,
      }),
    });
  }
  return { agents };
}
