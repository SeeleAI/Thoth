import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const judgeModel = process.env.THOTH_CODEX_JUDGE_MODEL ?? "gpt-5.5";
const artifactsDir = resolve(repoRoot, ".agent-os/artifacts");
mkdirSync(artifactsDir, { recursive: true });

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const evalPath = resolve(artifactsDir, `clarify-cognition-eval-${timestamp}.json`);
const behaviorReceiptPath = resolve(
  artifactsDir,
  `clarify-cognition-behavior-receipt-${timestamp}.json`,
);
const behaviorRunPath = resolve(artifactsDir, `clarify-cognition-behavior-run-${timestamp}.log`);
const sessionReceiptPath = resolve(
  artifactsDir,
  `clarify-cognition-provider-session-receipt-${timestamp}.json`,
);
const sessionRunPath = resolve(
  artifactsDir,
  `clarify-cognition-provider-session-run-${timestamp}.log`,
);
const architecturePath = resolve(artifactsDir, `clarify-cognition-architecture-${timestamp}.log`);
const judgePath = resolve(artifactsDir, `clarify-cognition-codex-judge-${timestamp}.md`);
const evalJson = execFileSync(
  process.execPath,
  [resolve(repoRoot, "packages/drivers/dist/clarify/eval.js"), "--json"],
  { cwd: repoRoot, encoding: "utf8" },
);
writeFileSync(evalPath, evalJson);
const evalReport = JSON.parse(evalJson);
if (!evalReport.passed) {
  console.error(`Clarify deterministic cognition eval failed before judge: ${evalPath}`);
  process.exit(1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const sessionRun = spawnSync(
  npm,
  [
    "run",
    "test:e2e:foreground-thoth",
    "--workspace=@thoth/daemon",
    "--",
    "-t",
    "UT-02 hot-switches raw -> Quick Clarify -> raw on one visible provider session",
  ],
  {
    cwd: repoRoot,
    env: { ...process.env, THOTH_CLARIFY_BEHAVIOR_RECEIPT_PATH: sessionReceiptPath },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  },
);
writeFileSync(sessionRunPath, `${sessionRun.stdout ?? ""}\n${sessionRun.stderr ?? ""}`, "utf8");
if (sessionRun.error || sessionRun.status !== 0) {
  console.error(
    sessionRun.error?.message ??
      `Clarify Provider session journey failed with exit ${sessionRun.status}. Evidence: ${sessionRunPath}`,
  );
  process.exit(sessionRun.status ?? 1);
}
const behaviorRun = spawnSync(
  npm,
  [
    "run",
    "test:e2e:foreground-thoth",
    "--workspace=@thoth/daemon",
    "--",
    "-t",
    "Clarify public authority proves propagation, delegation scope, and Intent Contract confirmation",
  ],
  {
    cwd: repoRoot,
    env: { ...process.env, THOTH_CLARIFY_BEHAVIOR_RECEIPT_PATH: behaviorReceiptPath },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  },
);
writeFileSync(behaviorRunPath, `${behaviorRun.stdout ?? ""}\n${behaviorRun.stderr ?? ""}`, "utf8");
if (behaviorRun.error || behaviorRun.status !== 0) {
  console.error(
    behaviorRun.error?.message ??
      `Clarify public API behavior journey failed with exit ${behaviorRun.status}. Evidence: ${behaviorRunPath}`,
  );
  process.exit(behaviorRun.status ?? 1);
}
const providerSessionReceipt = JSON.parse(readFileSync(sessionReceiptPath, "utf8"));
const behaviorReceipt = JSON.parse(readFileSync(behaviorReceiptPath, "utf8"));
const confirmation = behaviorReceipt.contractConfirmation;
const singleNodeRecommendation = behaviorReceipt.singleNodeRecommendation;
const subtreeDelegation = behaviorReceipt.subtreeDelegation;
const continuity = behaviorReceipt.decisionSessionContinuity;
const persistedTree = behaviorReceipt.persistedDecisionTree;
const frontierProtection = behaviorReceipt.frontierProtection;
if (
  providerSessionReceipt.schemaVersion !== 1 ||
  !Array.isArray(providerSessionReceipt.visibleClarifySessionIds) ||
  providerSessionReceipt.visibleClarifySessionIds.length !== 1 ||
  providerSessionReceipt.visibleClarifySessionIds[0] !==
    providerSessionReceipt.visibleProviderSessionId ||
  providerSessionReceipt.challengerProviderSessionId ===
    providerSessionReceipt.visibleProviderSessionId ||
  providerSessionReceipt.challengerLaunchCount !== 1 ||
  providerSessionReceipt.judgeContractToolCallCount !== 1 ||
  providerSessionReceipt.challengerUsed !== true ||
  providerSessionReceipt.visibleSessionReusedAfterClarify !== true ||
  behaviorReceipt.schemaVersion !== 3 ||
  continuity?.initialSessionId !== continuity?.propagatedSessionId ||
  continuity?.initialRootNodeId !== continuity?.propagatedRootNodeId ||
  continuity?.initialRootIsOnlyRoot !== true ||
  continuity?.nextObjectiveCreatedNewSession !== true ||
  continuity?.frozenSessionRemainedImmutable !== true ||
  typeof continuity?.rejectedFrozenMutation !== "string" ||
  !continuity.rejectedFrozenMutation.includes("not an open frontier") ||
  persistedTree?.rootNodeCount !== 1 ||
  persistedTree?.persistedNodeCount < 4 ||
  !Array.isArray(persistedTree?.storedNodeFieldNames) ||
  !Array.isArray(persistedTree?.forbiddenNodeFieldNames) ||
  persistedTree.forbiddenNodeFieldNames.length !== 0 ||
  frontierProtection?.staleCardRejected !== true ||
  frontierProtection?.prunedSiblingCannotBecomeCurrent !== true ||
  confirmation?.intentCardPending !== true ||
  confirmation?.treeLifecycleBefore !== "ready_to_confirm" ||
  confirmation?.activityBefore !== "ready_to_confirm" ||
  confirmation?.contractStatusBefore !== "proposed" ||
  confirmation?.confirmedAtBefore !== null ||
  confirmation?.finalConfirmationPolicy !== "automatic" ||
  confirmation?.automaticPolicyStillRequiredIntentCard !== true ||
  confirmation?.humanAcceptanceAccepted !== true ||
  confirmation?.submittedCard !== true ||
  confirmation?.treeLifecycleAfter !== "frozen" ||
  confirmation?.activityAfter !== "frozen" ||
  confirmation?.contractStatusAfter !== "confirmed" ||
  confirmation?.confirmedAtRecorded !== true ||
  confirmation?.taskRegistered !== true ||
  singleNodeRecommendation?.intent !== "recommend" ||
  singleNodeRecommendation?.targetStatus !== "delegated" ||
  !Array.isArray(singleNodeRecommendation?.deltaNodeIds) ||
  singleNodeRecommendation.deltaNodeIds.length !== 1 ||
  singleNodeRecommendation?.newlyMaterialChildParentId !== "UT07-strategy" ||
  singleNodeRecommendation?.newlyMaterialChildStatus !== "awaiting_human" ||
  singleNodeRecommendation?.prunedSiblingStatus !== "pruned" ||
  subtreeDelegation?.intent !== "delegate_subtree" ||
  subtreeDelegation?.targetStatus !== "delegated" ||
  subtreeDelegation?.descendantStatus !== "delegated" ||
  !Array.isArray(subtreeDelegation?.deltaNodeIds) ||
  !subtreeDelegation.deltaNodeIds.includes(subtreeDelegation.targetNodeId) ||
  !subtreeDelegation.deltaNodeIds.includes(subtreeDelegation.descendantNodeId)
) {
  console.error(`Clarify behavior receipt is invalid: ${behaviorReceiptPath}`);
  process.exit(1);
}

const architectureRun = spawnSync(
  process.execPath,
  [resolve(repoRoot, "scripts/check-thoth-cognition-architecture.mjs")],
  { cwd: repoRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 20 },
);
writeFileSync(
  architecturePath,
  `${architectureRun.stdout ?? ""}\n${architectureRun.stderr ?? ""}`,
  "utf8",
);
if (architectureRun.error || architectureRun.status !== 0) {
  console.error(
    architectureRun.error?.message ??
      `Clarify architecture residue check failed with exit ${architectureRun.status}. Evidence: ${architecturePath}`,
  );
  process.exit(architectureRun.status ?? 1);
}
const architectureReport = JSON.parse(readFileSync(architecturePath, "utf8"));
if (
  architectureReport.schemaVersion !== 2 ||
  architectureReport.passed !== true ||
  !Array.isArray(architectureReport.checks) ||
  architectureReport.checks.length < 5
) {
  console.error(`Clarify architecture receipt is invalid: ${architecturePath}`);
  process.exit(1);
}

const clarify = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/clarify/index.js")).href
);
const harness = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/harness/index.js")).href
);
const artifact = clarify.loadRuntimeSkillArtifact("thoth.clarify");
const bundle = harness.loadRuntimeBundle("thoth.clarify", harness.THOTH_RUNTIME_BUNDLE_CATALOG);

