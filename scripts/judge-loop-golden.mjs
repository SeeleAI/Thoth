import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const judgeModel = process.env.THOTH_CODEX_JUDGE_MODEL ?? "gpt-5.5";
const artifactsDir = resolve(repoRoot, ".agent-os/artifacts");
mkdirSync(artifactsDir, { recursive: true });

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const evalPath = resolve(artifactsDir, `loop-golden-eval-${timestamp}.json`);
const judgePath = resolve(artifactsDir, `loop-golden-codex-judge-${timestamp}.md`);

const evalJson = execFileSync(
  process.execPath,
  [resolve(repoRoot, "packages/drivers/dist/loop/eval.js"), "--json"],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
);
writeFileSync(evalPath, evalJson);

const evalReport = JSON.parse(evalJson);
if (!evalReport.passed) {
  console.error(`Loop deterministic eval failed before judge: ${evalPath}`);
  process.exit(1);
}

const { LOOP_GOLDEN_SCENARIOS } = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/loop/golden.js")).href
);
const clarify = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/clarify/index.js")).href
);
const harness = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/harness/index.js")).href
);
const artifact = clarify.loadRuntimeSkillArtifact("thoth.loop");
const bundle = harness.loadRuntimeBundle("thoth.loop", harness.THOTH_RUNTIME_BUNDLE_CATALOG);

const prompt = [
  "You are an independent judge for Thoth Loop background PlanExec/Review quality.",
  "",
  "Review the installed `thoth.loop` Skill artifact, deterministic eval report, and golden scenarios. Do not change files.",
  "Judge whether they are sufficient to prevent these failure modes:",
  "- PlanExec asks the user for new clarification after Task/Goals are frozen",
  "- PlanExec jumps to a later goal or edits outside the current goal boundary",
  "- Review only runs tests mechanically instead of validating evidence against acceptance",
  "- Review reads PlanExec self-report before conducting an independent investigation",
  "- Review follows a locally plausible incremental route instead of naming the real diagnosis, abandoned route, reframing, and next highest-leverage direction",
  "- Review modifies source files",
  "- Review pass consumes failed-review budget",
  "- Review retry lacks a grounded Direction Memo or treats daemon budget mechanics as evaluation criteria",
  "- Retry mechanically repeats the same failed strategy",
  "- Budget exhaustion silently continues or pretends blocked instead of entering budget wait with the latest verdict",
  "- Permission or provider failures are treated as Review failures",
  "- All-goals completion is claimed before every linear goal passes Review",
  "",
  "If all cases pass, end the final answer with exactly: JUDGE_RESULT: PASS",
  "If any case fails, list each failure and end with exactly: JUDGE_RESULT: FAIL",
  "",
  "## Deterministic Eval Report",
  JSON.stringify(evalReport, null, 2),
  "",
  "## Canonical Skill Artifact",
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
  "## RuntimeBundle Evidence",
  JSON.stringify(bundle, null, 2),
  "",
  "## Loop Golden Scenarios",
  JSON.stringify(LOOP_GOLDEN_SCENARIOS, null, 2),
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
  {
    cwd: repoRoot,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  },
);

if (judge.error) {
  console.error(`Failed to run codex exec judge: ${judge.error.message}`);
  process.exit(1);
}
if (judge.status !== 0) {
  console.error(judge.stdout);
  console.error(judge.stderr);
  console.error(`codex exec judge failed with status ${judge.status}`);
  process.exit(judge.status ?? 1);
}

const judgeText = readFileSync(judgePath, "utf8");
if (!judgeText.includes("JUDGE_RESULT: PASS")) {
  console.log(judge.stdout);
  console.error(`Loop codex judge did not pass. Evidence: ${judgePath}`);
  process.exit(1);
}

console.log("Loop codex judge: PASS");
console.log(`Deterministic eval evidence: ${evalPath}`);
console.log(`Codex judge evidence: ${judgePath}`);
