import type { GitHubSearchItem, ThothTurnSnapshot } from "@thoth/protocol/messages";
import type { QueryClient } from "@tanstack/react-query";
import type { ProviderRunMode } from "@thoth/protocol/provider-control";
import type { AgentMessageDeliveryMode } from "@thoth/protocol/agent-turn-queue";
import type {
  AttachmentMetadata,
  ComposerAttachment,
  UserComposerAttachment,
} from "@/attachments/types";
import {
  isWorkspaceAttachment,
  userAttachmentsOnly,
} from "@/attachments/workspace-attachment-utils";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import { generateMessageId } from "@/utils/message-id";
import type { PickedImageAttachmentInput } from "@/hooks/image-attachment-picker";
import {
  addPendingAgentMessage,
  removePendingAgentMessage,
} from "@/projection/pending-agent-messages";

export interface AttachmentPersister {
  persistFromBlob: (input: {
    blob: Blob;
    mimeType: string;
    fileName: string | null;
  }) => Promise<AttachmentMetadata>;
  persistFromFileUri: (input: {
    uri: string;
    mimeType: string;
    fileName: string | null;
  }) => Promise<AttachmentMetadata>;
  deleteAttachments: (metadata: AttachmentMetadata[]) => Promise<void> | void;
}

export interface ComposerSendClient {
  sendAgentMessage: (
    agentId: string,
    text: string,
    options: {
      messageId: string;
      images: Array<{ data: string; mimeType: string }>;
      attachments: ReturnType<typeof splitComposerAttachmentsForSubmit>["attachments"];
      contextRefs: ReturnType<typeof splitComposerAttachmentsForSubmit>["contextRefs"];
      thoth?: ThothTurnSnapshot;
      providerRunMode?: ProviderRunMode;
      deliveryMode?: AgentMessageDeliveryMode;
    },
  ) => Promise<unknown>;
  uploadFile: (input: { fileName: string; mimeType: string; bytes: Uint8Array }) => Promise<{
    requestId: string;
    file: {
      type: "uploaded_file";
      id: string;
      fileName: string;
      mimeType: string;
      size: number;
      path: string;
    } | null;
    error: string | null;
  }>;
}

export interface ComposerCancelClient {
  cancelAgent: (agentId: string) => Promise<void> | void;
}

export async function pickAndPersistImages(input: {
  pickImages: () => Promise<PickedImageAttachmentInput[] | null>;
  persister: Pick<AttachmentPersister, "persistFromBlob" | "persistFromFileUri">;
}): Promise<AttachmentMetadata[]> {
  const result = await input.pickImages();
  if (!result?.length) return [];
  return await Promise.all(
    result.map(async (picked) => {
      const fileName = picked.fileName ?? null;
      const mimeType = picked.mimeType;
      if (picked.source.kind === "blob") {
        return await input.persister.persistFromBlob({
          blob: picked.source.blob,
          mimeType,
          fileName,
        });
      }
      return await input.persister.persistFromFileUri({
        uri: picked.source.uri,
        mimeType,
        fileName,
      });
    }),
  );
}

export async function uploadFileAttachments(input: {
  client: ComposerSendClient;
  files: Array<{ fileName: string; mimeType: string; bytes: Uint8Array }>;
}): Promise<Extract<ComposerAttachment, { kind: "file" }>[]> {
  const result: Extract<ComposerAttachment, { kind: "file" }>[] = [];

  for (const file of input.files) {
    const response = await input.client.uploadFile(file);
    if (response.error || !response.file) {
      throw new Error(response.error ?? "Upload failed.");
    }
    result.push({ kind: "file", attachment: response.file });
  }

  return result;
}

export function removeComposerAttachmentAtIndex<T extends ComposerAttachment>(input: {
  attachments: T[];
  index: number;
  deleteAttachments: AttachmentPersister["deleteAttachments"];
}): T[] {
  const removed = input.attachments[input.index];
  if (removed?.kind === "image") {
    void input.deleteAttachments([removed.metadata]);
  }
  return input.attachments.filter((_, i) => i !== input.index);
}

export interface CancelComposerAgentInput {
  client: ComposerCancelClient | null;
  agentId: string;
  isAgentRunning: boolean;
  isCancellingAgent: boolean;
  isConnected: boolean;
}

export function cancelComposerAgent(input: CancelComposerAgentInput): boolean {
  if (!input.isAgentRunning || input.isCancellingAgent) return false;
  if (!input.isConnected || !input.client) return false;
  void input.client.cancelAgent(input.agentId);
  return true;
}

