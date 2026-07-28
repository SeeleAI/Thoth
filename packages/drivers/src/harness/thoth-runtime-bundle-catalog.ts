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

const WorkspaceScriptListInputSchema = z.object({}).strict();
const WorkspaceScriptMutationInputSchema = z
  .object({ scriptName: z.string().trim().min(1) })
  .strict();

const WORKSPACE_SCRIPT_READ_TOOL = tool(
  "thoth_list_workspace_scripts",
  "List configured scripts for the Workspace bound to this execution. Workspace scope is derived by Thoth and cannot be supplied by the Provider.",
  WorkspaceScriptListInputSchema,
);

const WORKSPACE_SCRIPT_MUTATION_TOOLS: readonly RuntimeBundleTool[] = [
  tool(
    "thoth_start_workspace_script",
    "Start a configured script in the execution-bound Workspace after the current Quick implementation or Loop PlanExec authority permits mutation.",
    WorkspaceScriptMutationInputSchema,
  ),
  tool(
    "thoth_stop_workspace_script",
    "Stop a running configured script in the execution-bound Workspace after the current Quick implementation or Loop PlanExec authority permits mutation.",
    WorkspaceScriptMutationInputSchema,
  ),
];

const CLARIFY_TOOLS: readonly RuntimeBundleTool[] = [
  WORKSPACE_SCRIPT_READ_TOOL,
  ...WORKSPACE_SCRIPT_MUTATION_TOOLS,
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
  WORKSPACE_SCRIPT_READ_TOOL,
  ...WORKSPACE_SCRIPT_MUTATION_TOOLS,
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
