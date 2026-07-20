import {
  ThothLoopPlanExecResultInputSchema,
  ThothLoopReviewVerdictInputSchema,
} from "@thoth/protocol/thoth-runtime-contract";
import { loadRuntimeSkillArtifact, mountRuntimeSkillForSession } from "../clarify/contract.js";
import { LOOP_GOLDEN_SCENARIOS, type LoopGoldenScenario } from "./golden.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface LoopEvalScenarioResult {
  id: string;
  passed: boolean;
  failures: string[];
  observedFailures?: string[];
}

export interface LoopEvalReport {
  passed: boolean;
  scenarioCount: number;
  results: LoopEvalScenarioResult[];
}

function result(
  id: string,
  failures: string[],
  observedFailures: string[] = [],
): LoopEvalScenarioResult {
  return {
    id,
    passed: failures.length === 0,
    failures,
    ...(observedFailures.length > 0 ? { observedFailures } : {}),
  };
}

function flattenText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(flattenText).join("\n");
  }
  if (value && typeof value === "object") {
    return Object.values(value).map(flattenText).join("\n");
  }
  return "";
}

function containsUserClarification(text: string): boolean {
  return (
    /\?/.test(text) ||
    /\b(ask|asking|question|clarify|clarification|which|choose)\b.{0,80}\b(user|you)\b/i.test(text)
  );
}

