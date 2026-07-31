import { z } from "zod";
import { IntentContractProjectionSchema } from "./intent-contract.js";
import { ThothRuntimeClarifyStrengthSchema } from "./thoth-controls.js";

const NonEmptyStringSchema = z.string().trim().min(1);

export const ClarifyDecisionOwnerSchema = z.enum(["human", "agent", "evidence"]);
export const ClarifyDecisionMaterialitySchema = z.enum(["structural", "material", "local"]);
export const ClarifyDecisionNodeStatusSchema = z.enum([
  "open",
  "awaiting_human",
  "resolved",
  "delegated",
  "pruned",
]);

export const ClarifyDecisionNodeProjectionSchema = z
  .object({
    id: NonEmptyStringSchema,
    parentIds: z.array(NonEmptyStringSchema),
    title: NonEmptyStringSchema,
    owner: ClarifyDecisionOwnerSchema,
    materiality: ClarifyDecisionMaterialitySchema,
    status: ClarifyDecisionNodeStatusSchema,
    resolutionRef: NonEmptyStringSchema.nullable(),
    sourceRefs: z.array(NonEmptyStringSchema),
    priority: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
  })
  .strict();

export const ClarifySessionLifecycleSchema = z.enum([
  "grounding",
  "mapping",
  "awaiting_human",
  "challenging",
  "proposing",
  "confirmed",
  "blocked",
  "canceled",
]);

export const ClarifySessionProjectionSchema = z
  .object({
    id: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
    turnId: NonEmptyStringSchema,
    requestedStrength: ThothRuntimeClarifyStrengthSchema.exclude(["deep"]),
    effectiveStrength: z.enum(["light", "balanced", "dive"]).nullable(),
    lifecycle: ClarifySessionLifecycleSchema,
    challengerUsed: z.boolean(),
    priorityNodeId: NonEmptyStringSchema.nullable(),
    intentContract: IntentContractProjectionSchema.nullable(),
    nodes: z.array(ClarifyDecisionNodeProjectionSchema),
    revision: z.number().int().positive(),
    createdAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
  })
  .strict();

export const AgentClarifySessionGetRequestSchema = z
  .object({
    type: z.literal("agent.clarify.session.get.request"),
    requestId: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
  })
  .strict();

export const AgentClarifySessionGetResponseSchema = z
  .object({
    type: z.literal("agent.clarify.session.get.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        session: ClarifySessionProjectionSchema.nullable(),
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const AgentClarifyNodePrioritizeRequestSchema = z
  .object({
    type: z.literal("agent.clarify.node.prioritize.request"),
    requestId: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
    sessionId: NonEmptyStringSchema,
    nodeId: NonEmptyStringSchema,
    expectedRevision: z.number().int().positive(),
    commandId: NonEmptyStringSchema,
  })
  .strict();

export const AgentClarifyNodePrioritizeResponseSchema = z
  .object({
    type: z.literal("agent.clarify.node.prioritize.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        session: ClarifySessionProjectionSchema.nullable(),
        conflict: z.boolean(),
        duplicate: z.boolean(),
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const AgentClarifySessionUpdateSchema = z
  .object({
    type: z.literal("agent.clarify.session.update"),
    payload: z
      .object({
        workspaceId: NonEmptyStringSchema,
        agentId: NonEmptyStringSchema,
        sessionId: NonEmptyStringSchema,
        revision: z.number().int().positive(),
        changedNodeIds: z.array(NonEmptyStringSchema),
      })
      .strict(),
  })
  .strict();

export type ClarifyDecisionOwner = z.infer<typeof ClarifyDecisionOwnerSchema>;
export type ClarifyDecisionMateriality = z.infer<typeof ClarifyDecisionMaterialitySchema>;
export type ClarifyDecisionNodeStatus = z.infer<typeof ClarifyDecisionNodeStatusSchema>;
export type ClarifyDecisionNodeProjection = z.infer<typeof ClarifyDecisionNodeProjectionSchema>;
export type ClarifySessionLifecycle = z.infer<typeof ClarifySessionLifecycleSchema>;
export type ClarifySessionProjection = z.infer<typeof ClarifySessionProjectionSchema>;
