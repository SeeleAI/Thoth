import { pathToFileURL } from "node:url";
import {
  ThothLoopCheckpointInputSchema,
  ThothLoopReviewDecisionInputSchema,
} from "@thoth/protocol/thoth-runtime-contract";
import { loadRuntimeSkillArtifact, validateLoopRuntimeSkillArtifact } from "../clarify/contract.js";
import { loadRuntimeBundle } from "../harness/runtime-bundle.js";
import { THOTH_RUNTIME_BUNDLE_CATALOG } from "../harness/thoth-runtime-bundle-catalog.js";
import {
  LOOP_GOLDEN_SCENARIOS,
  LOOP_HARNESS_GOLDEN_EVIDENCE,
  type LoopGoldenScenario,
} from "./golden.js";

export interface LoopEvalScenarioResult {
  id: string;
  passed: boolean;
  failures: string[];
}

export interface LoopEvalReport {
  passed: boolean;
  scenarioCount: number;
  results: LoopEvalScenarioResult[];
  harnessChecks: LoopEvalScenarioResult[];
}

function evaluateScenario(scenario: LoopGoldenScenario): LoopEvalScenarioResult {
  const failures: string[] = [];
  const checkpoint = ThothLoopCheckpointInputSchema.safeParse(scenario.checkpoint);
  if (!checkpoint.success) failures.push(`checkpoint schema: ${checkpoint.error.message}`);
  const review = ThothLoopReviewDecisionInputSchema.safeParse(scenario.review);
  if (!review.success) failures.push(`review schema: ${review.error.message}`);
  if (!scenario.reviewReadOnly) failures.push("fresh Review must be read-only");
  if (scenario.review.decision !== scenario.expectedDecision) {
    failures.push(`expected ${scenario.expectedDecision}, observed ${scenario.review.decision}`);
  }
  if (scenario.review.decision === "complete") {
    const mapped = new Set(Object.keys(scenario.review.acceptanceEvidence));
    for (const claimId of scenario.taskAnchor.acceptanceClaimIds) {
      if (!mapped.has(claimId) || scenario.review.acceptanceEvidence[claimId]?.length === 0) {
        failures.push(`complete omits evidence for ${claimId}`);
      }
    }
  }
  if (scenario.review.decision === "reorient" && scenario.review.rejectedRoutes.length === 0) {
    failures.push("reorient must preserve at least one rejected route");
  }
  if (scenario.expectReset && scenario.review.decision !== "reorient") {
    failures.push("context reset requires a semantic reorientation decision");
  }
  return { id: scenario.id, passed: failures.length === 0, failures };
}

