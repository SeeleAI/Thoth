import type {
  ThothClarifyAskInput,
  ThothClarifyProposeContractInput,
  ThothClarifyUpdateMapInput,
  ThothLoopCheckpointInput,
  ThothLoopRequestHumanDecisionInput,
  ThothLoopReviewDecisionInput,
} from "@thoth/protocol/thoth-runtime-contract";

export type ThothRealProviderFlowId =
  | "UT-01-quick-direct-passthrough"
  | "UT-02-quick-clarify-foreground-success"
  | "UT-03-quick-clarify-pause-recover-resume"
  | "UT-04-loop-target-complete"
  | "UT-05-loop-reorient-and-budget"
  | "UT-06-loop-human-decision-handoff";

export interface ClarifyFixtureRound {
  map: ThothClarifyUpdateMapInput;
  ask: ThothClarifyAskInput;
}

export interface ThothRealProviderFlowScript {
  id: ThothRealProviderFlowId;
  finalMarker: string;
  clarify: readonly ClarifyFixtureRound[];
  contract: ThothClarifyProposeContractInput | null;
  handoffClarify?: readonly ClarifyFixtureRound[];
  handoffContract?: ThothClarifyProposeContractInput;
  humanDecision?: ThothLoopRequestHumanDecisionInput;
  checkpoints: readonly ThothLoopCheckpointInput[];
  reviews: readonly ThothLoopReviewDecisionInput[];
}

function clarifyRound(input: {
  title: string;
  marker: string;
  parentId?: string;
}): ClarifyFixtureRound {
  const rootId = `${input.marker}-root`;
  const scopeId = `${input.marker}-scope`;
  const evidenceId = `${input.marker}-evidence`;
  return {
    map: {
      effectiveStrength: "light",
      publicSummary: `Grounded ${input.marker} and exposed its material Human-owned fork.`,
      nodes: [
        {
          id: rootId,
          parentIds: input.parentId ? [input.parentId] : [],
          title: `${input.title} grounded objective`,
          owner: "agent",
          materiality: "structural",
          status: "resolved",
          resolutionRef: `agent:${input.marker}:grounded`,
          sourceRefs: [`fixture:${input.marker}`],
        },
        {
          id: scopeId,
          parentIds: [rootId],
          title: "Execution scope",
          owner: "human",
          materiality: "material",
          status: "open",
          resolutionRef: null,
          sourceRefs: [],
        },
        {
          id: evidenceId,
          parentIds: [rootId],
          title: "Acceptance evidence boundary",
          owner: "human",
          materiality: "material",
          status: "open",
          resolutionRef: null,
          sourceRefs: [],
        },
      ],
    },
    ask: {
      title: input.title,
      whyNow: "These two sibling decisions determine the stable intent boundary.",
      publicSummary: `Confirm the material ${input.marker} branch.`,
      questions: [
        {
          nodeId: scopeId,
          question: "Use the fixed verification scope?",
          selectionMode: "single",
          choices: [
            {
              id: `${scopeId}-yes`,
              label: "Use fixed scope",
              description: "Keep the run inside the deterministic authority boundary.",
            },
            {
              id: `${scopeId}-stop`,
              label: "Stop",
              description: "Do not create an executable Task.",
            },
          ],
          recommendedChoiceId: `${scopeId}-yes`,
        },
        {
          nodeId: evidenceId,
          question: "Require semantic checkpoint evidence?",
          selectionMode: "single",
          choices: [
            {
              id: `${evidenceId}-yes`,
              label: "Require evidence",
              description: "Review completion must cite durable checkpoint evidence.",
            },
            {
              id: `${evidenceId}-no`,
              label: "No evidence",
              description: "Allow an unverified completion claim.",
            },
          ],
          recommendedChoiceId: `${evidenceId}-yes`,
        },
      ],
      allowChoiceNotes: true,
      allowNoteOnly: true,
      allowSubtreeDelegation: true,
    },
  };
}

function contract(marker: string, decisionNodeRefs: string[]): ThothClarifyProposeContractInput {
  return {
    contract: {
      title: `Fixed target ${marker}`,
      objective: "Verify one target-anchored foreground or background authority flow.",
      nonGoals: ["Do not modify unrelated Workspace state."],
      invariants: [
        "Use the Provider Harness session selected by the Agent.",
        "Treat durable semantic evidence as completion authority.",
      ],
      acceptance: ["A durable semantic checkpoint is independently reviewed against this target."],
      riskBoundary: [],
      humanDecisionRefs: [],
      escalationPolicy: {
        returnToHumanWhen: ["The target boundary must change."],
        finalConfirmation: "automatic",
      },
    },
    decisionNodeRefs,
    publicSummary: `The ${marker} Decision Map is stable and ready for one Intent Contract.`,
  };
}

