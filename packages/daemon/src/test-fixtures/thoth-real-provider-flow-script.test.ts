import { describe, expect, test } from "vitest";
import {
  ThothClarifyAskInputSchema,
  ThothClarifyProposeContractInputSchema,
  ThothClarifyUpdateMapInputSchema,
  ThothLoopCheckpointInputSchema,
  ThothLoopRequestHumanDecisionInputSchema,
  ThothLoopReviewDecisionInputSchema,
} from "@thoth/protocol/thoth-runtime-contract";

import {
  buildRealProviderFixturePrompt,
  THOTH_REAL_PROVIDER_FLOW_SCRIPTS,
} from "./thoth-real-provider-flow-script.js";

describe("scripted real-provider cognitive flow contract", () => {
  test.each(Object.values(THOTH_REAL_PROVIDER_FLOW_SCRIPTS))(
    "$id has schema-valid semantic Provider actions",
    (script) => {
      for (const round of script.clarify) {
        expect(ThothClarifyUpdateMapInputSchema.parse(round.map)).toEqual(round.map);
        expect(ThothClarifyAskInputSchema.parse(round.ask)).toEqual(round.ask);
      }
      if (script.contract) {
        expect(ThothClarifyProposeContractInputSchema.parse(script.contract)).toEqual(
          script.contract,
        );
      }
      for (const round of script.handoffClarify ?? []) {
        expect(ThothClarifyUpdateMapInputSchema.parse(round.map)).toEqual(round.map);
        expect(ThothClarifyAskInputSchema.parse(round.ask)).toEqual(round.ask);
      }
      if (script.handoffContract) {
        expect(ThothClarifyProposeContractInputSchema.parse(script.handoffContract)).toEqual(
          script.handoffContract,
        );
      }
      if (script.humanDecision) {
        expect(ThothLoopRequestHumanDecisionInputSchema.parse(script.humanDecision)).toEqual(
          script.humanDecision,
        );
      }
      for (const checkpoint of script.checkpoints) {
        expect(ThothLoopCheckpointInputSchema.parse(checkpoint)).toEqual(checkpoint);
      }
      for (const review of script.reviews) {
        const input =
          review.decision === "complete"
            ? {
                ...review,
                acceptanceEvidence: {
                  "fixture-live-acceptance-claim": ["fixture-live-checkpoint-evidence"],
                },
              }
            : review;
        expect(ThothLoopReviewDecisionInputSchema.parse(input)).toEqual(input);
      }

      const prompt = buildRealProviderFixturePrompt({ script });
      expect(prompt).toContain(`[THOTH REAL FLOW FIXTURE ${script.id}]`);
      if (script.clarify.length === 0) {
        expect(prompt).toContain(script.finalMarker);
      } else {
        expect(prompt).toContain("thoth_clarify_update_map");
        expect(prompt).toContain("thoth_clarify_ask");
        expect(prompt).toContain("thoth_clarify_propose_contract");
        expect(prompt).not.toContain("thoth_submit_task_card");
        expect(prompt).not.toContain("thoth_submit_goals_card");
      }
      if (script.checkpoints.length > 0) {
        expect(prompt).toContain("thoth_loop_checkpoint");
        expect(prompt).toContain("thoth_loop_review_decision");
      }
      if (script.humanDecision) {
        expect(prompt).toContain("thoth_loop_request_human_decision");
      }
    },
  );
});