export function runLoopEval(): LoopEvalReport {
  const artifact = loadRuntimeSkillArtifact("thoth.loop");
  const failures = validateLoopRuntimeSkillArtifact(artifact);
  const bundle = loadRuntimeBundle("thoth.loop", THOTH_RUNTIME_BUNDLE_CATALOG);
  const expectedTools = [
    "thoth_loop_checkpoint",
    "thoth_loop_review_decision",
    "thoth_loop_request_human_decision",
    "thoth_loop_report_blocked",
  ];
  const actualTools = bundle.tools.map((candidate) => candidate.name);
  if (
    actualTools.length !== expectedTools.length ||
    expectedTools.some((tool) => !actualTools.includes(tool))
  ) {
    failures.push(
      `RuntimeBundle tools must be exactly ${expectedTools.join(", ")}; observed ${actualTools.join(", ")}`,
    );
  }
  if (!bundle.scopes.includes("loop_execute") || !bundle.scopes.includes("loop_review")) {
    failures.push("RuntimeBundle is missing Loop execution scopes");
  }
  const results = LOOP_GOLDEN_SCENARIOS.map(evaluateScenario);
  if (failures.length > 0) results.unshift({ id: "runtime-skill", passed: false, failures });
  const evidence = LOOP_HARNESS_GOLDEN_EVIDENCE;
  const harnessChecks: LoopEvalScenarioResult[] = [
    check(
      "compact-execute-input",
      [
        "task_anchor",
        "active_gap",
        "current_hypothesis",
        "latest_review",
        "relevant_evidence",
        "rejected_routes",
        "blockers",
      ].every((field) => evidence.executeInputBoundary.included.includes(field as never)) &&
        ["full_provider_transcript", "blackboard_dump", "private_executor_reasoning"].every(
          (field) => evidence.executeInputBoundary.excluded.includes(field as never),
        ),
      "Execute input boundary is not compact or excludes no private context",
    ),
    check(
      "fresh-review-isolation",
      evidence.freshReviewBoundary.freshThread &&
        evidence.freshReviewBoundary.readOnly &&
        evidence.freshReviewBoundary.sameModelAllowed &&
        evidence.freshReviewBoundary.inputOrder.join(",") ===
          "task_anchor,workspace_reality,evidence_index" &&
        evidence.freshReviewBoundary.excluded.includes("executor_private_reasoning"),
      "fresh Review role, ordering, or context isolation is incomplete",
    ),
    check(
      "native-and-managed-plan-policy",
      evidence.planCapabilityPolicy[0].claimsNativeReceipt === true &&
        evidence.planCapabilityPolicy[1].claimsNativeReceipt === false &&
        evidence.planCapabilityPolicy[1].executeMode === "normal_agent_deliberation",
      "Plan capability policy fabricates or omits a native receipt",
    ),
    check(
      "single-repair-limit",
      evidence.terminalWithoutSemanticResult.length === 2 &&
        evidence.terminalWithoutSemanticResult[0].action === "one_same_lineage_repair" &&
        evidence.terminalWithoutSemanticResult[1].action === "interrupt_and_fresh_reorient",
      "terminal-without-semantic-result policy is not limited to one repair",
    ),
    check(
      "review-budgets",
      JSON.stringify(evidence.budgetPolicy) ===
        JSON.stringify([
          { strength: "single", maxNonCompleteReviews: 1 },
          { strength: "light", maxNonCompleteReviews: 5 },
          { strength: "balanced", maxNonCompleteReviews: 10 },
          { strength: "infinite", maxNonCompleteReviews: null },
        ]),
      "Single, Light, Balanced, and Infinite review budgets are inconsistent",
    ),
    check(
      "budget-exhaustion-waits",
      evidence.budgetExhaustion.countedDecision === "non_complete_review" &&
        evidence.budgetExhaustion.atLimitTaskStatus === "budget_wait" &&
        evidence.budgetExhaustion.completionAuthority === "none" &&
        evidence.budgetExhaustion.schedulesAnotherExecution === false &&
        evidence.budgetExhaustion.requiresExplicitRaiseBudget === true,
      "budget exhaustion does not enter an explicit non-complete wait",
    ),
    check(
      "stop-late-event-fence",
      evidence.stopFence.commandProjection === "stopping" &&
        evidence.stopFence.executionProjection === "cancel_requested" &&
        evidence.stopFence.spinnerRunning === false &&
        evidence.stopFence.lateCheckpointAccepted === false &&
        evidence.stopFence.lateReviewAccepted === false &&
        evidence.stopFence.lateApprovalAccepted === false,
      "Stop does not immediately fence every late semantic event",
    ),
  ];
  return {
    passed:
      results.every((result) => result.passed) && harnessChecks.every((result) => result.passed),
    scenarioCount: results.length,
    results,
    harnessChecks,
  };
}

function check(id: string, passed: boolean, failure: string): LoopEvalScenarioResult {
  return { id, passed, failures: passed ? [] : [failure] };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  const report = runLoopEval();
  process.stdout.write(
    `${JSON.stringify(report, null, process.argv.includes("--json") ? 2 : 0)}\n`,
  );
  if (!report.passed) process.exitCode = 1;
}
