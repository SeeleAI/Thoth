import type { WorkspaceFileContextAttachment } from "./types";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";

export const MAX_WORKSPACE_FILE_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type WorkspaceFileAttachmentResult =
  | { ok: true; attachment: WorkspaceFileContextAttachment }
  | { ok: false; reason: "not_text" | "too_large" };

export function buildWorkspaceFileAttachment(input: {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  path: string;
  kind: "text" | "image" | "binary";
  bytes: Uint8Array;
  size: number;
  modifiedAt: string;
}): WorkspaceFileAttachmentResult {
  if (input.kind !== "text") return { ok: false, reason: "not_text" };
  if (input.size > MAX_WORKSPACE_FILE_ATTACHMENT_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  const workspaceId = input.workspaceId?.trim() || null;
  const id = JSON.stringify({
    serverId: input.serverId,
    workspace: workspaceId ?? input.cwd,
    path: input.path,
  });
  return {
    ok: true,
    attachment: {
      kind: "workspace_file",
      id,
      attachment: {
        type: "text",
        mimeType: "text/plain",
        title: input.path,
        text: [`Workspace file: ${input.path}`, "", new TextDecoder().decode(input.bytes)].join(
          "\n",
        ),
      },
      source: {
        serverId: input.serverId,
        workspaceId,
        cwd: input.cwd,
        path: input.path,
        size: input.size,
        modifiedAt: input.modifiedAt,
      },
    },
  };
}

export function workspaceFileAttachmentOpenRequest(
  attachment: WorkspaceFileContextAttachment,
): WorkspaceFileOpenRequest {
  return {
    location: { path: attachment.source.path },
    disposition: "main",
  };
}
