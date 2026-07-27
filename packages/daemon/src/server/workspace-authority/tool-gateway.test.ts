import { afterEach, describe, expect, it } from "vitest";
import { ToolGateway } from "./tool-gateway.js";

const gateway = new ToolGateway({
  submitPlanExec: () => false,
  submitReviewAssessment: () => null,
  submitReviewVerdict: () => false,
  reportBlocked: () => false,
});

afterEach(() => gateway.resetForTest());

describe("foreground turn fence", () => {
  it("binds only an active provider turn to the current Thoth generation", () => {
    gateway.beginForegroundTurn({
      agentId: "agent-1",
      workspaceId: "workspace-1",
      generation: "generation-2",
      kind: "thoth_clarify",
      foregroundTurnId: "foreground-turn-2",
    });

    expect(() =>
      gateway.assertForegroundAuthorityTurn({
        agentId: "agent-1",
        context: { providerToolCall: { turnId: "stale-turn" } },
      }),
    ).toThrow("not bound to the active foreground generation");

    expect(() =>
      gateway.assertForegroundAuthorityTurn({
        agentId: "agent-1",
        context: {
          providerToolCall: { turnId: "provider-turn-2", isActiveProviderTurn: true },
        },
      }),
    ).not.toThrow();
    expect(gateway.getActiveForegroundAuthorityTurnId("agent-1")).toBe("foreground-turn-2");
  });

  it("rejects stale provider turns after an explicit binding", () => {
    gateway.beginForegroundTurn({
      agentId: "agent-1",
      workspaceId: "workspace-1",
      generation: "generation-2",
      kind: "thoth_clarify",
      foregroundTurnId: "foreground-turn-2",
    });
    gateway.bindForegroundProviderTurn({
      agentId: "agent-1",
      generation: "generation-2",
      providerTurnId: "provider-turn-2",
    });

    expect(() =>
      gateway.assertForegroundAuthorityTurn({
        agentId: "agent-1",
        context: { providerToolCall: { turnId: "provider-turn-1" } },
      }),
    ).toThrow("stale provider turn");
    expect(() =>
      gateway.assertForegroundAuthorityTurn({
        agentId: "agent-1",
        context: { providerToolCall: { turnId: "provider-turn-2" } },
      }),
    ).not.toThrow();

    gateway.endForegroundTurn({ agentId: "agent-1", generation: "generation-2" });
    expect(gateway.getActiveForegroundAuthorityTurnId("agent-1")).toBeNull();
  });

  it("keeps session-scoped tools unauthorized during a raw turn", () => {
    gateway.beginForegroundTurn({
      agentId: "agent-1",
      workspaceId: "workspace-1",
      generation: "generation-raw",
      kind: "raw_provider",
      foregroundTurnId: "foreground-turn-raw",
    });
    expect(gateway.getActiveForegroundAuthorityTurnId("agent-1")).toBeNull();
    expect(() =>
      gateway.assertForegroundAuthorityTurn({ agentId: "agent-1", context: {} }),
    ).toThrow("disabled for this raw provider turn");
    expect(() =>
      gateway.assertForegroundContextTurn({
        agentId: "agent-1",
        context: {
          providerToolCall: { turnId: "provider-turn-raw", isActiveProviderTurn: true },
        },
      }),
    ).not.toThrow();
  });

  it("keeps an old parked provider turn fenced while a continuation becomes active", () => {
    gateway.beginForegroundTurn({
      agentId: "agent-1",
      workspaceId: "workspace-1",
      generation: "generation-1",
      kind: "thoth_clarify",
      foregroundTurnId: "foreground-turn-1",
    });
    gateway.bindForegroundProviderTurn({
      agentId: "agent-1",
      generation: "generation-1",
      providerTurnId: "provider-turn-1",
    });
    gateway.parkForegroundTurn({ agentId: "agent-1", providerTurnId: "provider-turn-1" });
    expect(() =>
      gateway.assertForegroundAuthorityTurn({
        agentId: "agent-1",
        context: { providerToolCall: { turnId: "provider-turn-1" } },
      }),
    ).toThrow("parked provider turn");

    gateway.beginForegroundTurn({
      agentId: "agent-1",
      workspaceId: "workspace-1",
      generation: "generation-1",
      kind: "thoth_clarify",
      foregroundTurnId: "foreground-turn-1",
    });
    gateway.bindForegroundProviderTurn({
      agentId: "agent-1",
      generation: "generation-1",
      providerTurnId: "provider-turn-2",
    });

    expect(
      gateway.isParkedProviderTurn({
        agentId: "agent-1",
        providerTurnId: "provider-turn-1",
      }),
    ).toBe(true);
    expect(
      gateway.isParkedProviderTurn({
        agentId: "agent-1",
        providerTurnId: "provider-turn-2",
      }),
    ).toBe(false);

    gateway.releaseParkedProviderTurn({
      agentId: "agent-1",
      providerTurnId: "provider-turn-1",
    });
    expect(
      gateway.isParkedProviderTurn({
        agentId: "agent-1",
        providerTurnId: "provider-turn-1",
      }),
    ).toBe(false);
  });
});

describe("provider-neutral scoped capability fence", () => {
  it("returns the active foreground Workspace/Agent/generation scope", () => {
    gateway.beginForegroundTurn({
      agentId: "agent-1",
      workspaceId: "workspace-1",
      generation: "generation-2",
      kind: "raw_provider",
      foregroundTurnId: "foreground-turn-2",
    });

    expect(
      gateway.authorizeScopedCapability({
        agentId: "agent-1",
        context: {
          providerToolCall: {
            provider: "provider",
            threadId: "thread-1",
            turnId: "provider-turn-2",
            callId: "call-1",
            toolName: "browser_snapshot",
            isActiveProviderTurn: true,
          },
        },
      }),
    ).toEqual({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      executionId: "foreground-turn-2",
      generation: "generation-2",
    });
  });

  it("rejects stale provider callbacks and exposes active Loop execution scope", () => {
    gateway.bind("agent-loop", {
      workspaceId: "workspace-loop",
      taskId: "task-1",
      goalId: "goal-1",
      executionId: "execution-1",
      generation: "generation-loop",
      phase: "planexec",
    });

    expect(() =>
      gateway.authorizeScopedCapability({
        agentId: "agent-loop",
        context: {
          providerToolCall: {
            provider: "provider",
            threadId: "thread-1",
            turnId: "turn-stale",
            callId: "call-stale",
            toolName: "browser_snapshot",
          },
        },
      }),
    ).toThrow("active provider execution");

    expect(
      gateway.authorizeScopedCapability({
        agentId: "agent-loop",
        context: {
          providerToolCall: {
            provider: "provider",
            threadId: "thread-1",
            turnId: "turn-current",
            callId: "call-current",
            toolName: "browser_snapshot",
            isActiveProviderTurn: true,
          },
        },
      }),
    ).toEqual({
      workspaceId: "workspace-loop",
      agentId: "agent-loop",
      executionId: "execution-1",
      generation: "generation-loop",
    });
  });
});
