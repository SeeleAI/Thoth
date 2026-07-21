import type { ComposerAttachment } from "@/attachments/types";
import type { ImageAttachment } from "@/composer/types";
import {
  isWorkspaceAttachment,
  workspaceAttachmentToSubmitAttachment,
} from "@/attachments/workspace-attachment-utils";
import type { AgentAttachment } from "@thoth/protocol/messages";
import type { TaskContextReference } from "@thoth/protocol/task-authority";
import { buildGitHubAttachmentFromSearchItem } from "@/utils/review-attachments";

export function splitComposerAttachmentsForSubmit(attachments: ComposerAttachment[]): {
  images: ImageAttachment[];
  attachments: AgentAttachment[];
  contextRefs: TaskContextReference[];
} {
  const images: ImageAttachment[] = [];
  const agentAttachments: AgentAttachment[] = [];
  const contextRefs: TaskContextReference[] = [];

  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      images.push(attachment.metadata);
      continue;
    }

    if (attachment.kind === "file") {
      agentAttachments.push(attachment.attachment);
      continue;
    }

    if (attachment.kind === "task_context") {
      contextRefs.push(attachment.reference);
      continue;
    }

    if (isWorkspaceAttachment(attachment)) {
      const workspaceAttachment = workspaceAttachmentToSubmitAttachment(attachment);
      if (workspaceAttachment) {
        agentAttachments.push(workspaceAttachment);
      }
      continue;
    }

    const reviewAttachment = buildGitHubAttachmentFromSearchItem(attachment.item);
    if (reviewAttachment) {
      agentAttachments.push(reviewAttachment);
    }
  }

  return {
    images,
    attachments: agentAttachments,
    contextRefs,
  };
}
