import { pathToFileURL } from "node:url";
import {
  ClarifyQuestionCardSchema,
  ThothClarifyUpdateMapInputSchema,
} from "@thoth/protocol/thoth-runtime-contract";
import { IntentContractDraftSchema } from "@thoth/protocol/intent-contract";
import { loadRuntimeBundle } from "../harness/runtime-bundle.js";
import { THOTH_RUNTIME_BUNDLE_CATALOG } from "../harness/thoth-runtime-bundle-catalog.js";
import { loadRuntimeSkillArtifact, validateClarifyRuntimeSkillArtifact } from "./contract.js";
import {
  validateClarifyQuestionFrontier,
  type ClarifyFrontierIssueCode,
  type ClarifyFrontierNode,
} from "./frontier.js";
import { CLARIFY_GOLDEN_SCENARIOS, type ClarifyGoldenScenario } from "./golden.js";

export interface ClarifyResearchMetrics {
  highImpactOmissions: number;
  invalidQuestions: number;
  discoverableFactQuestionRate: number;
  branchesEliminatedPerHumanAnswer: number;
  contractRegret: number;
}

export interface ClarifyEvalScenarioResult {
  id: string;
  passed: boolean;
  failures: string[];
  metrics: ClarifyResearchMetrics;
}

export interface ClarifyEvalReport {
  passed: boolean;
  scenarioCount: number;
  metrics: ClarifyResearchMetrics;
  results: ClarifyEvalScenarioResult[];
  negativeProbes: ClarifyNegativeProbeResult[];
}

export interface ClarifyNegativeProbeResult {
  id: string;
  passed: boolean;
  expectedIssue: ClarifyFrontierIssueCode;
  observedIssues: ClarifyFrontierIssueCode[];
}

function assertDag(scenario: ClarifyGoldenScenario): string[] {
  const failures: string[] = [];
  const nodes = new Map(scenario.map.nodes.map((node) => [node.id, node]));
  const visit = (nodeId: string, path: Set<string>): void => {
    if (path.has(nodeId)) {
      failures.push(`Decision Map cycle includes ${nodeId}`);
      return;
    }
    const node = nodes.get(nodeId);
    if (!node) return;
    const next = new Set(path).add(nodeId);
    for (const parentId of node.parentIds) {
      if (!nodes.has(parentId))
        failures.push(`Decision node ${nodeId} has unknown parent ${parentId}`);
      else visit(parentId, next);
    }
  };
  for (const nodeId of nodes.keys()) visit(nodeId, new Set());
  return failures;
}

function evaluateScenario(scenario: ClarifyGoldenScenario): ClarifyEvalScenarioResult {
  const failures = [...assertDag(scenario)];
  const mapResult = ThothClarifyUpdateMapInputSchema.safeParse(scenario.map);
  if (!mapResult.success) failures.push(`Decision Map schema: ${mapResult.error.message}`);
  const contractResult = IntentContractDraftSchema.safeParse(scenario.contract);
  if (!contractResult.success)
    failures.push(`Intent Contract schema: ${contractResult.error.message}`);

  const nodes = new Map(scenario.map.nodes.map((node) => [node.id, node]));
  let humanQuestions = 0;
  let invalidQuestions = 0;
  let discoverableQuestions = 0;
  let eliminatedBranches = 0;
  const asked = new Set<string>();
  for (const entry of scenario.cards) {
    const parsed = ClarifyQuestionCardSchema.safeParse(entry.card);
    if (!parsed.success) failures.push(`Clarify Card schema: ${parsed.error.message}`);
    const frontier = validateClarifyQuestionFrontier({
      nodes: entry.frontierNodes ?? scenario.map.nodes,
      questions: entry.card.questions,
    });
    invalidQuestions += frontier.issues.length;
    failures.push(...frontier.issues.map((issue) => issue.message));
    eliminatedBranches += entry.eliminatedBranches;
    for (const question of entry.card.questions) {
      humanQuestions += 1;
      asked.add(question.nodeId);
      const node = nodes.get(question.nodeId);
      if (node?.owner === "evidence") discoverableQuestions += 1;
    }
    if (entry.humanAction.intent !== "submit_choices") {
      const targetNodeId = entry.humanAction.targetNodeId;
      const targets = entry.card.questions.filter((question) => question.nodeId === targetNodeId);
      if (targets.length !== 1) {
        failures.push(
          `${entry.humanAction.intent} must target exactly one displayed Decision node`,
        );
      }
    }
  }

  const highImpactOmissions = scenario.map.nodes.filter(
    (node) =>
      node.owner === "human" &&
      node.materiality !== "local" &&
      ["open", "awaiting_human"].includes(node.status) &&
      !asked.has(node.id),
  ).length;
  if (highImpactOmissions > 0)
    failures.push(`${highImpactOmissions} material Human nodes were omitted`);
  if (humanQuestions < scenario.expected.minimumHumanQuestions) {
    failures.push(
      `Expected at least ${scenario.expected.minimumHumanQuestions} Human questions, observed ${humanQuestions}`,
    );
  }
  if (discoverableQuestions > scenario.expected.maximumDiscoverableQuestions) {
    failures.push("Clarify delegated discoverable facts back to the human");
  }

  let contractRegret = 0;
  if (scenario.contract.acceptance.length === 0) contractRegret += 1;
  if (scenario.contract.objective.trim().length < 12) contractRegret += 1;
  if (scenario.contract.humanDecisionRefs.length < scenario.expected.minimumHumanQuestions) {
    contractRegret += 1;
  }
  if (contractRegret > 0) failures.push(`Intent Contract regret score is ${contractRegret}`);

  const metrics: ClarifyResearchMetrics = {
    highImpactOmissions,
    invalidQuestions,
    discoverableFactQuestionRate: humanQuestions === 0 ? 0 : discoverableQuestions / humanQuestions,
    branchesEliminatedPerHumanAnswer:
      humanQuestions === 0 ? 0 : eliminatedBranches / humanQuestions,
    contractRegret,
  };
  return { id: scenario.id, passed: failures.length === 0, failures, metrics };
}

