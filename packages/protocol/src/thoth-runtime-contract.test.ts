import { describe, expect, it } from "vitest";
import {
  ClarifyQuestionCardSchema,
  THOTH_CLARIFY_RUNTIME_TOOL_NAMES,
  THOTH_LOOP_RUNTIME_TOOL_NAMES,
  THOTH_RUNTIME_TOOL_NAMES,
  ThothClarifyAskInputSchema,
  ThothClarifyJudgeContractInputSchema,
  ThothClarifyProposeContractInputSchema,
  ThothClarifyRuntimeToolInputSchema,
  ThothClarifyUpdateMapInputSchema,
  ThothLoopCheckpointInputSchema,
  ThothLoopRequestHumanDecisionInputSchema,
  ThothLoopReviewDecisionInputSchema,
  ThothLoopRuntimeToolInputSchema,
} from "./thoth-runtime-contract.js";

const question = {
  nodeId: "decision-runtime-target",
  question: "Which runtime target owns the irreversible compatibility boundary?",
  selectionMode: "single" as const,
  choices: [
    {
      id: "target-native",
      label: "Native runtime",
      description: "Optimize for the native deployment boundary.",
    },
    {
      id: "target-portable",
      label: "Portable runtime",
      description: "Preserve portability across supported environments.",
    },
  ],
  recommendedChoiceId: "target-native",
};

const contract = {
  title: "Runtime delivery boundary",
  objective: "Deliver the runtime against the confirmed target.",
  nonGoals: ["Do not add a compatibility fallback."],
  invariants: ["Use one provider-neutral authority path."],
  acceptance: ["The selected target passes its real verification gate."],
  riskBoundary: ["Return to the user before changing the deployment target."],
  humanDecisionRefs: ["decision-runtime-target"],
  escalationPolicy: {
    returnToHumanWhen: ["The deployment target must change."],
    finalConfirmation: "automatic" as const,
  },
};

