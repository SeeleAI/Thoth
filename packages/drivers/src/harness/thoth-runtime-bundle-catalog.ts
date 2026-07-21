import { z } from "zod";
import {
  ThothGetBoundTaskProgressInputSchema,
  ThothLoopPlanExecResultInputSchema,
  ThothLoopReportBlockedInputSchema,
  ThothLoopReviewIndependentAssessmentInputSchema,
  ThothLoopReviewVerdictInputSchema,
  ThothReportBlockedInputSchema,
  ThothSubmitClarifyCardInputSchema,
  ThothSubmitClarifyConvergenceAuditInputSchema,
  ThothSubmitContractPreservationAuditInputSchema,
  ThothSubmitGoalsCardInputSchema,
  ThothSubmitTaskCardInputSchema,
} from "@thoth/protocol/thoth-runtime-contract";
import type { RuntimeBundleCatalog } from "./runtime-bundle.js";
import type { RuntimeBundleTool } from "./types.js";

function tool(name: string, description: string, schema: z.ZodType): RuntimeBundleTool {
  return {
    name,
    description,
    inputSchema: z.toJSONSchema(schema),
  };
}

const CLARIFY_TOOLS: readonly RuntimeBundleTool[] = [
  tool(
    "thoth_get_bound_task_progress",
    "Read the latest semantic progress for Tasks explicitly attached to this foreground turn.",
    ThothGetBoundTaskProgressInputSchema,
  ),
  tool(
    "thoth_submit_clarify_card",
    "Submit the next user-owned clarification decision.",
    ThothSubmitClarifyCardInputSchema,
  ),
  tool(
    "thoth_submit_task_card",
    "Submit the grounded Task Card after clarification converges.",
    ThothSubmitTaskCardInputSchema,
  ),
  tool(
    "thoth_submit_goals_card",
    "Submit the linear Goals Card for user approval.",
    ThothSubmitGoalsCardInputSchema,
  ),
  tool(
    "thoth_submit_clarify_convergence_audit",
    "Submit an independent Clarify convergence assessment.",
    ThothSubmitClarifyConvergenceAuditInputSchema,
  ),
  tool("thoth_report_blocked", "Report a real Clarify blocker.", ThothReportBlockedInputSchema),
];

const LOOP_TOOLS: readonly RuntimeBundleTool[] = [
  tool(
    "thoth_loop_submit_planexec_result",
    "Submit the semantic PlanExec result for independent Review.",
    ThothLoopPlanExecResultInputSchema,
  ),
  tool(
    "thoth_loop_submit_review_independent_assessment",
    "Submit Review's independent observations before reading PlanExec's account.",
    ThothLoopReviewIndependentAssessmentInputSchema,
  ),
  tool(
    "thoth_loop_submit_review_verdict",
    "Submit one of the six Review outcomes.",
    ThothLoopReviewVerdictInputSchema,
  ),
  tool(
    "thoth_submit_contract_preservation_audit",
    "Audit a future-only Goal replan against the approved Task contract.",
    ThothSubmitContractPreservationAuditInputSchema,
  ),
  tool(
    "thoth_loop_report_blocked",
    "Report a real external or user-owned Loop blocker.",
    ThothLoopReportBlockedInputSchema,
  ),
];

export const THOTH_RUNTIME_BUNDLE_CATALOG: RuntimeBundleCatalog = {
  toolsFor(bundleId) {
    return bundleId === "thoth.clarify" ? CLARIFY_TOOLS : LOOP_TOOLS;
  },
  scopesFor(bundleId) {
    return bundleId === "thoth.clarify"
      ? ["clarify", "clarify_audit", "contract_audit"]
      : ["loop_planexec", "loop_review", "contract_audit"];
  },
};