function checkpoint(marker: string, unresolvedGap: string): ThothLoopCheckpointInput {
  return {
    title: `Meaningful increment ${marker}`,
    activeGap: "Verify the target-anchored authority flow.",
    progressClaim: `Recorded semantic progress ${marker}.`,
    unresolvedGap,
    evidenceRefs: [],
  };
}

function reviewContinue(marker: string): ThothLoopReviewDecisionInput {
  return {
    decision: "reorient",
    reason: `Independent Review found a real remaining gap after ${marker}.`,
    evidenceRefs: [],
    nextFocus: `Correct the remaining gap identified after ${marker}.`,
    rejectedRoutes: [`Do not repeat the route used by ${marker}.`],
    acceptanceEvidence: {},
  };
}

function reviewComplete(marker: string): ThothLoopReviewDecisionInput {
  return {
    decision: "complete",
    reason: `Independent Review verified the target after ${marker}.`,
    evidenceRefs: [],
    rejectedRoutes: [],
    acceptanceEvidence: {},
  };
}

const u2RoundOne = clarifyRound({ title: "Foreground branch one", marker: "UT02_C1" });
const u2RoundTwo = clarifyRound({
  title: "Foreground branch two",
  marker: "UT02_C2",
  parentId: "UT02_C1-root",
});
const u3RoundOne = clarifyRound({ title: "Recovery branch one", marker: "UT03_C1" });
const u3RoundTwo = clarifyRound({
  title: "Recovery branch two",
  marker: "UT03_C2",
  parentId: "UT03_C1-root",
});
const u4Round = clarifyRound({ title: "Loop completion branch", marker: "UT04_C1" });
const u5Round = clarifyRound({ title: "Loop reorientation branch", marker: "UT05_C1" });
const u6InitialRound = clarifyRound({ title: "Loop handoff origin", marker: "UT06_I1" });
const u6HandoffRound = clarifyRound({ title: "Loop handoff revision", marker: "UT06_H1" });

export const THOTH_REAL_PROVIDER_FLOW_SCRIPTS = {
  quickDirect: {
    id: "UT-01-quick-direct-passthrough",
    finalMarker: "DIRECT_DONE",
    clarify: [],
    contract: null,
    checkpoints: [],
    reviews: [],
  },
  quickClarifyForeground: {
    id: "UT-02-quick-clarify-foreground-success",
    finalMarker: "FOREGROUND_EXEC_DONE",
    clarify: [u2RoundOne, u2RoundTwo],
    contract: contract("UT02", [
      "UT02_C1-root",
      "UT02_C1-scope",
      "UT02_C1-evidence",
      "UT02_C2-root",
      "UT02_C2-scope",
      "UT02_C2-evidence",
    ]),
    checkpoints: [],
    reviews: [],
  },
  quickClarifyRecovery: {
    id: "UT-03-quick-clarify-pause-recover-resume",
    finalMarker: "RESUMED_FOREGROUND_DONE",
    clarify: [u3RoundOne, u3RoundTwo],
    contract: contract("UT03", [
      "UT03_C1-root",
      "UT03_C1-scope",
      "UT03_C1-evidence",
      "UT03_C2-root",
      "UT03_C2-scope",
      "UT03_C2-evidence",
    ]),
    checkpoints: [],
    reviews: [],
  },
  loopLinearPass: {
    id: "UT-04-loop-target-complete",
    finalMarker: "LOOP_TARGET_COMPLETE",
    clarify: [u4Round],
    contract: contract("UT04", ["UT04_C1-root", "UT04_C1-scope", "UT04_C1-evidence"]),
    checkpoints: [checkpoint("UT04_W1", "Review the completed increment.")],
    reviews: [reviewComplete("UT04_W1")],
  },
  loopRetryAndBudget: {
    id: "UT-05-loop-reorient-and-budget",
    finalMarker: "LOOP_REORIENT_COMPLETE",
    clarify: [u5Round],
    contract: contract("UT05", ["UT05_C1-root", "UT05_C1-scope", "UT05_C1-evidence"]),
    checkpoints: [
      checkpoint("UT05_W1", "Correct the independently observed gap."),
      checkpoint("UT05_W2", "Review the corrected target."),
    ],
    reviews: [reviewContinue("UT05_W1"), reviewComplete("UT05_W2")],
  },
  loopHumanDecisionHandoff: {
    id: "UT-06-loop-human-decision-handoff",
    finalMarker: "LOOP_HUMAN_HANDOFF_COMPLETE",
    clarify: [u6InitialRound],
    contract: contract("UT06_INITIAL", ["UT06_I1-root", "UT06_I1-scope", "UT06_I1-evidence"]),
    handoffClarify: [u6HandoffRound],
    handoffContract: contract("UT06_REVISED", [
      "UT06_H1-root",
      "UT06_H1-scope",
      "UT06_H1-evidence",
    ]),
    humanDecision: {
      title: "Confirm revised risk boundary",
      question: "May the Task adopt the newly discovered target boundary?",
      affectedContractFields: ["riskBoundary"],
      options: [
        {
          id: "adopt-boundary",
          label: "Adopt boundary",
          description: "Revise the Intent Contract and freshly reorient execution.",
        },
        {
          id: "keep-boundary",
          label: "Keep boundary",
          description: "Retain the current Intent Contract and stop this route.",
        },
      ],
    },
    checkpoints: [checkpoint("UT06_W1", "Review the revised target boundary.")],
    reviews: [reviewComplete("UT06_W1")],
  },
} as const satisfies Record<string, ThothRealProviderFlowScript>;

