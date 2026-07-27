import { describe, expect, it } from "vitest";
import {
  buildWorkspaceFileAttachment,
  MAX_WORKSPACE_FILE_ATTACHMENT_BYTES,
  workspaceFileAttachmentOpenRequest,
} from "./workspace-file-attachment";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";

describe("Workspace file Composer attachment", () => {
  it("serializes daemon-read text through the ordinary semantic attachment path", () => {
    const result = buildWorkspaceFileAttachment({
      serverId: "server-1",
      workspaceId: "workspace-1",
      cwd: "/repo",
      path: "src/a.ts",
      kind: "text",
      bytes: new TextEncoder().encode("export const answer = 42;\n"),
      size: 26,
      modifiedAt: "2026-07-27T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(splitComposerAttachmentsForSubmit([result.attachment])).toMatchObject({
      attachments: [
        {
          type: "text",
          title: "src/a.ts",
          text: "Workspace file: src/a.ts\n\nexport const answer = 42;\n",
        },
      ],
    });
  });

  it("refuses binary and oversized files without silently truncating content", () => {
    const common = {
      serverId: "server-1",
      cwd: "/repo",
      path: "asset.bin",
      bytes: new Uint8Array(),
      modifiedAt: "2026-07-27T00:00:00Z",
    };
    expect(buildWorkspaceFileAttachment({ ...common, kind: "binary", size: 0 })).toEqual({
      ok: false,
      reason: "not_text",
    });
    expect(
      buildWorkspaceFileAttachment({
        ...common,
        kind: "text",
        size: MAX_WORKSPACE_FILE_ATTACHMENT_BYTES + 1,
      }),
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("opens the attached source through the canonical read-only Workspace file route", () => {
    const result = buildWorkspaceFileAttachment({
      serverId: "server-1",
      workspaceId: "workspace-1",
      cwd: "/repo",
      path: "src/a.ts",
      kind: "text",
      bytes: new TextEncoder().encode("export const answer = 42;\n"),
      size: 26,
      modifiedAt: "2026-07-27T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(workspaceFileAttachmentOpenRequest(result.attachment)).toEqual({
      location: { path: "src/a.ts" },
      disposition: "main",
    });
  });
});
