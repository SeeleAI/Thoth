import { describe, expect, it } from "vitest";
import { runLoopEval } from "./eval.js";
import { LOOP_GOLDEN_SCENARIOS } from "./golden.js";

describe("thoth.loop cognitive harness", () => {
  it("passes target-anchored checkpoint and fresh Review scenarios", () => {
    const report = runLoopEval();
    expect(report.passed, JSON.stringify(report.results, null, 2)).toBe(true);
    expect(report.scenarioCount).toBeGreaterThanOrEqual(5);
    expect(report.results.flatMap((entry) => entry.failures)).toEqual([]);
  });

  it("covers false-green, cognitive drift, Human handoff, and evidence-complete closure", () => {
    expect(LOOP_GOLDEN_SCENARIOS.map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining([
        "false-green-reorient",
        "cognitive-drift-reset",
        "new-premise-needs-human",
        "complete-needs-all-claim-evidence",
      ]),
    );
    expect(
      LOOP_GOLDEN_SCENARIOS.filter((scenario) => scenario.expectReset).every(
        (scenario) => scenario.review.decision === "reorient",
      ),
    ).toBe(true);
  });
});
