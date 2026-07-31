import { z } from "zod";
import {
  ThothClarifyAskInputSchema,
  ThothClarifyJudgeContractInputSchema,
  ThothClarifyProposeContractInputSchema,
  ThothClarifyReportBlockedInputSchema,
  ThothClarifyUpdateMapInputSchema,
  ThothLoopCheckpointInputSchema,
  ThothLoopReportBlockedInputSchema,
  ThothLoopRequestHumanDecisionInputSchema,
  ThothLoopReviewDecisionInputSchema,
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
    "thoth_clarify_update_map",
    "Persist the currently known Decision Map without exposing hidden reasoning.",
    ThothClarifyUpdateMapInputSchema,
  ),
  tool(
    "thoth_clarify_ask",
    "Ask one to four related, material human-owned decision branches.",
    ThothClarifyAskInputSchema,
  ),
  tool(
    "thoth_clarify_propose_contract",
    "Propose the single Intent Contract after the Decision Map is stable.",
    ThothClarifyProposeContractInputSchema,
  ),
  tool(
    "thoth_clarify_report_blocked",
    "Report a real Clarify blocker without inventing a decision.",
    ThothClarifyReportBlockedInputSchema,
  ),
];

const CLARIFY_CHALLENGER_TOOLS: readonly RuntimeBundleTool[] = [
  tool(
    "thoth_clarify_judge_contract",
    "Judge one proposed Intent Contract exactly once and either accept it or reopen concrete missing nodes.",
    ThothClarifyJudgeContractInputSchema,
  ),
];

const LOOP_EXECUTE_TOOLS: readonly RuntimeBundleTool[] = [
  tool(
    "thoth_loop_checkpoint",
    "Commit one meaningful reality-changing checkpoint and its evidence for fresh Review.",
    ThothLoopCheckpointInputSchema,
  ),
  tool(
    "thoth_loop_request_human_decision",
    "Pause the Task for a material human-owned decision that would change the Task Anchor.",
    ThothLoopRequestHumanDecisionInputSchema,
  ),
  tool(
    "thoth_loop_report_blocked",
    "Report a real external blocker without claiming completion.",
    ThothLoopReportBlockedInputSchema,
  ),
];

const LOOP_REVIEW_TOOLS: readonly RuntimeBundleTool[] = [
  tool(
    "thoth_loop_review_decision",
    "Submit the fresh Review decision against the whole Task Anchor.",
    ThothLoopReviewDecisionInputSchema,
  ),
  tool(
    "thoth_loop_request_human_decision",
    "Pause the Task for a material human-owned decision that would change the Task Anchor.",
    ThothLoopRequestHumanDecisionInputSchema,
  ),
  tool(
    "thoth_loop_report_blocked",
    "Report a real external or user-owned Loop blocker.",
    ThothLoopReportBlockedInputSchema,
  ),
];

export const THOTH_RUNTIME_BUNDLE_CATALOG: RuntimeBundleCatalog = {
  toolsFor(bundleId) {
    return bundleId === "thoth.clarify"
      ? [...CLARIFY_TOOLS, ...CLARIFY_CHALLENGER_TOOLS]
      : [
          ...LOOP_EXECUTE_TOOLS,
          ...LOOP_REVIEW_TOOLS.filter(
            (candidate) => !LOOP_EXECUTE_TOOLS.some((existing) => existing.name === candidate.name),
          ),
        ];
  },
  scopesFor(bundleId) {
    return bundleId === "thoth.clarify"
      ? ["clarify", "clarify_challenger"]
      : ["loop_execute", "loop_review"];
  },
};