function runNegativeFrontierProbes(): ClarifyNegativeProbeResult[] {
  const humanOpen: ClarifyFrontierNode = {
    id: "human-open",
    owner: "human",
    materiality: "material",
    status: "open",
  };
  const probes: Array<{
    id: string;
    nodes: ClarifyFrontierNode[];
    questions: Array<{ nodeId: string }>;
    expectedIssue: ClarifyFrontierIssueCode;
  }> = [
    {
      id: "duplicate-question",
      nodes: [humanOpen],
      questions: [{ nodeId: humanOpen.id }, { nodeId: humanOpen.id }],
      expectedIssue: "duplicate_node",
    },
    {
      id: "already-resolved-question",
      nodes: [{ ...humanOpen, id: "human-resolved", status: "resolved" }],
      questions: [{ nodeId: "human-resolved" }],
      expectedIssue: "frontier_closed",
    },
    {
      id: "discoverable-evidence-question",
      nodes: [{ ...humanOpen, id: "workspace-fact", owner: "evidence" }],
      questions: [{ nodeId: "workspace-fact" }],
      expectedIssue: "owner_not_human",
    },
    {
      id: "agent-owned-question",
      nodes: [{ ...humanOpen, id: "implementation-layout", owner: "agent" }],
      questions: [{ nodeId: "implementation-layout" }],
      expectedIssue: "owner_not_human",
    },
    {
      id: "low-value-local-question",
      nodes: [{ ...humanOpen, id: "local-detail", materiality: "local" }],
      questions: [{ nodeId: "local-detail" }],
      expectedIssue: "low_materiality",
    },
  ];
  return probes.map((probe) => {
    const observedIssues = validateClarifyQuestionFrontier(probe).issues.map((issue) => issue.code);
    return {
      id: probe.id,
      passed: observedIssues.includes(probe.expectedIssue),
      expectedIssue: probe.expectedIssue,
      observedIssues,
    };
  });
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function runClarifyEval(): ClarifyEvalReport {
  const artifact = loadRuntimeSkillArtifact("thoth.clarify");
  const artifactFailures = validateClarifyRuntimeSkillArtifact(artifact);
  const bundle = loadRuntimeBundle("thoth.clarify", THOTH_RUNTIME_BUNDLE_CATALOG);
  const expectedTools = [
    "thoth_clarify_update_map",
    "thoth_clarify_ask",
    "thoth_clarify_propose_contract",
    "thoth_clarify_report_blocked",
    "thoth_clarify_judge_contract",
  ];
  const actualTools = bundle.tools.map((candidate) => candidate.name);
  if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
    artifactFailures.push(
      `RuntimeBundle tools must be exactly ${expectedTools.join(", ")}; observed ${actualTools.join(", ")}`,
    );
  }
  if (!bundle.scopes.includes("clarify") || !bundle.scopes.includes("clarify_challenger")) {
    artifactFailures.push("RuntimeBundle is missing Clarify phase scopes");
  }

  const results = CLARIFY_GOLDEN_SCENARIOS.map(evaluateScenario);
  if (artifactFailures.length > 0) {
    results.unshift({
      id: "runtime-skill",
      passed: false,
      failures: artifactFailures,
      metrics: {
        highImpactOmissions: 0,
        invalidQuestions: 0,
        discoverableFactQuestionRate: 0,
        branchesEliminatedPerHumanAnswer: 0,
        contractRegret: 0,
      },
    });
  }
  const negativeProbes = runNegativeFrontierProbes();
  return {
    passed:
      results.every((result) => result.passed) && negativeProbes.every((probe) => probe.passed),
    scenarioCount: results.length,
    metrics: {
      highImpactOmissions: results.reduce(
        (sum, result) => sum + result.metrics.highImpactOmissions,
        0,
      ),
      invalidQuestions: results.reduce((sum, result) => sum + result.metrics.invalidQuestions, 0),
      discoverableFactQuestionRate: mean(
        results.map((result) => result.metrics.discoverableFactQuestionRate),
      ),
      branchesEliminatedPerHumanAnswer: mean(
        results.map((result) => result.metrics.branchesEliminatedPerHumanAnswer),
      ),
      contractRegret: results.reduce((sum, result) => sum + result.metrics.contractRegret, 0),
    },
    results,
    negativeProbes,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  const report = runClarifyEval();
  process.stdout.write(
    `${JSON.stringify(report, null, process.argv.includes("--json") ? 2 : 0)}\n`,
  );
  if (!report.passed) process.exitCode = 1;
}
