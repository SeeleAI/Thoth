import { z } from "zod";

const NonEmptyStringSchema = z.string().trim().min(1);

export const AcceptanceClaimLifecycleSchema = z.enum([
  "open",
  "supported",
  "satisfied",
  "reopened",
]);

export const AcceptanceClaimProjectionSchema = z
  .object({
    id: NonEmptyStringSchema,
    statement: NonEmptyStringSchema,
    status: AcceptanceClaimLifecycleSchema,
    evidenceRefs: z.array(NonEmptyStringSchema).default([]),
    revision: z.number().int().positive(),
  })
  .strict();

export const IntentEscalationPolicySchema = z
  .object({
    returnToHumanWhen: z.array(NonEmptyStringSchema).default([]),
    finalConfirmation: z.enum(["automatic", "required"]),
  })
  .strict();

export const IntentContractDraftSchema = z
  .object({
    title: NonEmptyStringSchema,
    objective: NonEmptyStringSchema,
    nonGoals: z.array(NonEmptyStringSchema).default([]),
    invariants: z.array(NonEmptyStringSchema).default([]),
    acceptance: z.array(NonEmptyStringSchema).min(1),
    riskBoundary: z.array(NonEmptyStringSchema).default([]),
    humanDecisionRefs: z.array(NonEmptyStringSchema).default([]),
    escalationPolicy: IntentEscalationPolicySchema,
  })
  .strict();

export const IntentContractStatusSchema = z.enum([
  "draft",
  "proposed",
  "confirmed",
  "superseded",
  "legacy",
]);

export const IntentContractProjectionSchema = z
  .object({
    id: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    sourceAgentId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema.nullable(),
    title: NonEmptyStringSchema,
    objective: NonEmptyStringSchema,
    nonGoals: z.array(NonEmptyStringSchema),
    invariants: z.array(NonEmptyStringSchema),
    acceptanceClaims: z.array(AcceptanceClaimProjectionSchema).min(1),
    riskBoundary: z.array(NonEmptyStringSchema),
    humanDecisionRefs: z.array(NonEmptyStringSchema),
    escalationPolicy: IntentEscalationPolicySchema,
    status: IntentContractStatusSchema,
    revision: z.number().int().positive(),
    confirmedAt: NonEmptyStringSchema.nullable(),
    createdAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
  })
  .strict();

export type AcceptanceClaimLifecycle = z.infer<typeof AcceptanceClaimLifecycleSchema>;
export type AcceptanceClaimProjection = z.infer<typeof AcceptanceClaimProjectionSchema>;
export type IntentEscalationPolicy = z.infer<typeof IntentEscalationPolicySchema>;
export type IntentContractDraft = z.infer<typeof IntentContractDraftSchema>;
export type IntentContractStatus = z.infer<typeof IntentContractStatusSchema>;
export type IntentContractProjection = z.infer<typeof IntentContractProjectionSchema>;
