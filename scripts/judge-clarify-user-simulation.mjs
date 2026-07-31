import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const judgeModel = process.env.THOTH_CODEX_JUDGE_MODEL ?? "gpt-5.5";
const artifactsDir = resolve(repoRoot, ".agent-os/artifacts");
mkdirSync(artifactsDir, { recursive: true });
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const artifactPath = resolve(artifactsDir, `clarify-ablation-${timestamp}.md`);
const judgePath = resolve(artifactsDir, `clarify-ablation-codex-judge-${timestamp}.md`);

const clarify = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/clarify/index.js")).href
);
const harness = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/harness/index.js")).href
);
const artifact = clarify.loadRuntimeSkillArtifact("thoth.clarify");
const artifactFailures = clarify.validateClarifyRuntimeSkillArtifact(artifact);
const bundle = harness.loadRuntimeBundle("thoth.clarify", harness.THOTH_RUNTIME_BUNDLE_CATALOG);
const report = clarify.buildClarifyUserSimulationReport(artifact);
const failures = [...artifactFailures, ...clarify.validateClarifyUserSimulationReport(report)];
if (bundle.instructions !== artifact.body)
  failures.push("RuntimeBundle instructions differ from Skill body");
if (!/^sha256:[a-f0-9]{64}$/u.test(bundle.digest))
  failures.push("RuntimeBundle digest is not content-addressed");
if (/provider-sessions|\.codex\/skills|\.claude\/skills/u.test(JSON.stringify(bundle))) {
  failures.push("RuntimeBundle contains provider-home or per-session copied paths");
}
const evidence = {
  timestamp,
  artifact: { path: artifact.path, digest: artifact.digest, frontmatter: artifact.frontmatter },
  bundle,
  report,
  failures,
};
if (failures.length > 0) {
  writeFileSync(artifactPath, JSON.stringify(evidence, null, 2));
  console.error(`Clarify ablation validation failed: ${artifactPath}`);
  process.exit(1);
}

const prompt = [
  "You are an independent research judge for a Thoth Clarify architecture ablation.",
  "Do not modify files. Judge whether the evidence honestly compares prompt-only, fixed scaffold, Decision Map, and Decision Map plus one-shot Challenger.",
  "",
  "Pass only if:",
  "- the selected architecture maximizes Provider Agent cognition while keeping a minimal semantic tool surface and deterministic authority boundaries;",
  "- prompt-only loses durable frontier/ownership/recovery, and fixed scaffold creates mechanical or low-value questions;",
  "- Decision Map alone improves recoverability but can still omit one high-impact branch;",
  "- one fresh Challenger closes concrete contract regret without adding a critic for every card or an endless loop;",
  "- the metrics explicitly cover high-impact omissions, invalid questions, discoverable-fact question rate, branches eliminated per Human answer, and contract regret;",
  "- the selected result preserves Human ownership, supports 30+ material Dive questions when the problem warrants them, and never encodes chain-of-thought;",
  "- all artifacts remain provider-neutral and content-addressed.",
  "",
  "End with exactly JUDGE_RESULT: PASS if supported. Otherwise list failures and end with exactly JUDGE_RESULT: FAIL.",
  "",
  JSON.stringify(evidence, null, 2),
].join("\n");
const judge = spawnSync(
  "codex",
  [
    "exec",
    "--model",
    judgeModel,
    "--cd",
    repoRoot,
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--output-last-message",
    judgePath,
    "-",
  ],
  { cwd: repoRoot, input: prompt, encoding: "utf8", maxBuffer: 1024 * 1024 * 20 },
);
const judgeText = judge.status === 0 && !judge.error ? readFileSync(judgePath, "utf8") : "";
const passed = judge.status === 0 && !judge.error && judgeText.includes("JUDGE_RESULT: PASS");
writeFileSync(
  artifactPath,
  [
    "# Clarify Ablation Judge",
    "",
    `Result: ${passed ? "PASS" : "FAIL"}`,
    "",
    "```json",
    JSON.stringify(evidence, null, 2),
    "```",
    "",
    judgeText || judge.stderr || judge.error?.message || "Judge did not return evidence.",
  ].join("\n"),
);
if (!passed) {
  console.error(`Clarify ablation judge failed: ${artifactPath}`);
  process.exit(judge.status && judge.status !== 0 ? judge.status : 1);
}
console.log("Clarify ablation judge: PASS");
console.log(`Evidence: ${artifactPath}`);
