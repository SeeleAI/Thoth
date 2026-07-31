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
  "EXPAND_TREE",
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
  "Decision Tree",
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
  "decision_sessions",
  "decision_tree_nodes",
  "decision_tree_cross_links",
  "decision_tree_activity",
  "decision_session_turns",
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

const authorityStore = source(
  "packages/daemon/src/server/workspace-authority/workspace-authority-store.ts",
);
for (const required of [
  "const rootNodeId = `decision-root-${randomUUID()}`",
  "node.id !== snapshot.session.rootNodeId && node.parentId === null",
  "assertDecisionTree(",
  "Decision Session no longer accepts Decision Tree updates",
  "A Task can be registered only after its Decision Tree is frozen.",
]) {
  if (!authorityStore.includes(required)) {
    failures.push(`Decision Session authority is missing ${required}`);
  }
}

const decisionTreeNodeTable = storageSchema.slice(
  storageSchema.indexOf("CREATE TABLE decision_tree_nodes"),
  storageSchema.indexOf("CREATE TABLE decision_tree_cross_links"),
);
for (const forbidden of [
  "chain_of_thought",
  "reasoning",
  "token",
  "provider_thread",
  "provider_session",
  "model",
  "lease",
  "cursor",
  "receipt",
  "hash",
  "prompt",
]) {
  if (decisionTreeNodeTable.includes(forbidden)) {
    failures.push(
      `Decision Tree node storage contains forbidden runtime/cognition field ${forbidden}`,
    );
  }
}

if (failures.length > 0) {
  console.error("Thoth cognition architecture contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      schemaVersion: 2,
      passed: true,
      checks: [
        {
          id: "legacy-task-goals-path-removed",
          detail:
            "Production roots contain no legacy Task/Goals card convergence, retired Runtime Tool, or goal-backed authority path.",
        },
        {
          id: "minimal-provider-neutral-runtime-tools",
          detail:
            "Clarify and Loop expose only the canonical semantic tool catalogs; provider mechanics remain outside cognition.",
        },
        {
          id: "single-root-decision-tree",
          detail:
            "Workspace authority creates one stable objective root, rejects additional parentless nodes, validates tree topology, and freezes before Task registration.",
        },
        {
          id: "decision-tree-public-fields-only",
          detail:
            "decision_tree_nodes stores public title, summary, ownership, materiality, status, resolution reference, source references, priority, and revision only; it has no hidden reasoning, model, provider, token, receipt, hash, cursor, lease, or prompt field.",
        },
        {
          id: "workspace-authority-schema-v7",
          detail:
            "Decision Sessions, session turns, tree nodes, cross-links, activity, Intent Contracts, acceptance claims, Loop cycles, working sets, work units, and review decisions are the sole cognition authority tables.",
        },
      ],
    },
    null,
    2,
  ),
);

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
