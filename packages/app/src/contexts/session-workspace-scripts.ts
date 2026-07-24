import equal from "fast-deep-equal";
import type { ScriptStatusUpdateMessage } from "@thoth/protocol/messages";
import type { WorkspaceDescriptor } from "@/projection/authority-model";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";

export function patchWorkspaceScripts(
  workspaces: Map<string, WorkspaceDescriptor>,
  update: ScriptStatusUpdateMessage["payload"],
): Map<string, WorkspaceDescriptor> {
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId: update.workspaceId,
  });
  if (!workspaceKey) {
    return workspaces;
  }

  const existing = workspaces.get(workspaceKey);
  if (!existing) {
    return workspaces;
  }

  if (equal(existing.scripts, update.scripts)) {
    return workspaces;
  }

  const next = new Map(workspaces);
  next.set(workspaceKey, {
    ...existing,
    scripts: update.scripts.map((s) => ({ ...s })),
  });
  return next;
}
