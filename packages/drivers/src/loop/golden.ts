import type {
  ThothLoopCheckpointInput,
  ThothLoopReviewDecisionInput,
} from "@thoth/protocol/thoth-runtime-contract";

export interface LoopGoldenScenario {
  id: string;
  title: string;
  taskAnchor: {
    objective: string;
    invariants: string[];
    acceptanceClaimIds: string[];
  };
  workingSet: {
    activeGap: string;
    hypothesis: string;
    rejectedRoutes: string[];
  };
  checkpoint: ThothLoopCheckpointInput;
  review: ThothLoopReviewDecisionInput;
  reviewReadOnly: boolean;
  expectReset: boolean;
  expectedDecision: ThothLoopReviewDecisionInput["decision"];
}

export const LOOP_HARNESS_GOLDEN_EVIDENCE = {
  executeInputBoundary: {
    included: [
      "task_anchor",
      "active_gap",
      "current_hypothesis",
      "latest_review",
      "relevant_evidence",
      "rejected_routes",
      "blockers",
    ],
    excluded: ["full_provider_transcript", "blackboard_dump", "private_executor_reasoning"],
  },
  freshReviewBoundary: {
    freshThread: true,
    readOnly: true,
    sameModelAllowed: true,
    inputOrder: ["task_anchor", "workspace_reality", "evidence_index"],
    excluded: ["executor_private_reasoning", "executor_native_transcript"],
    terminalAction: "one_semantic_review_decision",
  },
  planCapabilityPolicy: [
    {
      capability: "native",
      executeMode: "native_plan_then_same_thread_implement",
      claimsNativeReceipt: true,
    },
    {
      capability: "unsupported",
      executeMode: "normal_agent_deliberation",
      claimsNativeReceipt: false,
    },
  ],
  terminalWithoutSemanticResult: [
    { terminalOrdinal: 1, action: "one_same_lineage_repair" },
    { terminalOrdinal: 2, action: "interrupt_and_fresh_reorient" },
  ],
  budgetPolicy: [
    { strength: "single", maxNonCompleteReviews: 1 },
    { strength: "light", maxNonCompleteReviews: 5 },
    { strength: "balanced", maxNonCompleteReviews: 10 },
    { strength: "infinite", maxNonCompleteReviews: null },
  ],
  budgetExhaustion: {
    countedDecision: "non_complete_review",
    atLimitTaskStatus: "budget_wait",
    completionAuthority: "none",
    schedulesAnotherExecution: false,
    requiresExplicitRaiseBudget: true,
  },
  stopFence: {
    commandProjection: "stopping",
    executionProjection: "cancel_requested",
    spinnerRunning: false,
    lateCheckpointAccepted: false,
    lateReviewAccepted: false,
    lateApprovalAccepted: false,
  },
} as const;

