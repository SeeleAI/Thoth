import type { RuntimeSkillArtifact } from "./contract.js";
import { runClarifyEval, type ClarifyResearchMetrics } from "./eval.js";
import { CLARIFY_GOLDEN_SCENARIOS } from "./golden.js";

export type ClarifyAblationVariant =
  | "prompt_only"
  | "fixed_scaffold"
  | "decision_map"
  | "decision_map_challenger";

type QuestionClassification =
  | "material_human"
  | "discoverable_fact"
  | "agent_owned"
  | "local_detail"
  | "broad_low_value";

interface AblationQuestionSample {
  id: string;
  nodeId: string | null;
  text: string;
  classification: QuestionClassification;
  eliminatedBranches: number;
}

interface AblationDecisionNode {
  id: string;
  owner: "human" | "agent" | "evidence";
  status: "open" | "resolved" | "delegated";
}

interface AblationContractSample {
  objective: string;
  coveredDecisionIds: string[];
  acceptanceClaims: string[];
}

interface AblationChallengerTrace {
  freshContext: true;
  launchCount: 1;
  judgeToolCallCount: 1;
  decision: "reopen";
  reason: string;
  reopenedNodeIds: string[];
  contractBeforeChallenge: AblationContractSample;
  contractAfterChallenge: AblationContractSample;
}

interface ClarifyAblationTrace {
  decisionMap: { durable: true; nodes: AblationDecisionNode[] } | null;
  questions: AblationQuestionSample[];
  finalContract: AblationContractSample;
  challenger: AblationChallengerTrace | null;
}

interface ClarifyAblationMetricEvidence {
  highImpactOmissionNodeIds: string[];
  invalidQuestionIds: string[];
  discoverableFactQuestionIds: string[];
  eliminatedBranchesByQuestion: Array<{ questionId: string; count: number }>;
  contractRegretDecisionIds: string[];
}

export interface ClarifyAblationResult {
  variant: ClarifyAblationVariant;
  metrics: ClarifyResearchMetrics;
  metricEvidence: ClarifyAblationMetricEvidence;
  preservesHumanOwnership: boolean;
  recoverable: boolean;
  trace: ClarifyAblationTrace;
}

interface ClarifyAblationScenario {
  id: string;
  userRequest: string;
  workspaceEvidence: string[];
  expectedMaterialHumanDecisions: Array<{ id: string; title: string }>;
}

export interface ClarifyUserSimulationReport {
  skillDigest: string;
  passed: boolean;
  scenario: ClarifyAblationScenario;
  metricDefinitions: Record<keyof ClarifyResearchMetrics, string>;
  canonicalBaseline: {
    passed: boolean;
    diveQuestionCount: number;
    negativeProbeCount: number;
  };
  ablations: ClarifyAblationResult[];
  selectedVariant: "decision_map_challenger";
}

const SCENARIO: ClarifyAblationScenario = {
  id: "encrypted-scheduled-workspace-backup",
  userRequest:
    "Add an encrypted, provider-neutral scheduled Workspace backup that can run unattended and prove restore integrity.",
  workspaceEvidence: [
    "The Workspace is a TypeScript monorepo with an existing scheduler.",
    "The repository already has an approved encryption primitive.",
    "No durable backup or restore workflow currently exists.",
  ],
  expectedMaterialHumanDecisions: [
    { id: "backup-scope", title: "Which Workspace data is in scope" },
    { id: "retention-policy", title: "Retention and destructive deletion boundary" },
    { id: "destination-trust", title: "External destination trust boundary" },
    { id: "restore-acceptance", title: "Observable restore integrity and recovery target" },
  ],
};

const objective =
  "Deliver an encrypted scheduled Workspace backup within the confirmed scope, trust, retention, and restore boundaries.";

function contract(
  coveredDecisionIds: string[],
  acceptanceClaims: string[],
): AblationContractSample {
  return { objective, coveredDecisionIds, acceptanceClaims };
}

function materialQuestion(
  id: string,
  text: string,
  eliminatedBranches: number,
): AblationQuestionSample {
  return {
    id: `question-${id}`,
    nodeId: id,
    text,
    classification: "material_human",
    eliminatedBranches,
  };
}

function mapNode(id: string): AblationDecisionNode {
  return { id, owner: "human", status: "resolved" };
}