export interface DispatchComposerAgentMessageInput {
  client: ComposerSendClient;
  queryClient: QueryClient;
  serverId: string;
  agentId: string;
  text: string;
  attachments: ComposerAttachment[];
  encodeImages: (
    images: AttachmentMetadata[],
  ) => Promise<Array<{ data: string; mimeType: string }> | undefined>;
  thoth?: ThothTurnSnapshot;
  providerRunMode?: ProviderRunMode;
  deliveryMode?: AgentMessageDeliveryMode;
}

export async function dispatchComposerAgentMessage(
  input: DispatchComposerAgentMessageInput,
): Promise<void> {
  const wirePayload = splitComposerAttachmentsForSubmit(input.attachments);
  const messageId = generateMessageId();
  const imagesData = await input.encodeImages(wirePayload.images);
  addPendingAgentMessage(input.queryClient, input.serverId, input.agentId, {
    messageId,
    text: input.text,
    timestamp: new Date(),
    images: wirePayload.images,
    attachments: wirePayload.attachments,
  });
  try {
    await input.client.sendAgentMessage(input.agentId, input.text, {
      messageId,
      images: imagesData ?? [],
      attachments: wirePayload.attachments,
      contextRefs: wirePayload.contextRefs,
      ...(input.thoth ? { thoth: input.thoth } : {}),
      ...(input.providerRunMode ? { providerRunMode: input.providerRunMode } : {}),
      deliveryMode: input.deliveryMode ?? "queue",
    });
  } catch (error) {
    removePendingAgentMessage(input.queryClient, input.serverId, input.agentId, messageId);
    throw error;
  }
}

export interface OpenComposerAttachmentInput {
  attachment: ComposerAttachment;
  setLightboxMetadata: (metadata: AttachmentMetadata) => void;
  openWorkspaceAttachment: (input: { attachment: ComposerAttachment }) => boolean;
  openExternalUrl: (url: string) => void;
}

export function openComposerAttachment(input: OpenComposerAttachmentInput): void {
  if (input.attachment.kind === "image") {
    input.setLightboxMetadata(input.attachment.metadata);
    return;
  }
  if (input.attachment.kind === "file") {
    return;
  }
  if (input.attachment.kind === "task_context") {
    return;
  }
  if (isWorkspaceAttachment(input.attachment)) {
    input.openWorkspaceAttachment({ attachment: input.attachment });
    return;
  }
  input.openExternalUrl(input.attachment.item.url);
}

export function buildGithubAttachment(item: GitHubSearchItem): UserComposerAttachment {
  return item.kind === "pr" ? { kind: "github_pr", item } : { kind: "github_issue", item };
}

function isGithubAttachment(
  attachment: UserComposerAttachment,
): attachment is Extract<UserComposerAttachment, { kind: "github_issue" } | { kind: "github_pr" }> {
  return attachment.kind === "github_issue" || attachment.kind === "github_pr";
}

export function toggleGithubAttachment(
  current: UserComposerAttachment[],
  item: GitHubSearchItem,
): UserComposerAttachment[] {
  const matches = (attachment: UserComposerAttachment) =>
    isGithubAttachment(attachment) &&
    attachment.item.kind === item.kind &&
    attachment.item.number === item.number;
  if (current.some(matches)) {
    return current.filter((attachment) => !matches(attachment));
  }
  return [...current, buildGithubAttachment(item)];
}

interface ToggleGithubAttachmentFromPickerInput {
  current: UserComposerAttachment[];
  item: GitHubSearchItem;
  markGithubAttachmentRemoved: (attachment: UserComposerAttachment) => void;
}

export function toggleGithubAttachmentFromPicker({
  current,
  item,
  markGithubAttachmentRemoved,
}: ToggleGithubAttachmentFromPickerInput): UserComposerAttachment[] {
  const existingAttachment = current.find(
    (attachment) =>
      isGithubAttachment(attachment) &&
      attachment.item.kind === item.kind &&
      attachment.item.number === item.number,
  );
  if (existingAttachment) {
    markGithubAttachmentRemoved(existingAttachment);
  }
  return toggleGithubAttachment(current, item);
}

export function findGithubItemByOption(
  items: readonly GitHubSearchItem[],
  optionId: string,
): GitHubSearchItem | undefined {
  return items.find((candidate) => `${candidate.kind}:${candidate.number}` === optionId);
}

export function isAttachmentSelectedForGithubItem(
  current: readonly ComposerAttachment[],
  item: GitHubSearchItem,
): boolean {
  return userAttachmentsOnly(current).some(
    (attachment) =>
      isGithubAttachment(attachment) &&
      attachment.item.kind === item.kind &&
      attachment.item.number === item.number,
  );
}
