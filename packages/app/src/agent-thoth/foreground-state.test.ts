import { describe, expect, it } from "vitest";
import type { AgentThothState } from "@thoth/protocol/thoth/rpc-schemas";
import { resolveForegroundAgentStatus, shouldShowForegroundTurnSpinner } from "./foreground-state";

function state(lifecycle: AgentThothState["lifecycle"]): AgentThothState {
  return {
    agentId: "agent-1",
    revision: 3,
    lifecycle,
    turn: {
      id: "turn-1",
      agentId: "agent-1",
      kind: "thoth",
      lifecycle,
      controls: { mode: "loop", clarifyStrength: "light", loop: "one_plan_one_do" },
      providerRunMode: "default",
      startedAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:01.000Z",
    },
    pendingCard: null,
    backgroundTaskId: lifecycle === "background_handoff" ? "task-1" : null,
    error: null,
  };
}

describe("foreground Agent Thoth projection", () => {
  it.each(["running", "quick_exec"] as const)(
    "keeps %s cancellable through the ordinary Agent control",
    (lifecycle) => {
      expect(resolveForegroundAgentStatus("idle", state(lifecycle))).toBe("running");
    },
  );

  it.each(["background_handoff", "done", "canceled"] as const)(
    "ends the foreground spinner for %s even if the provider Agent update is late",
    (lifecycle) => {
      const projection = state(lifecycle);
      const effective = resolveForegroundAgentStatus("running", projection);
      expect(effective).toBe("idle");
      expect(shouldShowForegroundTurnSpinner(projection, effective)).toBe(false);
    },
  );

  it("keeps an open Card active without showing a provider spinner", () => {
    const projection = state("awaiting_card");
    const effective = resolveForegroundAgentStatus("idle", projection);
    expect(effective).toBe("idle");
    expect(shouldShowForegroundTurnSpinner(projection, effective)).toBe(false);
  });

  it("uses the normal Agent lifecycle before authority hydration", () => {
    expect(resolveForegroundAgentStatus("running", null)).toBe("running");
    expect(shouldShowForegroundTurnSpinner(null, "running")).toBe(true);
  });
});
