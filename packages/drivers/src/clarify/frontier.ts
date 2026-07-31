import type {
  ClarifyDecisionMateriality,
  ClarifyDecisionNodeStatus,
  ClarifyDecisionOwner,
} from "@thoth/protocol/clarify-authority";
import type { ClarifyQuestionItem } from "@thoth/protocol/thoth-runtime-contract";

export type ClarifyFrontierIssueCode =
  | "duplicate_node"
  | "unknown_node"
  | "owner_not_human"
  | "frontier_closed"
  | "low_materiality";

export interface ClarifyFrontierNode {
  id: string;
  owner: ClarifyDecisionOwner;
  materiality: ClarifyDecisionMateriality;
  status: ClarifyDecisionNodeStatus;
}

export interface ClarifyFrontierIssue {
  code: ClarifyFrontierIssueCode;
  nodeId: string;
  questionIndex: number;
  message: string;
}

export interface ClarifyFrontierValidation {
  valid: boolean;
  issues: ClarifyFrontierIssue[];
}

export function validateClarifyQuestionFrontier(input: {
  nodes: readonly ClarifyFrontierNode[];
  questions: readonly Pick<ClarifyQuestionItem, "nodeId">[];
}): ClarifyFrontierValidation {
  const nodes = new Map(input.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const issues: ClarifyFrontierIssue[] = [];

  input.questions.forEach((question, questionIndex) => {
    const nodeId = question.nodeId;
    if (seen.has(nodeId)) {
      issues.push({
        code: "duplicate_node",
        nodeId,
        questionIndex,
        message: `Decision node ${nodeId} is repeated in the same Clarify Card`,
      });
      return;
    }
    seen.add(nodeId);

    const node = nodes.get(nodeId);
    if (!node) {
      issues.push({
        code: "unknown_node",
        nodeId,
        questionIndex,
        message: `Decision node ${nodeId} is not present in the active Decision Map`,
      });
      return;
    }
    if (node.owner !== "human") {
      issues.push({
        code: "owner_not_human",
        nodeId,
        questionIndex,
        message: `Decision node ${nodeId} is ${node.owner}-owned and must not be delegated to the Human`,
      });
    }
    if (node.status !== "open" && node.status !== "awaiting_human") {
      issues.push({
        code: "frontier_closed",
        nodeId,
        questionIndex,
        message: `Decision node ${nodeId} is already ${node.status}`,
      });
    }
    if (node.materiality === "local") {
      issues.push({
        code: "low_materiality",
        nodeId,
        questionIndex,
        message: `Decision node ${nodeId} is local implementation detail rather than a material Human decision`,
      });
    }
  });

  return { valid: issues.length === 0, issues };
}

export function formatClarifyFrontierIssues(validation: ClarifyFrontierValidation): string {
  return validation.issues.map((issue) => `[${issue.code}] ${issue.message}`).join("; ");
}
