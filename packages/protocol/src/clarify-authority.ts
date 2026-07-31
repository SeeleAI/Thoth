import { z } from "zod";
import { IntentContractProjectionSchema } from "./intent-contract.js";
import { ThothRuntimeClarifyStrengthSchema } from "./thoth-controls.js";

const NonEmptyStringSchema = z.string().trim().min(1);

export const DecisionNodeOwnerSchema = z.enum(["human", "agent", "evidence"]);
export const DecisionNodeMaterialitySchema = z.enum(["structural", "material", "local"]);
export const DecisionNodeStatusSchema = z.enum([
  "open",
  "awaiting_human",
  "resolved",
  "delegated",
  "pruned",
]);

export const DecisionTreeActivityStateSchema = z.enum([
  "understanding",
  "investigating",
  "expanding",
  "challenging",
  "awaiting_human",
  "ready_to_confirm",
  "frozen",
  "blocked",
]);

export const DecisionTreeActivitySchema = z
  .object({
    state: DecisionTreeActivityStateSchema,
    activeNodeId: NonEmptyStringSchema.nullable(),
    summary: NonEmptyStringSchema.nullable(),
    startedAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
  })
  .strict();

export const DecisionNodeProjectionSchema = z
  .object({
    id: NonEmptyStringSchema,
    parentId: NonEmptyStringSchema.nullable(),
    crossLinkIds: z.array(NonEmptyStringSchema),
    title: NonEmptyStringSchema,
    summary: NonEmptyStringSchema.nullable(),
    owner: DecisionNodeOwnerSchema,
    materiality: DecisionNodeMaterialitySchema,
    status: DecisionNodeStatusSchema,
    resolutionRef: NonEmptyStringSchema.nullable(),
    sourceRefs: z.array(NonEmptyStringSchema),
    priority: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
  })
  .strict();

export const DecisionSessionLifecycleSchema = z.enum([
  "active",
  "awaiting_human",
  "ready_to_confirm",
  "frozen",
  "blocked",
  "canceled",
]);

export const DecisionCardReceiptProjectionSchema = z
  .object({
    cardId: NonEmptyStringSchema,
    sessionId: NonEmptyStringSchema,
    kind: z.enum(["clarify_card", "intent_contract_card"]),
    status: z.enum(["pending", "answered", "canceled", "blocked"]),
    submittedSummary: NonEmptyStringSchema.nullable(),
    createdAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
  })
  .strict();

export const DecisionSessionProjectionSchema = z
  .object({
    id: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
    originTurnId: NonEmptyStringSchema,
    activeTurnId: NonEmptyStringSchema.nullable(),
    requestedStrength: ThothRuntimeClarifyStrengthSchema.exclude(["deep"]),
    effectiveStrength: z.enum(["light", "balanced", "dive"]).nullable(),
    lifecycle: DecisionSessionLifecycleSchema,
    challengerUsed: z.boolean(),
    rootNodeId: NonEmptyStringSchema,
    priorityNodeId: NonEmptyStringSchema.nullable(),
    activeCardId: NonEmptyStringSchema.nullable(),
    intentContract: IntentContractProjectionSchema.nullable(),
    taskId: NonEmptyStringSchema.nullable(),
    activity: DecisionTreeActivitySchema,
    revision: z.number().int().positive(),
    createdAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
    frozenAt: NonEmptyStringSchema.nullable(),
  })
  .strict();

export const DecisionTreeSnapshotSchema = z
  .object({
    session: DecisionSessionProjectionSchema,
    nodes: z.array(DecisionNodeProjectionSchema),
    cardReceipts: z.array(DecisionCardReceiptProjectionSchema),
    revision: z.number().int().positive(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (snapshot.revision !== snapshot.session.revision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Decision Tree snapshot revision must match its session revision",
        path: ["revision"],
      });
    }
  });

export const DecisionTreeDeltaSchema = z
  .object({
    workspaceId: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
    sessionId: NonEmptyStringSchema,
    baseRevision: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
    session: DecisionSessionProjectionSchema,
    nodeUpserts: z.array(DecisionNodeProjectionSchema),
    removedNodeIds: z.array(NonEmptyStringSchema),
    cardReceipts: z.array(DecisionCardReceiptProjectionSchema),
    emittedAt: NonEmptyStringSchema,
  })
  .strict()
  .superRefine((delta, ctx) => {
    if (delta.revision <= delta.baseRevision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Decision Tree delta revision must advance its base revision",
        path: ["revision"],
      });
    }
    if (delta.session.id !== delta.sessionId || delta.session.revision !== delta.revision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Decision Tree delta session identity or revision does not match",
        path: ["session"],
      });
    }
  });

export const AgentDecisionSessionListRequestSchema = z
  .object({
    type: z.literal("agent.decision_session.list.request"),
    requestId: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
  })
  .strict();

export const AgentDecisionSessionListResponseSchema = z
  .object({
    type: z.literal("agent.decision_session.list.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        sessions: z.array(DecisionSessionProjectionSchema),
        activeSessionId: NonEmptyStringSchema.nullable(),
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const AgentDecisionSessionGetRequestSchema = z
  .object({
    type: z.literal("agent.decision_session.get.request"),
    requestId: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
    sessionId: NonEmptyStringSchema.optional(),
  })
  .strict();

export const AgentDecisionSessionGetResponseSchema = z
  .object({
    type: z.literal("agent.decision_session.get.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        snapshot: DecisionTreeSnapshotSchema.nullable(),
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const AgentDecisionTreeNodePrioritizeRequestSchema = z
  .object({
    type: z.literal("agent.decision_tree.node.prioritize.request"),
    requestId: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
    sessionId: NonEmptyStringSchema,
    nodeId: NonEmptyStringSchema,
    expectedRevision: z.number().int().positive(),
    commandId: NonEmptyStringSchema,
  })
  .strict();

export const AgentDecisionTreeNodePrioritizeResponseSchema = z
  .object({
    type: z.literal("agent.decision_tree.node.prioritize.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        delta: DecisionTreeDeltaSchema.nullable(),
        conflict: z.boolean(),
        duplicate: z.boolean(),
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const AgentDecisionTreeDeltaMessageSchema = z
  .object({
    type: z.literal("agent.decision_tree.delta"),
    payload: DecisionTreeDeltaSchema,
  })
  .strict();

export type DecisionNodeOwner = z.infer<typeof DecisionNodeOwnerSchema>;
export type DecisionNodeMateriality = z.infer<typeof DecisionNodeMaterialitySchema>;
export type DecisionNodeStatus = z.infer<typeof DecisionNodeStatusSchema>;
export type DecisionTreeActivityState = z.infer<typeof DecisionTreeActivityStateSchema>;
export type DecisionTreeActivity = z.infer<typeof DecisionTreeActivitySchema>;
export type DecisionNodeProjection = z.infer<typeof DecisionNodeProjectionSchema>;
export type DecisionSessionLifecycle = z.infer<typeof DecisionSessionLifecycleSchema>;
export type DecisionCardReceiptProjection = z.infer<typeof DecisionCardReceiptProjectionSchema>;
export type DecisionSessionProjection = z.infer<typeof DecisionSessionProjectionSchema>;
export type DecisionTreeSnapshot = z.infer<typeof DecisionTreeSnapshotSchema>;
export type DecisionTreeDelta = z.infer<typeof DecisionTreeDeltaSchema>;
