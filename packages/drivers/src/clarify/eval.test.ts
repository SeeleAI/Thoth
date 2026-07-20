import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClarifyProviderInputEnvelope,
  loadRuntimeSkillArtifact,
  mountRuntimeSkillForSession,
  parseRuntimeSkillFrontmatter,
  validateClarifyRuntimeSkillArtifact,
} from "./contract.js";
import { evaluateClarifyGoldenDataset } from "./eval.js";
import { CLARIFY_GOLDEN_SCENARIOS } from "./golden.js";

describe("thoth.clarify harness", () => {
  it("builds normal provider input envelopes without repeating Skill rules", () => {
    const envelope = buildClarifyProviderInputEnvelope({
      sessionId: "sec_test",
      taskId: null,
      currentState: "C_ASK",
      userInput: "帮我把这个项目做好",
      clarify: "balanced",
      mode: "loop",
      loop: "balanced",
      transcriptRef: "transcript:sec_test:v4",
      contextSummary: "workspace facts already discovered",
    });

    expect(envelope.skill).toBe("thoth.clarify");
    expect(envelope.expect).toBe("clarify");
    expect(envelope.input).toContain('"type":"clarify_turn"');
    expect(envelope.input).toContain('"current_state":"C_ASK"');
    expect(envelope.input).not.toContain("## State Codes");
    expect(envelope.input).not.toContain("## Transition Rules");
  });

  it("loads thoth.clarify from the standard SKILL.md artifact", () => {
    const artifact = loadRuntimeSkillArtifact("thoth.clarify");
    expect(artifact.path).toMatch(/runtime-skills[\\/]thoth-clarify[\\/]SKILL\.md$/);
    expect(artifact.frontmatter.name).toBe("thoth.clarify");
    expect(artifact.frontmatter.userInvocable).toBe(false);
    expect(artifact.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(validateClarifyRuntimeSkillArtifact(artifact)).toEqual([]);
  });

  it("accepts Windows CRLF runtime skill frontmatter", () => {
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
      description: "Windows-compatible runtime skill",
      userInvocable: false,
    });
    expect(parsed.body).toBe("## Runtime Context");
  });

  it("refuses runtime skill mounts below a provider global skill root", () => {
    const fakeHome = join(tmpdir(), "thoth-global-skill-home");

    expect(() =>
      mountRuntimeSkillForSession({
        thothSessionHome: join(fakeHome, ".codex", "skills"),
        sessionId: "sec_global_guard",
        home: fakeHome,
      }),
    ).toThrow("Refusing to mount a Thoth runtime skill inside a global provider skill dir");
  });

  it("keeps the golden dataset broad enough for NTH-TD-015 acceptance", () => {
    expect(CLARIFY_GOLDEN_SCENARIOS.map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining([
        "hi-direct",
        "vague-large-task",
        "low-risk-small-task",
        "unclear-acceptance",
        "risk-resource-boundary",
        "repeated-ambiguity",
        "enough-information-task-card",
        "you-decide-agent-owned",
        "high-risk-confirmation",
        "unsafe-blocked",
        "contradiction",
        "anti-downgrade",
        "strength-none-pathtracing",
        "strength-light-pathtracing",
        "strength-balanced-pathtracing",
        "strength-dive-pathtracing",
        "agent-can-discover",
        "stop-clarify-task-card",
        "compact-preset-cask",
        "answer-packet-note-only",
        "goal-card-provenance",
      ]),
    );
  });

  it("passes deterministic clarify golden eval", () => {
    const report = evaluateClarifyGoldenDataset();
    expect(report.passed, JSON.stringify(report.results, null, 2)).toBe(true);
    expect(report.results.map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining([
        "packaged-runtime-skill-authority",
        "skill-not-global-installed",
        "session-scoped-skill-visible",
        "bare-provider-skill-invisible",
        "normal-turn-does-not-repeat-skill-rules",
        "transition-turn-carries-skill-reference",
        "skill-rules-live-in-skill-md",
        "repair-packet-shape-only",
        "clarify-strength-behavior-differs",
        "codex-exec-user-simulation",
      ]),
    );
  });
});
