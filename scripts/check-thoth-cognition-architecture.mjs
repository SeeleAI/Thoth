#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const productionRoots = [
  "packages/protocol/src",
  "packages/core/src",
  "packages/client/src",
  "packages/drivers/src",
  "packages/daemon/src",
  "packages/app/src",
  "packages/cli/src",
  "packages/tui/src",
];

forbidProduction(
  /\b(?:task_card|goal_card|C_TASK_CARD|C_GOAL_CARD|PlanExec|planexec|review_verdict|usedFailedReviews|currentGoalId|goalsRevision|latestReviewDirection|thoth_submit_[A-Za-z0-9_]+)\b|Direction Memo|Contract Preservation Audit/u,
  "legacy Task/Goals cognitive path",
);
forbidProduction(
  /\b(?:thoth_submit_task_card|thoth_submit_goal_card|thoth_submit_planexec_result|thoth_submit_review_assessment)\b/u,
  "retired Runtime Tool",
);

const taskAuthority = source("packages/protocol/src/task-authority.ts");
for (const required of [
  "sourceAgentWorkspaceId",
  "intentContract",
  "workingSet",
  "workUnits",
  "latestReview",
  "completionAuthority",
  'z.enum(["quick_exec", "execute", "review"])',
]) {
  if (!taskAuthority.includes(required)) failures.push(`Task authority is missing ${required}`);
}
for (const forbidden of ["goals:", "currentGoalId", "goalsRevision", "latestReviewDirection"]) {
  if (taskAuthority.includes(forbidden))
    failures.push(`Task authority still contains ${forbidden}`);
}

const runtimeContract = source("packages/protocol/src/thoth-runtime-contract.ts");
for (const tool of [
  "thoth_clarify_update_map",
  "thoth_clarify_ask",
  "thoth_clarify_propose_contract",
  "thoth_clarify_report_blocked",
  "thoth_clarify_judge_contract",
  "thoth_loop_checkpoint",
  "thoth_loop_review_decision",
  "thoth_loop_request_human_decision",
  "thoth_loop_report_blocked",
]) {
  if (!runtimeContract.includes(`"${tool}"`)) failures.push(`Runtime contract is missing ${tool}`);
}
const retiredCognitiveTools = [
  "thoth_get_bound_task_progress",
  "thoth_list_workspace_scripts",
  "thoth_start_workspace_script",
  "thoth_stop_workspace_script",
];
const runtimeToolSurfaces = [
  ["Runtime contract", runtimeContract],
  ["RuntimeBundle catalog", source("packages/drivers/src/harness/thoth-runtime-bundle-catalog.ts")],
  ["Clarify Skill", source("packages/drivers/src/runtime-skills/thoth-clarify/SKILL.md")],
  ["Loop Skill", source("packages/drivers/src/runtime-skills/thoth-loop/SKILL.md")],
  ["daemon semantic tools", source("packages/daemon/src/server/agent/tools/thoth-tools.ts")],
];
for (const retired of retiredCognitiveTools) {
  for (const [surface, contents] of runtimeToolSurfaces) {
    if (contents.includes(retired))
      failures.push(`${surface} still exposes retired tool ${retired}`);
  }
}

const clarifySkill = source("packages/drivers/src/runtime-skills/thoth-clarify/SKILL.md");
for (const state of [
  "GROUND",
  "EXPAND_MAP",
  "AUTO_RESOLVE",
  "SELF_CHALLENGE",
  "ASK",
  "PROPAGATE",
  "STABILITY_CHECK",
  "CHALLENGE_ONCE",
  "PROPOSE_CONTRACT",
  "HUMAN_CONFIRM",
  "COMMIT",
]) {
  if (!clarifySkill.includes(state)) failures.push(`Clarify Skill is missing state ${state}`);
}
for (const concept of [
  "Decision Map",
  "Human-owned",
  "Evidence-owned",
  "subtree",
  "no question-count cap",
]) {
  if (!clarifySkill.includes(concept)) failures.push(`Clarify Skill is missing ${concept}`);
}

const loopSkill = source("packages/drivers/src/runtime-skills/thoth-loop/SKILL.md");
for (const concept of [
  "Task Anchor",
  "Working Set",
  "Work Unit",
  "fresh independent Review",
  "A reset",
  "thoth_loop_checkpoint",
  "thoth_loop_review_decision",
]) {
  if (!loopSkill.includes(concept)) failures.push(`Loop Skill is missing ${concept}`);
}

const storageSchema = source("packages/daemon/src/server/storage-schema.ts");
for (const table of [
  "clarify_sessions",
  "clarify_decision_nodes",
  "intent_contracts",
  "acceptance_claims",
  "loop_cycles",
  "task_working_sets",
  "task_work_units",
  "review_decisions",
]) {
  if (!storageSchema.includes(`CREATE TABLE ${table}`))
    failures.push(`Storage is missing ${table}`);
}
for (const retired of ["CREATE TABLE task_goals", "CREATE TABLE task_blackboard", "goal_id TEXT"]) {
  if (storageSchema.includes(retired)) failures.push(`Storage still contains ${retired}`);
}

if (failures.length > 0) {
  console.error("Thoth cognition architecture contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Thoth Decision Map and target-anchored Loop architecture verified.");

function source(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function forbidProduction(pattern, label) {
  let output = "";
  try {
    output = execFileSync(
      "rg",
      [
        "-n",
        "--glob",
        "*.ts",
        "--glob",
        "*.tsx",
        "--glob",
        "*.md",
        "--glob",
        "!*.test.ts",
        "--glob",
        "!*.test.tsx",
        "--glob",
        "!*.e2e.test.ts",
        "--glob",
        "!**/test-fixtures/**",
        "--glob",
        "!**/storage-v6-migration.ts",
        pattern.source,
        ...productionRoots,
      ],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (output) failures.push(`${label} remains:\n${output.split("\n").slice(0, 12).join("\n")}`);
}
