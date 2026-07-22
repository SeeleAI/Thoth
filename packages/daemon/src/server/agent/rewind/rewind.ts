import type { AgentSession, ProviderMessageAnchorReceipt } from "@thoth/drivers/agent-runtime";

export type RewindMode = "conversation" | "files" | "both";

export class RewindCapabilityError extends Error {
  constructor(mode: RewindMode) {
    super(`Provider does not support rewinding ${mode}`);
    this.name = "RewindCapabilityError";
  }
}

export async function invokeRewindCapability(
  session: AgentSession,
  input: { anchor: ProviderMessageAnchorReceipt; mode: RewindMode },
): Promise<void> {
  switch (input.mode) {
    case "conversation":
      if (!session.capabilities.supportsRewindConversation || !session.revertConversation) {
        throw new RewindCapabilityError(input.mode);
      }
      await session.revertConversation({ anchor: input.anchor });
      return;
    case "files":
      if (!session.capabilities.supportsRewindFiles || !session.revertFiles) {
        throw new RewindCapabilityError(input.mode);
      }
      await session.revertFiles({ anchor: input.anchor });
      return;
    case "both":
      if (!session.capabilities.supportsRewindBoth || !session.revertBoth) {
        throw new RewindCapabilityError(input.mode);
      }
      await session.revertBoth({ anchor: input.anchor });
      return;
  }
}
