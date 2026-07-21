import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const judgeModel = process.env.THOTH_CODEX_JUDGE_MODEL ?? "gpt-5.5";
const artifactsDir = resolve(repoRoot, ".agent-os/artifacts");
mkdirSync(artifactsDir, { recursive: true });

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const evalPath = resolve(artifactsDir, `clarify-golden-eval-${timestamp}.json`);
const judgePath = resolve(artifactsDir, `clarify-golden-codex-judge-${timestamp}.md`);

const evalJson = execFileSync(
  process.execPath,
  [resolve(repoRoot, "packages/drivers/dist/clarify/eval.js"), "--json"],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
);
writeFileSync(evalPath, evalJson);

const evalReport = JSON.parse(evalJson);
if (!evalReport.passed) {
  console.error(`Clarify deterministic eval failed before judge: ${evalPath}`);
  process.exit(1);
}

const { CLARIFY_GOLDEN_SCENARIOS } = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/clarify/golden.js")).href
);
const clarify = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/clarify/index.js")).href
);
const harness = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/harness/index.js")).href
);
const artifact = clarify.loadRuntimeSkillArtifact("thoth.clarify");
const bundle = harness.loadRuntimeBundle("thoth.clarify", harness.THOTH_RUNTIME_BUNDLE_CATALOG);
const skillRef = { id: bundle.id, digest: bundle.digest };
const normalTurnEnvelope = clarify.buildClarifyProviderInputEnvelope({
  sessionId: "sec_golden_judge",
  taskId: null,
  currentState: "C_ASK",
  userInput: "继续",
  clarify: "balanced",
  mode: "loop",
  loop: "balanced",
  transcriptRef: "transcript:sec_golden_judge:v4",
  assumptionLedgerRef: "assumptions:sec_golden_judge:v4",
  decisionTreeFrontierRef: "frontier:sec_golden_judge:v4",
  contextSummary: "workspace facts already discovered",
});
const transitionPacket = clarify.buildClarifyTransitionInputPacket({
  sessionId: "sec_golden_judge",
  from: "C_ASK",
  to: "C_TASK_CARD",
  userInput: "按刚才说的注册后台任务",
  transcriptRef: "transcript:sec_golden_judge:v5",
  clarify: "dive",
  mode: "loop",
  loop: "balanced",
  controlsChanged: {
    clarify_strength_from: "balanced",
    clarify_strength_to: "dive",
    reason: "judge fixture verifies strength-change marker",
  },
  skillRef,
});
const repairPacket = clarify.buildClarifyRepairInputPacket({
  sessionId: "sec_golden_judge",
  previousState: "C_ASK",
  intendedOutputState: "C_ASK",
  badOutput: '{"type":"clarify","code":"C_ASK"}',
  schemaErrors: ["C_ASK packets must include content.question_card"],
  skillRef,
});

const prompt = [
  "You are an independent judge for Thoth NTH-TD-015.",
  "",
  "Review the following installed `thoth.clarify` Skill artifact, invocation packets, repair packet, and golden evidence. Do not change files.",
  "Judge whether the golden transcripts and packets satisfy:",
  "- standard cross-provider SKILL.md artifact, not Codex-only metadata",
  "- immutable content-addressed RuntimeBundle attachment, independent of provider home",
  "- normal same-state input packets do not repeat full Skill rules",
  "- transition packets carry skill_ref/digest and according_to_loaded_skill without copying rules",
  "- repair packets repair shape/state/provenance only without semantic reinterpretation",
  "- clarify strength changes real behavior: none direct, light core fork, balanced core plus leaves, dive material assumptions",
  "- assumption owners distinguish user_must_decide, agent_can_decide, agent_can_discover, and standard_answer/common_sense",
  "- decision-tree frontier asks only high-value user-owned branches",
  "- secretary-like behavioral psychology, not a field questionnaire",
  "- behavior-tree convergence toward Quick / Clarify / Task Card / blocked",
  "- preservation of the user's original target",
  "- no fallback-scope downgrade to MVP/demo/mock/partial substitutes",
  "- no low-value or repeated question",
  "- no pushing agent-discoverable facts to the user",
  "- no unsolicited default recommendation",
  "- C_ASK card constraints: one title, 2-4 questions, short choices, note support, hidden internal meta",
  "- C_ASK internal meta records effective strength, tree depth, QA round count, remaining material assumptions, and question value reason",
  "- C_TASK_CARD transcript provenance",
  "- C_GOAL_CARD transcript plus approved CEO Task Card provenance",
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
  "## Normal Turn Envelope",
  JSON.stringify(normalTurnEnvelope, null, 2),
  "",
  "## Transition Packet",
  JSON.stringify(transitionPacket, null, 2),
  "",
  "## Repair Packet",
  JSON.stringify(repairPacket, null, 2),
  "",
  "## Golden Scenarios",
  JSON.stringify(CLARIFY_GOLDEN_SCENARIOS, null, 2),
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
  console.error(`Clarify codex judge did not pass. Evidence: ${judgePath}`);
  process.exit(1);
}

console.log("Clarify codex judge: PASS");
console.log(`Deterministic eval evidence: ${evalPath}`);
console.log(`Codex judge evidence: ${judgePath}`);
