import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function source(pathname) {
  return readFileSync(resolve(root, pathname), "utf8");
}

function requireText(pathname, pattern, message) {
  if (!pattern.test(source(pathname))) throw new Error(message);
}

function forbidText(pathname, pattern, message) {
  if (pattern.test(source(pathname))) throw new Error(message);
}

forbidText(
  "packages/app/src/stores/session-store.ts",
  /queuedMessages|setQueuedMessages/,
  "App session store must not own a second foreground message queue.",
);
forbidText(
  "packages/app/src/composer/actions.ts",
  /QueueWriter|queueComposerMessage|sendQueuedComposerMessageNow|appendOptimisticUserMessageToStream/,
  "Composer must use the daemon queue and authoritative timeline only.",
);
forbidText(
  "packages/app/src/components/file-pane.tsx",
  /persistAttachmentFromBytes|useAttachmentPreviewUrl|createPreviewAttachmentId/,
  "File preview must not copy Workspace bytes into durable attachment storage.",
);
forbidText(
  "packages/app/src/components/message.tsx",
  /persistAttachmentFromBytes|persistAttachmentFromDataUrl|useAttachmentPreviewUrl/,
  "Assistant image preview must use the same transient source abstraction.",
);
requireText(
  "packages/drivers/src/server/agent/agent-sdk-types.ts",
  /interface ProviderMessageAnchorReceipt[\s\S]*version: 1;[\s\S]*opaqueAnchor: string;/,
  "Harness adapters must own a versioned opaque rewind receipt.",
);
requireText(
  "packages/daemon/src/server/workspace-authority/workspace-authority-store.ts",
  /CREATE TABLE IF NOT EXISTS foreground_turn_queue[\s\S]*provider_message_anchors/,
  "Workspace authority must persist both queued turns and provider message anchors.",
);
requireText(
  "packages/app/src/file-explorer/use-file-preview-source.ts",
  /URL\.revokeObjectURL/,
  "Transient web image previews must release object URLs.",
);
requireText(
  "packages/app/src/composer/index.tsx",
  /editingQueuedTurnId[\s\S]*command: "edit"[\s\S]*text: payload\.text\.trim\(\)/,
  "Queued-message edits must update the daemon-owned item in place.",
);

console.log("Interaction regression architecture contract passed.");
