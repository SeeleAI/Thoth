import { z } from "zod";

const NonEmptyStringSchema = z.string().trim().min(1);

export const ProviderRunModeSchema = z.enum(["default", "plan"]);

export const ProviderPlanCapabilitySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("native"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unsupported"),
      reason: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("unavailable"),
      reason: NonEmptyStringSchema,
    })
    .strict(),
]);

export const AgentProviderControlSchema = z
  .object({
    runMode: ProviderRunModeSchema,
    planCapability: ProviderPlanCapabilitySchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const ProviderRunModeReceiptSchema = z
  .object({
    id: NonEmptyStringSchema,
    requestedMode: ProviderRunModeSchema,
    status: z.enum(["applied", "unsupported", "unavailable"]),
    nativeModeId: NonEmptyStringSchema.nullable(),
    reason: z.string().nullable(),
    appliedAt: NonEmptyStringSchema,
  })
  .strict();

export type ProviderRunMode = z.infer<typeof ProviderRunModeSchema>;
export type ProviderPlanCapability = z.infer<typeof ProviderPlanCapabilitySchema>;
export type ProviderRunModeReceipt = z.infer<typeof ProviderRunModeReceiptSchema>;
export type AgentProviderControl = z.infer<typeof AgentProviderControlSchema>;