describe("Thoth cognitive runtime contract", () => {
  it("exposes only the final Decision Map and target-anchored Loop tools", () => {
    expect(THOTH_CLARIFY_RUNTIME_TOOL_NAMES).toEqual([
      "thoth_clarify_update_map",
      "thoth_clarify_ask",
      "thoth_clarify_propose_contract",
      "thoth_clarify_report_blocked",
      "thoth_clarify_judge_contract",
    ]);
    expect(THOTH_LOOP_RUNTIME_TOOL_NAMES).toEqual([
      "thoth_loop_checkpoint",
      "thoth_loop_review_decision",
      "thoth_loop_request_human_decision",
      "thoth_loop_report_blocked",
    ]);
    expect(THOTH_RUNTIME_TOOL_NAMES.join(" ")).not.toMatch(
      /task_card|goals_card|planexec|verdict/u,
    );
  });

  it("accepts one to four related Human-owned questions with a real recommendation", () => {
    const parsed = ClarifyQuestionCardSchema.parse({
      title: "Deployment boundary",
      whyNow: "This branch changes implementation and acceptance.",
      publicSummary: "Confirm the material deployment fork.",
      questions: [question],
    });
    expect(parsed.questions).toHaveLength(1);
    expect(parsed).toMatchObject({
      allowChoiceNotes: true,
      allowNoteOnly: true,
      allowSingleNodeRecommendation: true,
      allowSubtreeDelegation: true,
    });
    expect(() =>
      ClarifyQuestionCardSchema.parse({ ...parsed, questions: Array(5).fill(question) }),
    ).toThrow();
  });

  it("rejects a recommendation that is not one of the displayed choices", () => {
    expect(() =>
      ThothClarifyAskInputSchema.parse({
        title: "Deployment boundary",
        whyNow: "The choice is material.",
        publicSummary: "Confirm one branch.",
        questions: [{ ...question, recommendedChoiceId: "missing-choice" }],
      }),
    ).toThrow(/recommendedChoiceId/u);
  });

  it("persists a provider-owned Decision Map delta without hidden reasoning", () => {
    const parsed = ThothClarifyUpdateMapInputSchema.parse({
      effectiveStrength: "dive",
      activity: "expanding",
      activeNodeId: "decision-runtime-target",
      publicSummary: "Grounded the target and exposed one material frontier.",
      nodes: [
        {
          id: "root",
          parentId: null,
          crossLinkIds: [],
          title: "Confirmed objective",
          summary: "The requested outcome is grounded in Workspace evidence.",
          owner: "agent",
          materiality: "structural",
          status: "resolved",
          resolutionRef: "agent:grounded",
          sourceRefs: ["workspace:README.md"],
        },
        {
          id: "decision-runtime-target",
          parentId: "root",
          crossLinkIds: [],
          title: "Runtime target",
          summary: null,
          owner: "human",
          materiality: "material",
          status: "open",
        },
      ],
    });
    expect(parsed.nodes[1]).toMatchObject({ resolutionRef: null, sourceRefs: [] });
    expect(JSON.stringify(parsed)).not.toMatch(/chain.of.thought|reasoning_trace/iu);
  });

  it("proposes one Intent Contract from explicit Decision Map references", () => {
    expect(
      ThothClarifyProposeContractInputSchema.parse({
        contract,
        decisionNodeRefs: ["root", "decision-runtime-target"],
        publicSummary: "The material frontier is stable.",
      }),
    ).toMatchObject({ contract: { objective: contract.objective } });
  });

  it("allows the one-shot Challenger to reopen only with concrete missing nodes", () => {
    expect(() =>
      ThothClarifyJudgeContractInputSchema.parse({
        decision: "reopen",
        reason: "A material risk boundary is missing.",
        missingNodes: [],
      }),
    ).toThrow(/at least one missing decision node/u);
    expect(
      ThothClarifyJudgeContractInputSchema.parse({
        decision: "stable",
        reason: "The material frontier is complete.",
        missingNodes: [],
      }).decision,
    ).toBe("stable");
  });

  it("keeps an Executor checkpoint semantic and provider-neutral", () => {
    const parsed = ThothLoopCheckpointInputSchema.parse({
      title: "Native runtime increment",
      activeGap: "Complete the native runtime boundary.",
      progressClaim: "The native path now passes its focused gate.",
      unresolvedGap: "Review the full acceptance boundary.",
      evidenceRefs: ["evidence-native-gate"],
    });
    expect(parsed.evidenceRefs).toEqual(["evidence-native-gate"]);
    expect(JSON.stringify(parsed)).not.toMatch(/goalId|round|budget|generation|lease/u);
  });

  it("requires complete Review to map Acceptance Claims to evidence", () => {
    expect(() =>
      ThothLoopReviewDecisionInputSchema.parse({
        decision: "complete",
        reason: "The target appears complete.",
        evidenceRefs: ["evidence-native-gate"],
        acceptanceEvidence: {},
      }),
    ).toThrow(/acceptance claim evidence mappings/u);
    expect(
      ThothLoopReviewDecisionInputSchema.parse({
        decision: "complete",
        reason: "Independent inspection verified the target.",
        evidenceRefs: ["evidence-native-gate"],
        acceptanceEvidence: { "claim-runtime": ["evidence-native-gate"] },
      }).decision,
    ).toBe("complete");
  });

  it("represents new Human-owned premises without embedding Task mechanics", () => {
    const parsed = ThothLoopRequestHumanDecisionInputSchema.parse({
      title: "Runtime target changed",
      question: "May execution revise the confirmed target?",
      affectedContractFields: ["riskBoundary"],
      options: [
        { id: "revise", label: "Revise target" },
        { id: "stop", label: "Keep contract" },
      ],
    });
    expect(parsed.options).toHaveLength(2);
    expect(JSON.stringify(parsed)).not.toMatch(/taskId|executionId|generation|receipt/u);
  });

  it("parses the final discriminated semantic tool envelopes", () => {
    expect(
      ThothClarifyRuntimeToolInputSchema.parse({
        tool: "thoth_clarify_propose_contract",
        input: {
          contract,
          decisionNodeRefs: ["decision-runtime-target"],
          publicSummary: "The contract is ready.",
        },
      }).tool,
    ).toBe("thoth_clarify_propose_contract");
    expect(
      ThothLoopRuntimeToolInputSchema.parse({
        tool: "thoth_loop_checkpoint",
        input: {
          title: "Increment",
          activeGap: "Close the gap.",
          progressClaim: "Reality changed.",
          unresolvedGap: "Review it.",
        },
      }).tool,
    ).toBe("thoth_loop_checkpoint");
  });
});
