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
  | "UT-06-loop-human-decision-handoff"
  | "UT-07-clarify-propagation"
  | "UT-08-clarify-subtree-delegation";

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

export const ACTIVE_DECISION_ROOT_PLACEHOLDER = "__ACTIVE_DECISION_ROOT__";

function clarifyRound(input: {
  title: string;
  marker: string;
  parentId?: string;
  quickCompletionMarker?: string;
}): ClarifyFixtureRound {
  const rootId = `${input.marker}-root`;
  const scopeId = `${input.marker}-scope`;
  const evidenceId = `${input.marker}-evidence`;
  const isQuickCompletion = input.quickCompletionMarker !== undefined;
  const scopeTitle = isQuickCompletion ? "No-op completion" : "Execution scope";
  const evidenceTitle = isQuickCompletion
    ? "Canonical completion evidence"
    : "Acceptance evidence boundary";
  const scopeQuestion = isQuickCompletion
    ? "Run the confirmed no-op completion turn?"
    : "Use the fixed verification scope?";
  const scopeChoice = isQuickCompletion ? `Emit ${input.quickCompletionMarker}` : "Use fixed scope";
  const scopeDescription = isQuickCompletion
    ? "Reply with the canonical completion marker without Workspace mutation."
    : "Keep the run inside the deterministic authority boundary.";
  const evidenceQuestion = isQuickCompletion
    ? "Use the canonical Assistant timeline as the sole completion evidence?"
    : "Require semantic checkpoint evidence?";
  const evidenceChoice = isQuickCompletion ? "Use timeline evidence" : "Require evidence";
  const evidenceDescription = isQuickCompletion
    ? "The exact completion marker in the visible Assistant timeline is sufficient evidence."
    : "Review completion must cite durable checkpoint evidence.";
  return {
    map: {
      effectiveStrength: "light",
      activity: "expanding",
      activeNodeId: scopeId,
      publicSummary: `Grounded ${input.marker} and exposed its material Human-owned fork.`,
      nodes: [
        {
          id: rootId,
          parentId: input.parentId ?? ACTIVE_DECISION_ROOT_PLACEHOLDER,
          crossLinkIds: [],
          title: `${input.title} grounded objective`,
          summary: `Grounded the ${input.marker} objective from the fixture evidence.`,
          owner: "agent",
          materiality: "structural",
          status: "resolved",
          resolutionRef: `agent:${input.marker}:grounded`,
          sourceRefs: [`fixture:${input.marker}`],
        },
        {
          id: scopeId,
          parentId: rootId,
          crossLinkIds: [],
          title: scopeTitle,
          summary: isQuickCompletion
            ? "Waiting for confirmation of the no-op completion turn."
            : "Waiting for the material execution-scope decision.",
          owner: "human",
          materiality: "material",
          status: "open",
          resolutionRef: null,
          sourceRefs: [],
        },
        {
          id: evidenceId,
          parentId: rootId,
          crossLinkIds: [],
          title: evidenceTitle,
          summary: isQuickCompletion
            ? "Waiting for confirmation of canonical timeline evidence."
            : "Waiting for the material evidence-boundary decision.",
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
          question: scopeQuestion,
          selectionMode: "single",
          choices: [
            {
              id: `${scopeId}-yes`,
              label: scopeChoice,
              description: scopeDescription,
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
          question: evidenceQuestion,
          selectionMode: "single",
          choices: [
            {
              id: `${evidenceId}-yes`,
              label: evidenceChoice,
              description: evidenceDescription,
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
      allowSingleNodeRecommendation: true,
      allowSubtreeDelegation: true,
    },
  };
}

function contract(
  marker: string,
  decisionNodeRefs: string[],
  quickCompletionMarker?: string,
): ThothClarifyProposeContractInput {
  const isQuickCompletion = quickCompletionMarker !== undefined;
  return {
    contract: {
      title: `Fixed target ${marker}`,
      objective: isQuickCompletion
        ? `Emit exactly ${quickCompletionMarker} in the visible Assistant timeline after the approved no-op Quick task.`
        : "Verify one target-anchored foreground or background authority flow.",
      nonGoals: isQuickCompletion
        ? ["Do not inspect, edit, test, or require Workspace files."]
        : ["Do not modify unrelated Workspace state."],
      invariants: [
        "Use the Provider Harness session selected by the Agent.",
        isQuickCompletion
          ? "The exact marker is the only task output and no Workspace mutation is allowed."
          : "Treat durable semantic evidence as completion authority.",
      ],
      acceptance: isQuickCompletion
        ? [`The canonical visible Assistant timeline contains exactly ${quickCompletionMarker}.`]
        : ["A durable semantic checkpoint is independently reviewed against this target."],
      riskBoundary: [],
      humanDecisionRefs: [],
      escalationPolicy: {
        returnToHumanWhen: ["The target boundary must change."],
        finalConfirmation: "automatic",
      },
    },
    decisionNodeRefs,
    publicSummary: `The ${marker} Decision Tree is stable and ready for one Intent Contract.`,
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

const u2RoundOne = clarifyRound({
  title: "Foreground branch one",
  marker: "UT02_C1",
  quickCompletionMarker: "FOREGROUND_EXEC_DONE",
});
const u2RoundTwo = clarifyRound({
  title: "Foreground branch two",
  marker: "UT02_C2",
  parentId: "UT02_C1-root",
  quickCompletionMarker: "FOREGROUND_EXEC_DONE",
});
const u3RoundOne = clarifyRound({
  title: "Recovery branch one",
  marker: "UT03_C1",
  quickCompletionMarker: "RESUMED_FOREGROUND_DONE",
});
const u3RoundTwo = clarifyRound({
  title: "Recovery branch two",
  marker: "UT03_C2",
  parentId: "UT03_C1-root",
  quickCompletionMarker: "RESUMED_FOREGROUND_DONE",
});
const u4Round = clarifyRound({ title: "Loop completion branch", marker: "UT04_C1" });
const u5Round = clarifyRound({ title: "Loop reorientation branch", marker: "UT05_C1" });
const u6InitialRound = clarifyRound({ title: "Loop handoff origin", marker: "UT06_I1" });
const u6HandoffRound = clarifyRound({ title: "Loop handoff revision", marker: "UT06_H1" });
const u7ParentRound: ClarifyFixtureRound = {
  map: {
    effectiveStrength: "balanced",
    activity: "expanding",
    activeNodeId: "UT07-strategy",
    publicSummary: "The parent product boundary is ready for one Human-owned decision.",
    nodes: [
      {
        id: "UT07-strategy",
        parentId: ACTIVE_DECISION_ROOT_PLACEHOLDER,
        crossLinkIds: [],
        title: "Rendering product strategy",
        summary: "Awaiting the parent decision before its conditional descendants become material.",
        owner: "human",
        materiality: "structural",
        status: "awaiting_human",
        resolutionRef: null,
        sourceRefs: [],
      },
    ],
  },
  ask: {
    title: "Rendering product strategy",
    whyNow: "This parent choice determines which implementation descendants remain material.",
    publicSummary: "Confirm the parent boundary before exposing conditional child decisions.",
    questions: [
      {
        nodeId: "UT07-strategy",
        question: "Which rendering product strategy is authoritative?",
        selectionMode: "single",
        choices: [
          {
            id: "UT07-strategy-offline",
            label: "Offline renderer",
            description: "Expose the production renderer branch.",
          },
          {
            id: "UT07-strategy-interactive",
            label: "Interactive viewport",
            description: "Expose the live-preview branch instead.",
          },
        ],
        recommendedChoiceId: "UT07-strategy-offline",
      },
    ],
    allowChoiceNotes: true,
    allowNoteOnly: true,
    allowSingleNodeRecommendation: true,
    allowSubtreeDelegation: true,
  },
};
const u7ChildRound: ClarifyFixtureRound = {
  map: {
    effectiveStrength: "balanced",
    activity: "expanding",
    activeNodeId: "UT07-renderer-mode",
    publicSummary:
      "The confirmed parent exposes one remaining material child and prunes the alternate route.",
    nodes: [
      {
        id: "UT07-renderer-mode",
        parentId: "UT07-strategy",
        crossLinkIds: [],
        title: "Offline renderer mode",
        summary: "Awaiting the remaining material renderer decision.",
        owner: "human",
        materiality: "material",
        status: "awaiting_human",
        resolutionRef: null,
        sourceRefs: [],
      },
      {
        id: "UT07-live-preview",
        parentId: "UT07-strategy",
        crossLinkIds: [],
        title: "Live preview route",
        summary:
          "Pruned because the confirmed parent scope does not include an interactive viewport.",
        owner: "agent",
        materiality: "material",
        status: "pruned",
        resolutionRef: null,
        sourceRefs: [],
      },
    ],
  },
  ask: {
    title: "Offline renderer mode",
    whyNow: "The parent boundary is resolved; this child remains material to acceptance.",
    publicSummary: "Confirm the newly material child decision.",
    questions: [
      {
        nodeId: "UT07-renderer-mode",
        question: "Which offline renderer mode defines acceptance?",
        selectionMode: "single",
        choices: [
          {
            id: "UT07-renderer-mode-reference",
            label: "Reference quality",
            description: "Prioritize the deterministic reference path.",
          },
          {
            id: "UT07-renderer-mode-throughput",
            label: "Throughput",
            description: "Prioritize batch throughput instead.",
          },
        ],
        recommendedChoiceId: "UT07-renderer-mode-reference",
      },
    ],
    allowChoiceNotes: true,
    allowNoteOnly: true,
    allowSingleNodeRecommendation: true,
    allowSubtreeDelegation: true,
  },
};
const u8SubtreeRound: ClarifyFixtureRound = {
  map: {
    effectiveStrength: "balanced",
    activity: "expanding",
    activeNodeId: "UT08-portability",
    publicSummary:
      "The parent and its material child are visible before an explicit subtree delegation.",
    nodes: [
      {
        id: "UT08-portability",
        parentId: ACTIVE_DECISION_ROOT_PLACEHOLDER,
        crossLinkIds: [],
        title: "Portability boundary",
        summary: "Awaiting the Human-owned portability parent decision.",
        owner: "human",
        materiality: "structural",
        status: "awaiting_human",
        resolutionRef: null,
        sourceRefs: [],
      },
      {
        id: "UT08-adapter-layout",
        parentId: "UT08-portability",
        crossLinkIds: [],
        title: "Adapter layout boundary",
        summary: "A material descendant that is delegated only with its parent subtree.",
        owner: "human",
        materiality: "material",
        status: "open",
        resolutionRef: null,
        sourceRefs: [],
      },
    ],
  },
  ask: {
    title: "Portability boundary",
    whyNow:
      "The user may explicitly delegate this parent and its dependent branch to the Provider.",
    publicSummary: "Choose or delegate the portability parent.",
    questions: [
      {
        nodeId: "UT08-portability",
        question: "Which portability boundary should the Provider own?",
        selectionMode: "single",
        choices: [
          {
            id: "UT08-portability-all",
            label: "All providers",
            description: "Preserve the shared provider-neutral boundary.",
          },
          {
            id: "UT08-portability-one",
            label: "One provider",
            description: "Narrow the product boundary to one provider.",
          },
        ],
        recommendedChoiceId: "UT08-portability-all",
      },
    ],
    allowChoiceNotes: true,
    allowNoteOnly: true,
    allowSingleNodeRecommendation: true,
    allowSubtreeDelegation: true,
  },
};

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
    contract: contract(
      "UT02",
      [
        "UT02_C1-root",
        "UT02_C1-scope",
        "UT02_C1-evidence",
        "UT02_C2-root",
        "UT02_C2-scope",
        "UT02_C2-evidence",
      ],
      "FOREGROUND_EXEC_DONE",
    ),
    checkpoints: [],
    reviews: [],
  },
  quickClarifyRecovery: {
    id: "UT-03-quick-clarify-pause-recover-resume",
    finalMarker: "RESUMED_FOREGROUND_DONE",
    clarify: [u3RoundOne, u3RoundTwo],
    contract: contract(
      "UT03",
      [
        "UT03_C1-root",
        "UT03_C1-scope",
        "UT03_C1-evidence",
        "UT03_C2-root",
        "UT03_C2-scope",
        "UT03_C2-evidence",
      ],
      "RESUMED_FOREGROUND_DONE",
    ),
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
  clarifyPropagation: {
    id: "UT-07-clarify-propagation",
    finalMarker: "CLARIFY_PROPAGATION_DONE",
    clarify: [u7ParentRound, u7ChildRound],
    contract: contract("UT07", ["UT07-strategy", "UT07-renderer-mode"], "CLARIFY_PROPAGATION_DONE"),
    checkpoints: [],
    reviews: [],
  },
  clarifySubtreeDelegation: {
    id: "UT-08-clarify-subtree-delegation",
    finalMarker: "CLARIFY_SUBTREE_DELEGATED",
    clarify: [u8SubtreeRound],
    contract: null,
    checkpoints: [],
    reviews: [],
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
    `Replace ${ACTIVE_DECISION_ROOT_PLACEHOLDER} in the first map update with the stable root node id already shown in the current Decision Tree.`,
    "For each visible Clarify round, update changed Decision Tree nodes, ask the prescribed related Human-owned forks, then wait for the answer.",
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
    lines.push(
      `After Quick approval, the confirmed Intent Contract is a no-op task. Do not inspect or modify the Workspace; finish with exactly: ${input.script.finalMarker}`,
    );
  } else {
    lines.push(
      "After Loop approval, stop the visible foreground execution. Background Harness threads continue from the Task Anchor.",
      backgroundScript(input.script),
    );
  }
  return lines.join("\n\n");
}