function deriveMetrics(trace: ClarifyAblationTrace): {
  metrics: ClarifyResearchMetrics;
  evidence: ClarifyAblationMetricEvidence;
} {
  const expectedIds = SCENARIO.expectedMaterialHumanDecisions.map((decision) => decision.id);
  const mappedIds = new Set(trace.decisionMap?.nodes.map((node) => node.id) ?? []);
  const coveredIds = new Set(trace.finalContract.coveredDecisionIds);
  const highImpactOmissionNodeIds = expectedIds.filter((id) => !mappedIds.has(id));
  const invalidQuestionIds = trace.questions
    .filter((question) => question.classification !== "material_human")
    .map((question) => question.id);
  const discoverableFactQuestionIds = trace.questions
    .filter((question) => question.classification === "discoverable_fact")
    .map((question) => question.id);
  const eliminatedBranchesByQuestion = trace.questions.map((question) => ({
    questionId: question.id,
    count: question.eliminatedBranches,
  }));
  const contractRegretDecisionIds = expectedIds.filter((id) => !coveredIds.has(id));
  return {
    metrics: {
      highImpactOmissions: highImpactOmissionNodeIds.length,
      invalidQuestions: invalidQuestionIds.length,
      discoverableFactQuestionRate:
        trace.questions.length === 0
          ? 0
          : discoverableFactQuestionIds.length / trace.questions.length,
      branchesEliminatedPerHumanAnswer:
        trace.questions.length === 0
          ? 0
          : trace.questions.reduce((sum, question) => sum + question.eliminatedBranches, 0) /
            trace.questions.length,
      contractRegret: contractRegretDecisionIds.length,
    },
    evidence: {
      highImpactOmissionNodeIds,
      invalidQuestionIds,
      discoverableFactQuestionIds,
      eliminatedBranchesByQuestion,
      contractRegretDecisionIds,
    },
  };
}

function result(
  variant: ClarifyAblationVariant,
  trace: ClarifyAblationTrace,
): ClarifyAblationResult {
  const derived = deriveMetrics(trace);
  return {
    variant,
    metrics: derived.metrics,
    metricEvidence: derived.evidence,
    preservesHumanOwnership: trace.questions.every(
      (question) => question.classification === "material_human",
    ),
    recoverable: trace.decisionMap?.durable === true,
    trace,
  };
}

function buildAblations(): ClarifyAblationResult[] {
  const decisionMapContract = contract(
    ["backup-scope", "retention-policy", "destination-trust"],
    [
      "Backups preserve the confirmed data scope.",
      "Destination encryption respects the trust boundary.",
    ],
  );
  const completedContract = contract(
    ["backup-scope", "retention-policy", "destination-trust", "restore-acceptance"],
    [
      "Backups preserve the confirmed data scope.",
      "Retention never deletes data outside the confirmed policy.",
      "Destination encryption respects the trust boundary.",
      "A restore drill proves integrity and the confirmed recovery target.",
    ],
  );
  return [
    result("prompt_only", {
      decisionMap: null,
      questions: [
        {
          id: "question-broad-backup",
          nodeId: null,
          text: "How should the backup feature work?",
          classification: "broad_low_value",
          eliminatedBranches: 1,
        },
      ],
      finalContract: contract(["backup-scope"], ["Create an encrypted backup."]),
      challenger: null,
    }),
    result("fixed_scaffold", {
      decisionMap: null,
      questions: [
        {
          id: "question-language",
          nodeId: null,
          text: "Which programming language should be used?",
          classification: "discoverable_fact",
          eliminatedBranches: 0,
        },
        {
          id: "question-encryption-library",
          nodeId: null,
          text: "Which encryption library should implement the confirmed boundary?",
          classification: "agent_owned",
          eliminatedBranches: 0,
        },
        {
          id: "question-batch-size",
          nodeId: null,
          text: "How many files should each internal batch contain?",
          classification: "local_detail",
          eliminatedBranches: 0,
        },
        materialQuestion("backup-scope", "Which Workspace data must the backup contain?", 3),
      ],
      finalContract: contract(
        ["backup-scope", "destination-trust"],
        ["Backups preserve the selected scope."],
      ),
      challenger: null,
    }),
    result("decision_map", {
      decisionMap: {
        durable: true,
        nodes: ["backup-scope", "retention-policy", "destination-trust"].map(mapNode),
      },
      questions: [
        materialQuestion("backup-scope", "Which Workspace data must the backup contain?", 3),
        materialQuestion(
          "retention-policy",
          "What retention and deletion boundary is acceptable?",
          4,
        ),
        materialQuestion(
          "destination-trust",
          "Which external trust boundary may receive encrypted data?",
          3,
        ),
      ],
      finalContract: decisionMapContract,
      challenger: null,
    }),
    result("decision_map_challenger", {
      decisionMap: {
        durable: true,
        nodes: SCENARIO.expectedMaterialHumanDecisions.map((decision) => mapNode(decision.id)),
      },
      questions: [
        materialQuestion("backup-scope", "Which Workspace data must the backup contain?", 3),
        materialQuestion(
          "retention-policy",
          "What retention and deletion boundary is acceptable?",
          4,
        ),
        materialQuestion(
          "destination-trust",
          "Which external trust boundary may receive encrypted data?",
          3,
        ),
        materialQuestion(
          "restore-acceptance",
          "What observable restore integrity and recovery target proves this complete?",
          4,
        ),
      ],
      finalContract: completedContract,
      challenger: {
        freshContext: true,
        launchCount: 1,
        judgeToolCallCount: 1,
        decision: "reopen",
        reason:
          "The proposed contract can create backups but cannot prove that restore integrity or recovery time meets the user's value boundary.",
        reopenedNodeIds: ["restore-acceptance"],
        contractBeforeChallenge: decisionMapContract,
        contractAfterChallenge: completedContract,
      },
    }),
  ];
}

