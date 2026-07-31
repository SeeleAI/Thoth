import { describe, expect, it } from "vitest";
import {
  loadRuntimeSkillArtifact,
  parseRuntimeSkillFrontmatter,
  validateClarifyRuntimeSkillArtifact,
} from "./contract.js";
import { runClarifyEval } from "./eval.js";
import { CLARIFY_GOLDEN_SCENARIOS } from "./golden.js";
import {
  buildClarifyUserSimulationReport,
  validateClarifyUserSimulationReport,
} from "./user-simulation.js";

describe("thoth.clarify cognitive harness", () => {
  it("loads the provider-neutral Decision Tree Skill artifact", () => {
    const artifact = loadRuntimeSkillArtifact("thoth.clarify");
    expect(artifact.path).toMatch(/runtime-skills[\\/]thoth-clarify[\\/]SKILL\.md$/u);
    expect(artifact.frontmatter).toMatchObject({
      name: "thoth.clarify",
      userInvocable: false,
      xThothRuntime: "hidden",
      xThothScope: "provider-session",
    });
    expect(artifact.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(validateClarifyRuntimeSkillArtifact(artifact)).toEqual([]);
  });

  it("accepts Windows CRLF runtime Skill frontmatter", () => {
    const parsed = parseRuntimeSkillFrontmatter(
      [
        "---",
        "name: thoth.clarify",
        "description: Windows-compatible runtime skill",
        "user-invocable: false",
        "---",
        "## Runtime Context",
      ].join("\r\n"),
    );
    expect(parsed.frontmatter).toMatchObject({
      name: "thoth.clarify",
      userInvocable: false,
    });
    expect(parsed.body).toBe("## Runtime Context");
  });

  it("covers evidence ownership, subtree delegation, and a 32-question Dive", () => {
    expect(CLARIFY_GOLDEN_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "discover-before-ask",
      "delegate-subtree",
      "ray-tracer-dive-32",
    ]);
    const dive = CLARIFY_GOLDEN_SCENARIOS.find((scenario) => scenario.id === "ray-tracer-dive-32")!;
    expect(dive.cards.flatMap((entry) => entry.card.questions).length).toBeGreaterThan(30);
    expect(CLARIFY_GOLDEN_SCENARIOS[0]?.cards[0]?.humanAction).toEqual({
      intent: "recommend",
      targetNodeId: "acceptance",
    });
    expect(CLARIFY_GOLDEN_SCENARIOS[1]?.cards[0]?.humanAction).toEqual({
      intent: "delegate_subtree",
      targetNodeId: "portability",
    });
  });

  it("passes the deterministic Decision Tree research metrics", () => {
    const report = runClarifyEval();
    expect(report.passed, JSON.stringify(report.results, null, 2)).toBe(true);
    expect(report.scenarioCount).toBe(3);
    expect(report.metrics).toMatchObject({
      highImpactOmissions: 0,
      invalidQuestions: 0,
      discoverableFactQuestionRate: 0,
      contractRegret: 0,
    });
    expect(report.metrics.branchesEliminatedPerHumanAnswer).toBeGreaterThan(0);
    expect(report.negativeProbes).toEqual([
      expect.objectContaining({ id: "duplicate-question", passed: true }),
      expect.objectContaining({ id: "already-resolved-question", passed: true }),
      expect.objectContaining({ id: "discoverable-evidence-question", passed: true }),
      expect.objectContaining({ id: "agent-owned-question", passed: true }),
      expect.objectContaining({ id: "low-value-local-question", passed: true }),
    ]);
  });

  it("keeps all four ablations and selects Decision Tree plus one-shot Challenger", () => {
    const report = buildClarifyUserSimulationReport({
      digest: `sha256:${"0".repeat(64)}`,
    });
    expect(report.selectedVariant).toBe("decision_tree_challenger");
    expect(report.ablations.map((entry) => entry.variant)).toEqual([
      "prompt_only",
      "fixed_scaffold",
      "decision_tree",
      "decision_tree_challenger",
    ]);
    expect(validateClarifyUserSimulationReport(report)).toEqual([]);
  });
});
