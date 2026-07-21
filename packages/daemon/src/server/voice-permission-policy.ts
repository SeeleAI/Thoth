import type { AgentPermissionRequest } from "@thoth/drivers/agent-runtime";

export function isVoicePermissionAllowed(_request: AgentPermissionRequest): boolean {
  return false;
}