export const LOOP_GOLDEN_SCENARIOS: LoopGoldenScenario[] = [
  {
    id: "meaningful-progress-continue",
    title: "A real increment continues from a compact Working Set",
    taskAnchor: {
      objective: "Implement provider-neutral runtime attachment.",
      invariants: ["No provider-name business branches"],
      acceptanceClaimIds: ["claim-conformance", "claim-persistence"],
    },
    workingSet: {
      activeGap: "ACP attachment receipt is not persisted.",
      hypothesis: "Persist the provider-neutral receipt at the Harness boundary.",
      rejectedRoutes: ["Store ACP-specific fields in Task authority"],
    },
    checkpoint: {
      title: "Persisted runtime attachment receipt",
      activeGap: "Restart conformance remains unverified.",
      progressClaim: "The shared receipt is now persisted through the authority API.",
      unresolvedGap: "Crash recovery still needs evidence.",
      evidenceRefs: ["evidence-focused-test"],
    },
    review: {
      decision: "continue",
      reason: "The shared path is real, but restart persistence is not yet evidenced.",
      evidenceRefs: ["evidence-focused-test"],
      nextFocus: "Exercise restart recovery through the same adapter contract.",
      rejectedRoutes: ["Store ACP-specific fields in Task authority"],
      acceptanceEvidence: {},
    },
    reviewReadOnly: true,
    expectReset: false,
    expectedDecision: "continue",
  },
  {
    id: "false-green-reorient",
    title: "Passing local tests cannot hide whole-anchor drift",
    taskAnchor: {
      objective: "Support every HarnessAdapter through one semantic API.",
      invariants: ["No Codex-only orchestration"],
      acceptanceClaimIds: ["claim-all-adapters"],
    },
    workingSet: {
      activeGap: "Only one adapter currently passes.",
      hypothesis: "A provider-specific branch can temporarily close the gap.",
      rejectedRoutes: [],
    },
    checkpoint: {
      title: "Codex test passes",
      activeGap: "Other adapters remain unsupported.",
      progressClaim: "Codex fixture passes after a provider-specific branch.",
      unresolvedGap: "The product contract still fails for four adapters.",
      evidenceRefs: ["evidence-codex-only"],
    },
    review: {
      decision: "reorient",
      reason:
        "The implementation violates the provider-neutral invariant despite a green local test.",
      evidenceRefs: ["evidence-codex-only"],
      nextFocus: "Move the distinction behind HarnessAdapter capability mapping.",
      rejectedRoutes: ["Provider-name orchestration branch"],
      acceptanceEvidence: {},
    },
    reviewReadOnly: true,
    expectReset: true,
    expectedDecision: "reorient",
  },
  {
    id: "complete-needs-all-claim-evidence",
    title: "Completion maps every Acceptance Claim to evidence",
    taskAnchor: {
      objective: "Ship a durable queue without duplicate Timeline rows.",
      invariants: ["One active foreground execution"],
      acceptanceClaimIds: ["claim-fifo", "claim-restart", "claim-single-row"],
    },
    workingSet: {
      activeGap: "No remaining observed gap.",
      hypothesis: "The queue satisfies the frozen contract.",
      rejectedRoutes: ["App-owned optimistic queue"],
    },
    checkpoint: {
      title: "Queue acceptance completed",
      activeGap: "None observed.",
      progressClaim: "FIFO, restart, and canonical Timeline behavior pass through public APIs.",
      unresolvedGap: "",
      evidenceRefs: ["evidence-fifo", "evidence-restart", "evidence-single-row"],
    },
    review: {
      decision: "complete",
      reason: "Fresh Review reproduced every acceptance claim against Workspace authority.",
      evidenceRefs: ["evidence-fifo", "evidence-restart", "evidence-single-row"],
      rejectedRoutes: ["App-owned optimistic queue"],
      acceptanceEvidence: {
        "claim-fifo": ["evidence-fifo"],
        "claim-restart": ["evidence-restart"],
        "claim-single-row": ["evidence-single-row"],
      },
    },
    reviewReadOnly: true,
    expectReset: false,
    expectedDecision: "complete",
  },
  {
    id: "cognitive-drift-reset",
    title: "Review forces a fresh lineage after the Executor optimizes the wrong target",
    taskAnchor: {
      objective: "Reduce end-to-end latency without lowering image quality.",
      invariants: ["Quality threshold is fixed"],
      acceptanceClaimIds: ["claim-latency", "claim-quality"],
    },
    workingSet: {
      activeGap: "Latency is above target.",
      hypothesis: "Lowering sample count is acceptable.",
      rejectedRoutes: [],
    },
    checkpoint: {
      title: "Lower sample count",
      activeGap: "Quality is now below threshold.",
      progressClaim: "Latency improved by reducing samples.",
      unresolvedGap: "The quality invariant is violated.",
      evidenceRefs: ["evidence-latency", "evidence-quality-regression"],
    },
    review: {
      decision: "reorient",
      reason:
        "The Executor drifted from the fixed quality invariant; its current context is anchored to an invalid tradeoff.",
      evidenceRefs: ["evidence-latency", "evidence-quality-regression"],
      nextFocus: "Reset and investigate acceleration that preserves sample quality.",
      rejectedRoutes: ["Reduce sample count below the quality threshold"],
      acceptanceEvidence: {},
    },
    reviewReadOnly: true,
    expectReset: true,
    expectedDecision: "reorient",
  },
  {
    id: "new-premise-needs-human",
    title: "A new product premise returns to source Clarify",
    taskAnchor: {
      objective: "Deploy the renderer to trusted desktop workstations.",
      invariants: ["Inputs are trusted"],
      acceptanceClaimIds: ["claim-desktop"],
    },
    workingSet: {
      activeGap: "A requested cloud endpoint would accept untrusted assets.",
      hypothesis: "The Task Anchor must change before implementation.",
      rejectedRoutes: ["Silently extend the trust boundary"],
    },
    checkpoint: {
      title: "Cloud boundary discovered",
      activeGap: "Trust and deployment boundaries need a Human decision.",
      progressClaim: "Workspace evidence proves cloud ingestion changes the security model.",
      unresolvedGap: "The current contract does not authorize untrusted cloud input.",
      evidenceRefs: ["evidence-cloud-boundary"],
    },
    review: {
      decision: "need_human",
      reason: "Cloud ingestion changes a Human-owned risk boundary and cannot be inferred by Loop.",
      evidenceRefs: ["evidence-cloud-boundary"],
      nextFocus: "Reopen Clarify on the source visible Agent.",
      rejectedRoutes: ["Silently extend the trust boundary"],
      acceptanceEvidence: {},
    },
    reviewReadOnly: true,
    expectReset: false,
    expectedDecision: "need_human",
  },
];
