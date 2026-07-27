import type { ComposerAttachment } from "@/attachments/types";
import { isWorkspaceAttachment } from "@/attachments/workspace-attachment-utils";
import { getAttachmentKey } from "./workspace-cleanup";

export function mergeWorkspaceSubmitSuppression(
  current: readonly string[],
  attachments: readonly ComposerAttachment[],
): readonly string[] {
  const next = new Set(current);
  for (const attachment of attachments) {
    if (isWorkspaceAttachment(attachment)) {
      next.add(getAttachmentKey(attachment));
    }
  }
  return next.size === current.length ? current : Array.from(next);
}

export function shouldResetWorkspaceSubmitSuppression(
  result: "noop" | "queued" | "submitted" | "failed",
): boolean {
  return result === "queued" || result === "submitted" || result === "failed";
}
