import type { Agent } from "@/projection/authority-model";

export type CloseAgentTabPolicy = { kind: "archive-on-close" } | { kind: "layout-only" };

interface CloseAgentTabInput {
  agent: Pick<Agent, "archivedAt" | "parentAgentId" | "status"> | null | undefined;
  confirmRunningArchive: () => Promise<boolean>;
  archive: () => Promise<void>;
  closeLayout: () => void;
}

export function resolveCloseAgentTabPolicy(
  agent: Pick<Agent, "archivedAt" | "parentAgentId"> | null | undefined,
): CloseAgentTabPolicy {
  if (!agent || agent.archivedAt || agent.parentAgentId) {
    return { kind: "layout-only" };
  }

  return { kind: "archive-on-close" };
}

export async function executeCloseAgentTab(input: CloseAgentTabInput): Promise<boolean> {
  const policy = resolveCloseAgentTabPolicy(input.agent);
  if (
    policy.kind === "archive-on-close" &&
    input.agent?.status === "running" &&
    !(await input.confirmRunningArchive())
  ) {
    return false;
  }

  if (policy.kind === "archive-on-close") {
    await input.archive();
  }
  input.closeLayout();
  return true;
}
