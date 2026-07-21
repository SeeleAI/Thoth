import { afterEach, describe, expect, it } from "vitest";
import {
  assertForegroundAuthorityTurn,
  assertForegroundContextTurn,
  beginForegroundTurnFence,
  bindForegroundProviderTurn,
  endForegroundTurnFence,
  getActiveForegroundAuthorityTurnId,
  isParkedForegroundProviderTurn,
  parkForegroundTurnFence,
  releaseParkedForegroundProviderTurn,
  resetForegroundTurnFencesForTest,
} from "./foreground-turn-fence.js";

afterEach(() => resetForegroundTurnFencesForTest());

describe("foreground turn fence", () => {
  it("binds only an active provider turn to the current Thoth generation", () => {
    beginForegroundTurnFence({
      agentId: "agent-1",
      generation: "generation-2",
      kind: "thoth_clarify",
      foregroundTurnId: "foreground-turn-2",
    });

    expect(() =>
      assertForegroundAuthorityTurn({
        agentId: "agent-1",
        context: { providerToolCall: { turnId: "stale-turn" } },
      }),
    ).toThrow("not bound to the active foreground generation");

    expect(() =>
      assertForegroundAuthorityTurn({
        agentId: "agent-1",
        context: {
          providerToolCall: { turnId: "provider-turn-2", isActiveProviderTurn: true },
        },
      }),
    ).not.toThrow();
    expect(getActiveForegroundAuthorityTurnId("agent-1")).toBe("foreground-turn-2");
  });

  it("rejects stale provider turns after an explicit binding", () => {
    beginForegroundTurnFence({
      agentId: "agent-1",
      generation: "generation-2",
      kind: "thoth_clarify",
      foregroundTurnId: "foreground-turn-2",
    });
    bindForegroundProviderTurn({
      agentId: "agent-1",
      generation: "generation-2",
      providerTurnId: "provider-turn-2",
    });

    expect(() =>
      assertForegroundAuthorityTurn({
        agentId: "agent-1",
        context: { providerToolCall: { turnId: "provider-turn-1" } },
      }),
    ).toThrow("stale provider turn");
    expect(() =>
      assertForegroundAuthorityTurn({
        agentId: "agent-1",
        context: { providerToolCall: { turnId: "provider-turn-2" } },
      }),
    ).not.toThrow();

    endForegroundTurnFence({ agentId: "agent-1", generation: "generation-2" });
    expect(getActiveForegroundAuthorityTurnId("agent-1")).toBeNull();
  });

  it("keeps session-scoped tools unauthorized during a raw turn", () => {
    beginForegroundTurnFence({
      agentId: "agent-1",
      generation: "generation-raw",
      kind: "raw_provider",
      foregroundTurnId: "foreground-turn-raw",
    });
    expect(getActiveForegroundAuthorityTurnId("agent-1")).toBeNull();
    expect(() => assertForegroundAuthorityTurn({ agentId: "agent-1", context: {} })).toThrow(
      "disabled for this raw provider turn",
    );
    expect(() =>
      assertForegroundContextTurn({
        agentId: "agent-1",
        context: {
          providerToolCall: { turnId: "provider-turn-raw", isActiveProviderTurn: true },
        },
      }),
    ).not.toThrow();
  });

  it("keeps an old parked provider turn fenced while a continuation becomes active", () => {
    beginForegroundTurnFence({
      agentId: "agent-1",
      generation: "generation-1",
      kind: "thoth_clarify",
      foregroundTurnId: "foreground-turn-1",
    });
    bindForegroundProviderTurn({
      agentId: "agent-1",
      generation: "generation-1",
      providerTurnId: "provider-turn-1",
    });
    parkForegroundTurnFence({ agentId: "agent-1", providerTurnId: "provider-turn-1" });
    expect(() =>
      assertForegroundAuthorityTurn({
        agentId: "agent-1",
        context: { providerToolCall: { turnId: "provider-turn-1" } },
      }),
    ).toThrow("parked provider turn");

    beginForegroundTurnFence({
      agentId: "agent-1",
      generation: "generation-1",
      kind: "thoth_clarify",
      foregroundTurnId: "foreground-turn-1",
    });
    bindForegroundProviderTurn({
      agentId: "agent-1",
      generation: "generation-1",
      providerTurnId: "provider-turn-2",
    });

    expect(
      isParkedForegroundProviderTurn({
        agentId: "agent-1",
        providerTurnId: "provider-turn-1",
      }),
    ).toBe(true);
    expect(
      isParkedForegroundProviderTurn({
        agentId: "agent-1",
        providerTurnId: "provider-turn-2",
      }),
    ).toBe(false);

    releaseParkedForegroundProviderTurn({
      agentId: "agent-1",
      providerTurnId: "provider-turn-1",
    });
    expect(
      isParkedForegroundProviderTurn({
        agentId: "agent-1",
        providerTurnId: "provider-turn-1",
      }),
    ).toBe(false);
  });
});