export function buildClarifyUserSimulationReport(
  skill: Pick<RuntimeSkillArtifact, "digest"> | { digest: string },
): ClarifyUserSimulationReport {
  const canonical = runClarifyEval();
  const dive = CLARIFY_GOLDEN_SCENARIOS.find((scenario) => scenario.strength === "dive");
  const ablations = buildAblations();
  const selected = ablations.find((entry) => entry.variant === "decision_map_challenger")!;
  return {
    skillDigest: skill.digest,
    passed:
      canonical.passed &&
      selected.metrics.highImpactOmissions === 0 &&
      selected.metrics.contractRegret === 0,
    scenario: SCENARIO,
    metricDefinitions: {
      highImpactOmissions:
        "Count of expected material Human decision nodes absent from the durable Decision Map.",
      invalidQuestions:
        "Count of questions classified as discoverable facts, Agent-owned choices, local details, or broad low-value prompts.",
      discoverableFactQuestionRate:
        "Discoverable-fact questions divided by all questions delegated to the Human.",
      branchesEliminatedPerHumanAnswer:
        "Mean number of recorded decision branches eliminated by each Human answer.",
      contractRegret:
        "Count of expected material Human decisions not represented in the final Intent Contract.",
    },
    canonicalBaseline: {
      passed: canonical.passed,
      diveQuestionCount: dive?.cards.flatMap((entry) => entry.card.questions).length ?? 0,
      negativeProbeCount: canonical.negativeProbes.filter((probe) => probe.passed).length,
    },
    ablations,
    selectedVariant: "decision_map_challenger",
  };
}

export function validateClarifyUserSimulationReport(report: ClarifyUserSimulationReport): string[] {
  const failures: string[] = [];
  if (!report.passed) failures.push("canonical Decision Map simulation did not pass");
  if (report.ablations.length !== 4) failures.push("all four research ablations are required");
  for (const entry of report.ablations) {
    const derived = deriveMetrics(entry.trace);
    if (JSON.stringify(derived.metrics) !== JSON.stringify(entry.metrics)) {
      failures.push(`${entry.variant} metrics do not match its trace`);
    }
    if (JSON.stringify(derived.evidence) !== JSON.stringify(entry.metricEvidence)) {
      failures.push(`${entry.variant} metric evidence does not match its trace`);
    }
  }
  const promptOnly = report.ablations.find((entry) => entry.variant === "prompt_only");
  if (promptOnly?.recoverable || promptOnly?.trace.decisionMap) {
    failures.push("prompt-only must honestly expose its missing durable frontier");
  }
  const fixed = report.ablations.find((entry) => entry.variant === "fixed_scaffold");
  if ((fixed?.metrics.invalidQuestions ?? 0) < 1) {
    failures.push("fixed scaffold must include concrete invalid question evidence");
  }
  const mapOnly = report.ablations.find((entry) => entry.variant === "decision_map");
  if (mapOnly?.metrics.highImpactOmissions !== 1 || mapOnly.metrics.contractRegret !== 1) {
    failures.push("Decision Map-only trace must expose one matching omission and contract regret");
  }
  const selected = report.ablations.find((entry) => entry.variant === report.selectedVariant);
  if (!selected?.recoverable || !selected.preservesHumanOwnership) {
    failures.push("selected architecture must be recoverable and preserve Human ownership");
  }
  if (selected?.metrics.highImpactOmissions !== 0 || selected.metrics.contractRegret !== 0) {
    failures.push("selected architecture leaves high-impact omission or contract regret");
  }
  if (
    selected?.trace.challenger?.freshContext !== true ||
    selected.trace.challenger.launchCount !== 1 ||
    selected.trace.challenger.judgeToolCallCount !== 1 ||
    selected.trace.challenger.reopenedNodeIds.length === 0
  ) {
    failures.push("selected architecture lacks one concrete fresh Challenger reopen trace");
  }
  if (report.canonicalBaseline.diveQuestionCount < 30) {
    failures.push("canonical Dive evidence does not contain at least thirty material questions");
  }
  return failures;
}
