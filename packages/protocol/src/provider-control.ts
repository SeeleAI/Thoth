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
]);

export const ProviderRunModeReceiptSchema = z
  .object({
    id: NonEmptyStringSchema,
    requestedMode: ProviderRunModeSchema,
    status: z.enum(["applied", "unsupported"]),
    nativeModeId: NonEmptyStringSchema.nullable(),
    reason: z.string().nullable(),
    appliedAt: NonEmptyStringSchema,
  })
  .strict();

export type ProviderRunMode = z.infer<typeof ProviderRunModeSchema>;
export type ProviderPlanCapability = z.infer<typeof ProviderPlanCapabilitySchema>;
export type ProviderRunModeReceipt = z.infer<typeof ProviderRunModeReceiptSchema>;
