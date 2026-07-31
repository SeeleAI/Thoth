import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const judgeModel = process.env.THOTH_CODEX_JUDGE_MODEL ?? "gpt-5.5";
const artifactsDir = resolve(repoRoot, ".agent-os/artifacts");
mkdirSync(artifactsDir, { recursive: true });
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const evalPath = resolve(artifactsDir, `loop-cognition-eval-${timestamp}.json`);
const behaviorReceiptPath = resolve(artifactsDir, `loop-cognition-behavior-${timestamp}.json`);
const behaviorRunPath = resolve(artifactsDir, `loop-cognition-formal-gates-${timestamp}.log`);
const judgePath = resolve(artifactsDir, `loop-cognition-codex-judge-${timestamp}.md`);
const evalJson = execFileSync(
  process.execPath,
  [resolve(repoRoot, "packages/drivers/dist/loop/eval.js"), "--json"],
  { cwd: repoRoot, encoding: "utf8" },
);
writeFileSync(evalPath, evalJson);
const evalReport = JSON.parse(evalJson);
if (!evalReport.passed) {
  console.error(`Loop deterministic cognition eval failed before judge: ${evalPath}`);
  process.exit(1);
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const formalRuns = [
  {
    name: "public Loop native, managed, repair, and budget journeys",
    args: [
      "run",
      "test:e2e:foreground-thoth",
      "--workspace=@thoth/daemon",
      "--",
      "-t",
      "UT-04|UT-05",
    ],
    env: { THOTH_LOOP_BEHAVIOR_RECEIPT_PATH: behaviorReceiptPath },
  },
  {
    name: "Core non-complete Review budget transition",
    args: [
      "run",
      "test",
      "--workspace=@thoth/core",
      "--",
      "-t",
      "records a Review reorientation, rejected routes, and the non-complete budget",
    ],
    env: {},
  },
  {
    name: "Workspace authority Stop fence",
    args: [
      "run",
      "test:unit",
      "--workspace=@thoth/daemon",
      "--",
      "src/server/workspace-authority/workspace-authority-store.test.ts",
      "-t",
      "commits Stop before interrupt completion and never projects a running spinner state",
    ],
    env: {},
  },
];
const formalReceipts = [];
for (const run of formalRuns) {
  const result = spawnSync(npm, run.args, {
    cwd: repoRoot,
    env: { ...process.env, ...run.env },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
  formalReceipts.push({
    name: run.name,
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  if (result.error || result.status !== 0) {
    writeFileSync(behaviorRunPath, JSON.stringify(formalReceipts, null, 2));
    console.error(
      result.error?.message ?? `${run.name} failed with exit ${result.status}: ${behaviorRunPath}`,
    );
    process.exit(result.status ?? 1);
  }
}
writeFileSync(behaviorRunPath, JSON.stringify(formalReceipts, null, 2));
const publicApiBehavior = JSON.parse(readFileSync(behaviorReceiptPath, "utf8"));
const core = await import(pathToFileURL(resolve(repoRoot, "packages/core/dist/index.js")).href);
const budgetLimits = Object.fromEntries(
  ["single", "light", "balanced", "infinite"].map((strength) => [
    strength,
    core.nonCompleteReviewLimit(strength),
  ]),
);
if (
  JSON.stringify(budgetLimits) !==
    JSON.stringify({ single: 1, light: 5, balanced: 10, infinite: null }) ||
  !publicApiBehavior.nativePlan?.freshReviewThread ||
  !publicApiBehavior.nativePlan?.executeAndReviewUseSameModel ||
  publicApiBehavior.agentManagedDeliberation?.executeRunModes?.some((mode) => mode !== "default") ||
  publicApiBehavior.singleRepairSuccess?.repairTurnCount !== 1 ||
  publicApiBehavior.repairLimit?.firstExecutorRepairTurnCount !== 1 ||
  publicApiBehavior.lightBudget?.usedNonCompleteReviews !== 1
) {
  console.error(`Loop behavior receipt is invalid: ${behaviorReceiptPath}`);
  process.exit(1);
}
const behaviorEvidence = {
  publicApi: publicApiBehavior,
  budgetLimits,
  formalGates: formalReceipts.map((receipt) => ({
    name: receipt.name,
    exitCode: receipt.exitCode,
    passedTestSummary:
      receipt.stdout
        ?.split("\n")
        .filter((line) => /Test Files|Tests\s+/u.test(line))
        .map((line) => line.trim()) ?? [],
  })),
};
const clarify = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/clarify/index.js")).href
);
const harness = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/harness/index.js")).href
);
const loopGolden = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/loop/golden.js")).href
);
const artifact = clarify.loadRuntimeSkillArtifact("thoth.loop");
const bundle = harness.loadRuntimeBundle("thoth.loop", harness.THOTH_RUNTIME_BUNDLE_CATALOG);

const prompt = [
  "You are an independent research judge for the Thoth target-anchored Loop architecture.",
  "Do not modify files. Judge behavioral evidence, not implementation claims.",
  "",
  "Pass only if the Skill, RuntimeBundle, deterministic report, and golden scenarios establish:",
  "- one stable Task Anchor is the sole target; there is no fixed goals array, contract-audit goal, verification-last goal, or mechanically flat decomposition;",
  "- the Agent owns mutable Working Set, hypothesis, next move, Work Unit, ordering, and technical route, while the Harness owns execution, evidence, independent Review, context lifecycle, budgets, and stop fences;",
  "- each Execute attempt receives only the stable anchor plus compact active gap, hypothesis, latest Review, relevant evidence, rejected routes, and blockers, not a full transcript or Blackboard dump;",
  "- an Executor freely makes one meaningful real increment and submits one compact checkpoint; terminal without a checkpoint gets at most one repair;",
  "- every checkpoint triggers a fresh read-only Review that first investigates Workspace reality and the Evidence Index, without receiving private Executor reasoning or modifying files;",
  "- Review uses only continue, reorient, complete, need_human, or blocked, with concise reason/evidence and optional next focus; complete maps every Acceptance Claim to evidence;",
  "- passing local tests cannot hide objective drift, invariant violation, false-green behavior, or lack of real progress;",
  "- reorient preserves rejected routes and triggers fresh context when cognition drifts, a route is invalid, pressure is critical, recovery fails, or two attempts add no real evidence;",
  "- same-model Executor and Reviewer are acceptable because role, fresh context, read-only boundary, and evidence independence create the separation;",
  "- Human-owned changes to objective, invariants, acceptance, or risk pause the Task and reopen Clarify on the source visible Agent; ordinary Agent decisions do not;",
  "- native Plan is used when honestly supported, normal Agent deliberation otherwise, without provider-name branches or prompt pretending to be native Plan;",
  "- Single/Light/Balanced/Infinite budgets count non-complete Reviews, budget exhaustion waits rather than pretending completion, and Stop fences all late events;",
  "- the semantic tool surface is limited to checkpoint, review decision, Human decision request, and blocked report.",
  "",
  "End with exactly JUDGE_RESULT: PASS if every criterion is supported. Otherwise list failures and end with exactly JUDGE_RESULT: FAIL.",
  "",
  "## Deterministic cognition report",
  JSON.stringify(evalReport, null, 2),
  "",
  "## Formal authority and public API behavior evidence",
  JSON.stringify(behaviorEvidence, null, 2),
  "",
  "## Installed Skill",
  JSON.stringify(
    {
      path: artifact.path,
      digest: artifact.digest,
      frontmatter: artifact.frontmatter,
      source: artifact.source,
    },
    null,
    2,
  ),
  "",
  "## RuntimeBundle",
  JSON.stringify(bundle, null, 2),
  "",
  "## Golden scenarios",
  JSON.stringify(loopGolden.LOOP_GOLDEN_SCENARIOS, null, 2),
  "",
  "## Harness boundary golden evidence",
  JSON.stringify(loopGolden.LOOP_HARNESS_GOLDEN_EVIDENCE, null, 2),
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
if (judge.error) {
  console.error(`Failed to run codex exec judge: ${judge.error.message}`);
  process.exit(1);
}
if (judge.status !== 0) {
  console.error(judge.stdout);
  console.error(judge.stderr);
  process.exit(judge.status ?? 1);
}
const judgeText = readFileSync(judgePath, "utf8");
if (!judgeText.includes("JUDGE_RESULT: PASS")) {
  console.error(`Loop cognition judge did not pass. Evidence: ${judgePath}`);
  process.exit(1);
}
console.log("Loop cognition judge: PASS");
console.log(`Deterministic evidence: ${evalPath}`);
console.log(`Formal behavior evidence: ${behaviorReceiptPath}`);
console.log(`Independent judge evidence: ${judgePath}`);