function meaningfulTokens(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[`'"()[\]{}.,:;!?/\\|-]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 5)
        .filter(
          (token) =>
            ![
              "previous",
              "round",
              "without",
              "before",
              "after",
              "review",
              "planexec",
              "failed",
              "failure",
              "strategy",
              "acceptance",
            ].includes(token),
        ),
    ),
  );
}

function evidenceIsGeneric(evidence: string | undefined): boolean {
  const value = evidence?.trim().toLowerCase() ?? "";
  return (
    !value ||
    /^(green|ok|passed|tests? passed|ran tests?\.?|all tests passed\.?)$/.test(value) ||
    value.length < 24
  );
}

function directionMemoIsShallow(input: {
  conclusion: string;
  reality: string[];
  diagnosis: string;
  abandon: string[];
  reframe: string;
  next_direction: string;
}): boolean {
  const combined = [
    input.conclusion,
    ...input.reality,
    input.diagnosis,
    ...input.abandon,
    input.reframe,
    input.next_direction,
  ].join(" ");
  return (
    input.reality.some((entry) => evidenceIsGeneric(entry)) ||
    input.diagnosis.trim().length < 24 ||
    input.abandon.length === 0 ||
    input.reframe.trim().length < 24 ||
    input.next_direction.trim().length < 24 ||
    /\b(try again|fix it|keep trying|run tests again|needs more work)\b/i.test(combined)
  );
}

function directionMemoUsesDaemonMechanics(text: string): boolean {
  return /\b(failed[- ]review budget|remaining budget|loop strength|loopstrength|phase[_ -]?run|task revision|receipt hash|retry count|attempts? remaining)\b/i.test(
    text,
  );
}

function textMentionsGoal(text: string, goalId: string): boolean {
  const escaped = goalId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function evaluateSkillArtifact(): LoopEvalScenarioResult {
  const artifact = loadRuntimeSkillArtifact("thoth.loop");
  const required = [
    "## Runtime Tools",
    "## PlanExec Rules",
    "## Review Rules",
    "thoth_loop_submit_planexec_result",
    "thoth_loop_submit_review_independent_assessment",
    "thoth_loop_submit_review_verdict",
    "thoth_loop_report_blocked",
    "Never ask the user clarifying questions",
    "Do not modify source files",
    "direction_memo",
    "independent corrective intelligence",
    "Direction Memo as the whole direction",
    "Thoth alone decides task lifecycle",
  ];
  const failures = required
    .filter((phrase) => !artifact.source.includes(phrase))
    .map((phrase) => `missing required thoth.loop phrase: ${phrase}`);
  if (artifact.frontmatter.name !== "thoth.loop") {
    failures.push("frontmatter name must be thoth.loop");
  }
  if (artifact.frontmatter.userInvocable !== false) {
    failures.push("thoth.loop must not be user-invocable");
  }
  return result("skill-artifact", failures);
}

function evaluateSessionMount(): LoopEvalScenarioResult {
  const tempRoot = mkdtempSync(join(tmpdir(), "thoth-loop-eval-"));
  try {
    const artifact = loadRuntimeSkillArtifact("thoth.loop");
    const mount = mountRuntimeSkillForSession({
      artifact,
      thothSessionHome: join(tempRoot, "runtime-home"),
      sessionId: "loop_eval",
      home: join(tempRoot, "bare-provider-home"),
    });
    const failures: string[] = [];
    if (
      !mount.mountedPath.endsWith(
        join("provider-sessions", "loop_eval", "skills", "thoth-loop", "SKILL.md"),
      )
    ) {
      failures.push(`unexpected mounted path: ${mount.mountedPath}`);
    }
    if (mount.skillRef.id !== "thoth.loop") {
      failures.push("mounted skill ref id mismatch");
    }
    return result("session-scoped-loop-skill", failures);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function evaluateScenario(scenario: LoopGoldenScenario): LoopEvalScenarioResult {
  const observedFailures: string[] = [];
  if (scenario.currentGoalOrder < 1 || scenario.currentGoalOrder > scenario.goalCount) {
    observedFailures.push("current goal must be inside the approved linear goal list");
  }
  if (scenario.planExecResult) {
    const parsed = ThothLoopPlanExecResultInputSchema.safeParse(scenario.planExecResult);
    if (!parsed.success) {
      observedFailures.push("PlanExec result fails runtime tool schema");
    } else {
      if (parsed.data.evidence.length === 0) {
        observedFailures.push("PlanExec result must include evidence");
      }
      if (!parsed.data.next_review_focus.trim()) {
        observedFailures.push("PlanExec result must tell Review what to inspect");
      }
      const planText = flattenText(parsed.data);
      if (containsUserClarification(planText)) {
        observedFailures.push("PlanExec asks the user after Task/Goals are frozen");
      }
      for (const goalId of scenario.forbiddenGoalIds ?? []) {
        if (textMentionsGoal(planText, goalId)) {
          observedFailures.push("PlanExec works outside current goal boundary");
        }
      }
    }
  }
  if (scenario.reviewVerdict) {
    if (scenario.reviewProtocol?.independentAssessmentBeforePlanExecAccount !== true) {
      observedFailures.push(
        "Review must complete independent assessment before reading PlanExec account",
      );
    }
    const parsed = ThothLoopReviewVerdictInputSchema.safeParse(scenario.reviewVerdict);
    if (!parsed.success) {
      observedFailures.push("Review verdict fails runtime tool schema");
    } else {
      const retryOutcome =
        parsed.data.outcome === "continue" || parsed.data.outcome === "reframe_current_goal";
      if (retryOutcome) {
        if (!parsed.data.direction_memo) {
          observedFailures.push("retry Review must include a direction memo");
        } else {
          if (parsed.data.direction_memo.reality.length === 0) {
            observedFailures.push("Review direction memo must cite observable reality");
          }
          if (parsed.data.direction_memo.abandon.length === 0) {
            observedFailures.push("Review direction memo must name a route to abandon");
          }
          if (!parsed.data.direction_memo.next_direction.trim()) {
            observedFailures.push("Review direction memo must provide a next direction");
          }
          if (directionMemoIsShallow(parsed.data.direction_memo)) {
            observedFailures.push("Review direction memo is shallow or incremental");
          }
          if (directionMemoUsesDaemonMechanics(flattenText(parsed.data.direction_memo))) {
            observedFailures.push("Review direction memo treats daemon mechanics as judgment");
          }
        }
      }
      if (parsed.data.outcome === "pass") {
        if (evidenceIsGeneric(parsed.data.evidence_summary)) {
          observedFailures.push(
            "Review pass evidence must bind its conclusion to concrete reality",
          );
        }
      }
    }
  }
  if (scenario.retryContext) {
    const retryParsed = ThothLoopPlanExecResultInputSchema.safeParse(
      scenario.retryContext.retryPlanExecResult,
    );
    if (!retryParsed.success) {
      observedFailures.push("Retry PlanExec result fails runtime tool schema");
    } else {
      const retryText = flattenText(retryParsed.data).toLowerCase();
      const priorText = [
        scenario.retryContext.previousFailureRootCause,
        scenario.retryContext.previousNextRoundGuidance,
        ...scenario.retryContext.previousAntiRepeatStrategy,
      ].join(" ");
      const priorTokens = meaningfulTokens(priorText);
      const matchedTokens = priorTokens.filter((token) => retryText.includes(token));
      if (matchedTokens.length < Math.min(2, priorTokens.length)) {
        observedFailures.push("Retry PlanExec does not address previous Review guidance");
      }
      if (/rerun the same|repeat(?:ed)? the same|same implementation/i.test(retryText)) {
        observedFailures.push("Retry PlanExec mechanically repeats the failed strategy");
      }
    }
  }
  if (scenario.reviewWorkspaceDiff && scenario.reviewWorkspaceDiff.length > 0) {
    observedFailures.push("Review modified workspace files");
  }
  if (scenario.budgetTransition) {
    const before = scenario.budgetTransition.beforeUsedFailedReviews;
    const after = scenario.budgetTransition.afterUsedFailedReviews;
    if (scenario.budgetTransition.reviewOutcome === "pass" && after !== before) {
      observedFailures.push("Review pass must not consume failed-review budget");
    }
    if (
      (scenario.budgetTransition.reviewOutcome === "continue" ||
        scenario.budgetTransition.reviewOutcome === "reframe_current_goal") &&
      after !== before + 1
    ) {
      observedFailures.push("Review fail must consume exactly one failed-review budget");
    }
    if (
      scenario.budgetTransition.providerExitStatus &&
      scenario.budgetTransition.providerExitStatus !== "completed" &&
      after !== before
    ) {
      observedFailures.push("Provider or permission failure must not consume failed-review budget");
    }
    if (
      after >= scenario.budgetTransition.maxFailedReviews &&
      (scenario.budgetTransition.reviewOutcome === "continue" ||
        scenario.budgetTransition.reviewOutcome === "reframe_current_goal") &&
      scenario.budgetTransition.expectedTaskStatus !== "budget_wait"
    ) {
      observedFailures.push("Budget exhaustion must enter budget_wait with latest Review verdict");
    }
  }
  if (scenario.providerFailure) {
    if (scenario.providerFailure.modeledAsReviewFailure) {
      observedFailures.push(
        "Provider or permission failure is incorrectly modeled as Review failure",
      );
    }
  }
  if (scenario.completionState) {
    const passed = new Set(scenario.completionState.passedGoalOrders);
    const allGoalsPassed = Array.from(
      { length: scenario.goalCount },
      (_, index) => index + 1,
    ).every((order) => passed.has(order));
    if (scenario.completionState.claimedTaskDone && !allGoalsPassed) {
      observedFailures.push("Task completion claimed before all goals passed Review");
    }
    if (!scenario.completionState.claimedTaskDone && allGoalsPassed) {
      observedFailures.push("Task should be claimable as done after all goals pass Review");
    }
  }
  if (scenario.expectedBehavior.length === 0) {
    observedFailures.push("scenario must declare expected behavior");
  }
  if (scenario.forbiddenBehavior.length === 0) {
    observedFailures.push("scenario must declare forbidden behavior");
  }
  if ((scenario.expectedEvaluation ?? "pass") === "fail") {
    const missingExpectedFailures = (scenario.expectedFailures ?? []).filter(
      (expected) => !observedFailures.some((failure) => failure.includes(expected)),
    );
    const failures =
      observedFailures.length === 0
        ? ["negative scenario unexpectedly passed"]
        : missingExpectedFailures.map((expected) => `missing expected failure: ${expected}`);
    return result(scenario.id, failures, observedFailures);
  }
  return result(scenario.id, observedFailures);
}

export function buildLoopGoldenEvalReport(): LoopEvalReport {
  const results = [
    evaluateSkillArtifact(),
    evaluateSessionMount(),
    ...LOOP_GOLDEN_SCENARIOS.map(evaluateScenario),
  ];
  return {
    passed: results.every((entry) => entry.passed),
    scenarioCount: results.length,
    results,
  };
}

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(buildLoopGoldenEvalReport(), null, 2)}\n`);
}
