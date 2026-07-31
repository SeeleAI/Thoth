import { pathToFileURL } from "node:url";
import {
  ClarifyQuestionCardSchema,
  ThothClarifyUpdateMapInputSchema,
  type ThothClarifyUpdateMapInput,
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
import {
  CLARIFY_GOLDEN_SCENARIOS,
  type ClarifyGoldenScenario,
  type ClarifyGoldenTransition,
} from "./golden.js";

export interface ClarifyResearchMetrics {
  highImpactOmissions: number;
  invalidQuestions: number;
  discoverableFactQuestionRate: number;
  branchesEliminatedPerHumanAnswer: number;
  propagatedMaterialBranches: number;
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

function assertTree(scenario: ClarifyGoldenScenario): string[] {
  const failures: string[] = [];
  const nodes = new Map(scenario.map.nodes.map((node) => [node.id, node]));
  const root = nodes.get(scenario.rootNodeId);
  if (!root) {
    failures.push(`Decision Tree is missing stable root ${scenario.rootNodeId}`);
  } else if (root.parentId !== null) {
    failures.push(`Decision Tree root ${scenario.rootNodeId} must not have a parent`);
  }
  const rootIds = scenario.map.nodes
    .filter((node) => node.parentId === null)
    .map((node) => node.id);
  if (!sameIds(rootIds, [scenario.rootNodeId])) {
    failures.push(
      `Decision Tree must have exactly one stable objective root; observed ${rootIds.join(", ") || "none"}`,
    );
  }
  const visit = (nodeId: string, path: Set<string>): void => {
    if (path.has(nodeId)) {
      failures.push(`Decision Tree cycle includes ${nodeId}`);
      return;
    }
    const node = nodes.get(nodeId);
    if (!node) return;
    const next = new Set(path).add(nodeId);
    if (node.parentId) {
      const parentId = node.parentId;
      if (!nodes.has(parentId))
        failures.push(`Decision node ${nodeId} has unknown parent ${parentId}`);
      else visit(parentId, next);
    }
    for (const crossLinkId of node.crossLinkIds) {
      if (!nodes.has(crossLinkId)) {
        failures.push(`Decision node ${nodeId} has unknown cross-link ${crossLinkId}`);
      }
    }
  };
  for (const nodeId of nodes.keys()) visit(nodeId, new Set());
  return failures;
}

function assertStrengthSemantics(input: {
  scenario: ClarifyGoldenScenario;
  nodes: Map<string, ThothClarifyUpdateMapInput["nodes"][number]>;
}): string[] {
  const { scenario, nodes } = input;
  const failures: string[] = [];
  const questionNodeIds = scenario.cards.flatMap((entry) =>
    entry.card.questions.map((question) => question.nodeId),
  );
  for (const nodeId of questionNodeIds) {
    const rationale = scenario.humanOwnershipRationale[nodeId]?.trim();
    if (!rationale || rationale.length < 24) {
      failures.push(`Human-owned Decision node ${nodeId} lacks a concrete ownership rationale`);
    }
  }
  if (scenario.strength === "light") {
    for (const nodeId of questionNodeIds) {
      if (nodes.get(nodeId)?.materiality !== "structural") {
        failures.push(`Light Clarify asked non-structural Decision node ${nodeId}`);
      }
    }
  }
  if (scenario.strength === "balanced") {
    const hasMaterialHumanFrontier = questionNodeIds.some(
      (nodeId) => nodes.get(nodeId)?.owner === "human",
    );
    if (!hasMaterialHumanFrontier) {
      failures.push("Balanced Clarify does not cover a material Human-owned frontier");
    }
  }
  if (scenario.strength === "dive") {
    if (questionNodeIds.length < 30) {
      failures.push(
        "Dive Clarify did not recursively cover at least thirty material Human branches",
      );
    }
    if (Object.hasOwn(scenario.expected, "maximumHumanQuestions")) {
      failures.push("Dive Clarify must not encode a Human-question quota");
    }
  }
  return failures;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function validateTransitions(input: {
  scenario: ClarifyGoldenScenario;
  nodes: Map<string, ThothClarifyUpdateMapInput["nodes"][number]>;
}): { failures: string[]; eliminatedBranches: number; propagatedMaterialBranches: number } {
  const { scenario, nodes } = input;
  const failures: string[] = [];
  let eliminatedBranches = 0;
  let propagatedMaterialBranches = 0;
  if (scenario.transitions.length !== scenario.cards.length) {
    failures.push(
      `Expected one propagation transition per Clarify Card, observed ${scenario.transitions.length} for ${scenario.cards.length} cards`,
    );
    return { failures, eliminatedBranches, propagatedMaterialBranches };
  }

  const previouslyResolved = new Set(
    [...nodes.values()]
      .filter((node) => ["resolved", "delegated"].includes(node.status))
      .map((node) => node.id),
  );
  const previouslyExposed = new Set<string>();
  const routeRefs = new Set<string>();
  const hasResolvedAncestor = (nodeId: string): boolean => {
    let parentId = nodes.get(nodeId)?.parentId ?? null;
    while (parentId) {
      if (previouslyResolved.has(parentId)) return true;
      parentId = nodes.get(parentId)?.parentId ?? null;
    }
    return false;
  };

  scenario.cards.forEach((entry, index) => {
    const transition = scenario.transitions[index] as ClarifyGoldenTransition | undefined;
    if (!transition) return;
    const questionIds = entry.card.questions.map((question) => question.nodeId);
    if (transition.cardTitle !== entry.card.title) {
      failures.push(`Propagation transition ${index + 1} does not belong to ${entry.card.title}`);
    }
    if (!sameIds(transition.answeredNodeIds, questionIds)) {
      failures.push(
        `Propagation transition ${entry.card.title} does not cover its exact Card frontier`,
      );
    }
    if (entry.eliminatedBranches !== transition.prunedRouteRefs.length) {
      failures.push(
        `Propagation transition ${entry.card.title} disagrees with its branch-elimination metric`,
      );
    }
    const terminalIds = new Set([...transition.resolvedNodeIds, ...transition.delegatedNodeIds]);
    for (const nodeId of transition.answeredNodeIds) {
      if (!terminalIds.has(nodeId)) {
        failures.push(`Human answer ${nodeId} has no resolved or delegated Decision Tree outcome`);
      }
    }
    if (
      entry.humanAction.intent === "recommend" &&
      !transition.delegatedNodeIds.includes(entry.humanAction.targetNodeId)
    ) {
      failures.push(
        `Single-node recommendation did not delegate ${entry.humanAction.targetNodeId}`,
      );
    }
    if (
      entry.humanAction.intent === "delegate_subtree" &&
      !transition.delegatedNodeIds.includes(entry.humanAction.targetNodeId)
    ) {
      failures.push(`Subtree delegation did not delegate ${entry.humanAction.targetNodeId}`);
    }
    if (transition.prunedRouteRefs.length < transition.answeredNodeIds.length) {
      failures.push(`Human answers in ${entry.card.title} did not prune meaningful alternatives`);
    }
    for (const route of transition.prunedRouteRefs) {
      if (routeRefs.has(route)) failures.push(`Pruned route ${route} is recorded more than once`);
      routeRefs.add(route);
    }
    for (const nodeId of terminalIds) previouslyResolved.add(nodeId);
    for (const nodeId of transition.newlyMaterialNodeIds) {
      const node = nodes.get(nodeId);
      if (!node) {
        failures.push(`Propagation exposes unknown Decision node ${nodeId}`);
        continue;
      }
      if (previouslyExposed.has(nodeId)) {
        failures.push(`Propagation exposes ${nodeId} more than once`);
      }
      if (!hasResolvedAncestor(nodeId)) {
        failures.push(`Newly material node ${nodeId} has no previously resolved parent path`);
      }
      previouslyExposed.add(nodeId);
    }
    for (const nodeId of transition.answeredNodeIds) previouslyExposed.add(nodeId);
    eliminatedBranches += transition.prunedRouteRefs.length;
    propagatedMaterialBranches += transition.newlyMaterialNodeIds.length;
  });
  return { failures, eliminatedBranches, propagatedMaterialBranches };
}

function evaluateScenario(scenario: ClarifyGoldenScenario): ClarifyEvalScenarioResult {
  const failures = [...assertTree(scenario)];
  const mapResult = ThothClarifyUpdateMapInputSchema.safeParse(scenario.map);
  if (!mapResult.success) failures.push(`Decision Tree schema: ${mapResult.error.message}`);
  const contractResult = IntentContractDraftSchema.safeParse(scenario.contract);
  if (!contractResult.success)
    failures.push(`Intent Contract schema: ${contractResult.error.message}`);

  const nodes = new Map(scenario.map.nodes.map((node) => [node.id, node]));
  failures.push(...assertStrengthSemantics({ scenario, nodes }));
  let humanQuestions = 0;
  let invalidQuestions = 0;
  let discoverableQuestions = 0;
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
  const transitions = validateTransitions({ scenario, nodes });
  failures.push(...transitions.failures);

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
      humanQuestions === 0 ? 0 : transitions.eliminatedBranches / humanQuestions,
    propagatedMaterialBranches: transitions.propagatedMaterialBranches,
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
        propagatedMaterialBranches: 0,
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
      propagatedMaterialBranches: results.reduce(
        (sum, result) => sum + result.metrics.propagatedMaterialBranches,
        0,
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