const prompt = [
  "You are an independent research judge for the Thoth Clarify cognitive architecture.",
  "Do not change files. Judge the installed Skill, immutable RuntimeBundle, deterministic metrics, and golden scenarios as behavioral evidence rather than trusting implementation claims.",
  "",
  "Pass only if the evidence establishes all of the following:",
  "- Clarify is a provider-neutral evidence-driven cognitive Agent in the same visible Provider session, not a form generator or daemon semantic classifier. The one fresh Challenger is an explicit separate internal Provider thread and is not a replacement visible conversation.",
  "- Its state machine grounds in Workspace reality, expands a persistent Decision Tree with one semantic objective root and one semantic parent per node, uses explicit cross-links only where needed, auto-resolves Agent/Evidence-owned descendants, self-challenges, asks Human-owned material forks, propagates answers, checks stability, runs exactly one fresh-context Challenger, proposes one Intent Contract, and waits for Human confirmation.",
  "- The Decision Tree records only visible conclusions, ownership, status, sources, and stable references; actual persisted node fields contain no chain-of-thought, fabricated numeric confidence, Provider mechanics, tokens, prompts, receipts, hashes, leases, or cursors.",
  "- Questions target parent/root choices and high-impact leaves while the Agent fills ordinary descendants. Discoverable facts and standard implementation decisions are not delegated to the Human.",
  "- One card contains 1-4 related forks with 2-4 concise options, consequences, a recommendation, notes, single-node delegation, and subtree delegation.",
  "- Light limits expansion to structural objective/acceptance/irreversible risk, Balanced covers the material frontier, and Dive recursively expands all material branches without a question-count quota.",
  "- The ray-tracer Dive case asks at least 30 genuinely material Human-owned product, acceptance, risk, compatibility, cost, or governance questions. Each has an explicit ownership rationale and avoids asking the human to choose internal algorithms or ordinary implementation mechanics.",
  "- Parent resolution prunes or delegates descendants and each Human answer removes meaningful branches; repeated, low-value, and already-resolved questions fail.",
  "- The final Intent Contract freezes objective, non-goals, invariants, acceptance claims, risk boundary, Human decision refs, and escalation policy, not a linear execution plan.",
  "- The sole Challenger can reopen concrete missing material nodes once, but cannot create an endless critic loop.",
  "- Runtime tools are the small semantic surface for map update, ask, contract proposal, blocked report, and internal contract judgment; provider mechanics and tokens stay outside cognition.",
  "- The artifact contains no legacy Task/Goals card convergence path, packet repair state, fallback scope, provider-specific business branch, or prompt-simulated native capability.",
  "- `finalConfirmation: automatic` belongs to post-execution task completion only; it never substitutes for the pending Human Intent Contract Card. The public authority receipt must prove that Card's pending-to-confirmed transition.",
  "",
  "End with exactly JUDGE_RESULT: PASS when all criteria are supported. Otherwise list concrete failures and end with exactly JUDGE_RESULT: FAIL.",
  "",
  "## Deterministic cognition report",
  JSON.stringify(evalReport, null, 2),
  "",
  "## Formal public API behavior receipt",
  JSON.stringify(behaviorReceipt, null, 2),
  "",
  "## Formal Provider session and one-shot Challenger receipt",
  JSON.stringify(providerSessionReceipt, null, 2),
  "",
  "## Deterministic architecture residue receipt",
  JSON.stringify(architectureReport, null, 2),
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
  JSON.stringify(clarify.CLARIFY_GOLDEN_SCENARIOS, null, 2),
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
  console.error(`Clarify cognition judge did not pass. Evidence: ${judgePath}`);
  process.exit(1);
}
console.log("Clarify cognition judge: PASS");
console.log(`Deterministic evidence: ${evalPath}`);
console.log(`Public API behavior evidence: ${behaviorReceiptPath}`);
console.log(`Provider session evidence: ${sessionReceiptPath}`);
console.log(`Architecture evidence: ${architecturePath}`);
console.log(`Independent judge evidence: ${judgePath}`);
