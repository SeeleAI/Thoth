import { describe, expect, it } from "vitest";
import { buildThothTurnSnapshot, isThothModeEnabled } from "./thoth-mode";

describe("Thoth composer mode", () => {
  it("lets the Provider choose Clarify depth for every enabled turn", () => {
    expect(buildThothTurnSnapshot({ enabled: true, clarifyStrength: "none" })).toEqual({
      enabled: true,
      executionMode: "quick",
      clarifyStrength: "auto",
    });
  });

  it("keeps deliberate legacy structured settings enabled while empty legacy config is direct", () => {
    expect(isThothModeEnabled({ mode: "loop", clarifyStrength: "balanced" })).toBe(true);
    expect(isThothModeEnabled({ clarifyStrength: "light" })).toBe(true);
    expect(isThothModeEnabled({})).toBe(false);
  });

  it("freezes explicit off and complete enabled turn snapshots", () => {
    expect(buildThothTurnSnapshot({ enabled: false, mode: "loop" })).toEqual({
      enabled: false,
    });
    expect(
      buildThothTurnSnapshot({
        enabled: true,
        mode: "loop",
        clarifyStrength: "dive",
        loopStrength: "balanced",
      }),
    ).toEqual({
      enabled: true,
      executionMode: "loop",
      clarifyStrength: "auto",
      loopStrength: "balanced",
    });
    expect(
      buildThothTurnSnapshot({
        enabled: true,
        mode: "quick",
        clarifyStrength: "balanced",
        loopStrength: "run_until_stopped",
      }),
    ).toEqual({
      enabled: true,
      executionMode: "quick",
      clarifyStrength: "auto",
    });
  });
});
