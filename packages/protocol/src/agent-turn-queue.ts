import { z } from "zod";

export const AgentMessageDeliveryModeSchema = z.enum(["queue", "interrupt"]);
export type AgentMessageDeliveryMode = z.infer<typeof AgentMessageDeliveryModeSchema>;

export const AgentTurnDispositionSchema = z.enum(["started", "queued", "interrupting"]);
export type AgentTurnDisposition = z.infer<typeof AgentTurnDispositionSchema>;

export const AgentQueuedTurnSchema = z
  .object({
    id: z.string().min(1),
    messageId: z.string().min(1),
    text: z.string(),
    deliveryMode: AgentMessageDeliveryModeSchema,
    attachmentCount: z.number().int().nonnegative(),
    position: z.number().int().positive(),
    createdAt: z.string().min(1),
  })
  .strict();
export type AgentQueuedTurn = z.infer<typeof AgentQueuedTurnSchema>;

export const AgentTurnQueueCommandSchema = z.enum(["edit", "delete", "interrupt"]);
export type AgentTurnQueueCommand = z.infer<typeof AgentTurnQueueCommandSchema>;

export const AgentTurnQueueCommandRequestSchema = z
  .object({
    type: z.literal("agent.turn_queue.command.request"),
    requestId: z.string().min(1),
    agentId: z.string().min(1),
    queuedTurnId: z.string().min(1),
    command: AgentTurnQueueCommandSchema,
    text: z.string().optional(),
    expectedRevision: z.number().int().nonnegative(),
    commandId: z.string().min(1),
  })
  .strict()
  .refine((request) => request.command !== "edit" || request.text !== undefined, {
    message: "Queue edit commands require replacement text.",
    path: ["text"],
  });

export const AgentTurnQueueCommandResponseSchema = z
  .object({
    type: z.literal("agent.turn_queue.command.response"),
    payload: z
      .object({
        requestId: z.string().min(1),
        agentId: z.string().min(1),
        accepted: z.boolean(),
        conflict: z.boolean(),
        duplicate: z.boolean(),
        revision: z.number().int().nonnegative(),
        queuedTurns: z.array(AgentQueuedTurnSchema),
        restoredText: z.string().nullable(),
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export type AgentTurnQueueCommandRequest = z.infer<typeof AgentTurnQueueCommandRequestSchema>;
export type AgentTurnQueueCommandResponse = z.infer<typeof AgentTurnQueueCommandResponseSchema>;