function literalCall(name: string, input: unknown): string {
  return `Call ${name} exactly once with this JSON argument:\n${JSON.stringify(input)}`;
}

function reviewCall(input: ThothLoopReviewDecisionInput): string {
  if (input.decision !== "complete") return literalCall("thoth_loop_review_decision", input);
  return [
    "Call thoth_loop_review_decision exactly once after independent inspection.",
    "Use the semantic fields in this template, but map every live Acceptance Claim id from the injected Task Anchor to one or more live Evidence refs from the Harness Evidence Index. Do not submit placeholder ids or an empty acceptanceEvidence object.",
    JSON.stringify(input),
  ].join("\n");
}

function backgroundScript(script: ThothRealProviderFlowScript): string {
  if (script.checkpoints.length === 0) return "";
  return [
    "BACKGROUND EXECUTOR AND REVIEW FIXTURE:",
    "Each Executor must inspect its current Task Anchor and submit one meaningful checkpoint. Each fresh Reviewer must independently inspect reality and submit one decision. Live Task and evidence ids come from the Harness context, never from fixture mechanics.",
    ...(script.humanDecision
      ? [literalCall("thoth_loop_request_human_decision", script.humanDecision)]
      : []),
    ...script.checkpoints.map((input) => literalCall("thoth_loop_checkpoint", input)),
    ...script.reviews.map(reviewCall),
  ].join("\n\n");
}

export function buildRealProviderFixturePrompt(input: {
  script: ThothRealProviderFlowScript;
  startAtClarifyIndex?: number;
}): string {
  const startAt = input.startAtClarifyIndex ?? 0;
  if (input.script.clarify.length === 0) {
    return [
      `[THOTH REAL FLOW FIXTURE ${input.script.id}]`,
      "This is a deterministic Provider Harness transport test, not an implementation request.",
      `Reply with exactly this text and nothing else: ${input.script.finalMarker}`,
    ].join("\n\n");
  }

  const rounds = input.script.clarify.slice(startAt);
  const lines = [
    `[THOTH REAL FLOW FIXTURE ${input.script.id}]`,
    "Use only the installed Thoth semantic tools. Do not bypass public authority or write test state directly.",
    "For each visible Clarify round, update the Decision Map, ask the prescribed related Human-owned forks, then wait for the answer.",
  ];
  rounds.forEach((round, index) => {
    lines.push(
      `${index + 1}a. ${literalCall("thoth_clarify_update_map", round.map)}`,
      `${index + 1}b. ${literalCall("thoth_clarify_ask", round.ask)}`,
    );
  });
  if (input.script.contract) {
    lines.push(
      `${rounds.length + 1}. ${literalCall("thoth_clarify_propose_contract", input.script.contract)}`,
    );
  }
  if (input.script.checkpoints.length === 0) {
    lines.push(`After Quick approval, finish with exactly: ${input.script.finalMarker}`);
  } else {
    lines.push(
      "After Loop approval, stop the visible foreground execution. Background Harness threads continue from the Task Anchor.",
      backgroundScript(input.script),
    );
  }
  return lines.join("\n\n");
}
