import type { AgentLifecycleStatus } from "@thoth/protocol/agent-lifecycle";
import type { AgentThothState } from "@thoth/protocol/thoth/rpc-schemas";

const ACTIVE_LIFECYCLES = new Set<AgentThothState["lifecycle"]>([
  "running",
  "mapping",
  "challenging",
  "proposing",
  "quick_exec",
]);

export function resolveForegroundAgentStatus(
  agentStatus: AgentLifecycleStatus | null,
  state: AgentThothState | null | undefined,
): AgentLifecycleStatus | null {
  if (!state?.turn) {
    return agentStatus;
  }
  if (ACTIVE_LIFECYCLES.has(state.lifecycle)) {
    return "running";
  }
  if (state.lifecycle === "interrupted" || state.lifecycle === "unsupported") {
    return "error";
  }
  return "idle";
}

export function shouldShowForegroundTurnSpinner(
  state: AgentThothState | null | undefined,
  effectiveStatus: AgentLifecycleStatus | null,
): boolean {
  if (!state?.turn) {
    return effectiveStatus === "running";
  }
  return ACTIVE_LIFECYCLES.has(state.lifecycle);
}

export function isForegroundTurnSuspended(state: AgentThothState | null | undefined): boolean {
  return Boolean(
    state?.turn &&
    ["awaiting_card", "awaiting_implementation", "quick_wait"].includes(state.lifecycle),
  );
}
