import { describe, expect, it } from "vitest";
import type { ComposerAttachment } from "@/attachments/types";
import {
  mergeWorkspaceSubmitSuppression,
  shouldResetWorkspaceSubmitSuppression,
} from "./workspace-submit-suppression";

const contextAttachment: ComposerAttachment = {
  kind: "github.pull_request_comment",
  id: "comment-1",
  title: "Comment",
  text: "Looks good.",
};

describe("workspace submit suppression", () => {
  it("hides only workspace-owned attachments during an accepted submit attempt", () => {
    const userAttachment: ComposerAttachment = {
      kind: "file",
      attachment: {
        type: "uploaded_file",
        id: "file-1",
        fileName: "notes.txt",
        mimeType: "text/plain",
        size: 4,
        path: "/tmp/notes.txt",
      },
    };

    const suppressed = mergeWorkspaceSubmitSuppression([], [userAttachment, contextAttachment]);
    expect(suppressed).toHaveLength(1);
    expect(mergeWorkspaceSubmitSuppression(suppressed, [contextAttachment])).toBe(suppressed);
  });

  it("restores suppression after success, queueing, or failure", () => {
    expect(shouldResetWorkspaceSubmitSuppression("noop")).toBe(false);
    expect(shouldResetWorkspaceSubmitSuppression("queued")).toBe(true);
    expect(shouldResetWorkspaceSubmitSuppression("submitted")).toBe(true);
    expect(shouldResetWorkspaceSubmitSuppression("failed")).toBe(true);
  });
});
