import { describe, expect, it, vi } from "vitest";
import type {
  AgentAttachment,
  GitHubSearchItem,
  ThothTurnSnapshot,
} from "@thoth/protocol/messages";
import type {
  AttachmentMetadata,
  ComposerAttachment,
  UserComposerAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import {
  cancelComposerAgent,
  dispatchComposerAgentMessage,
  findGithubItemByOption,
  isAttachmentSelectedForGithubItem,
  openComposerAttachment,
  pickAndPersistImages,
  removeComposerAttachmentAtIndex,
  toggleGithubAttachment,
  toggleGithubAttachmentFromPicker,
  type AttachmentPersister,
  type ComposerCancelClient,
  type ComposerSendClient,
} from "./actions";
const imageMetadata: AttachmentMetadata = {
  id: "img-1",
  mimeType: "image/png",
  storageType: "web-indexeddb",
  storageKey: "img-1",
  fileName: "img-1.png",
  byteSize: 42,
  createdAt: 1,
};

const issueItem: GitHubSearchItem = {
  kind: "issue",
  number: 101,
  title: "Fix composer attachments",
  url: "https://github.com/acme/thoth/issues/101",
  state: "open",
  body: "Issue body",
  labels: ["composer"],
  baseRefName: null,
  headRefName: null,
};

const prItem: GitHubSearchItem = {
  kind: "pr",
  number: 202,
  title: "Refactor composer attachments",
  url: "https://github.com/acme/thoth/pull/202",
  state: "open",
  body: "PR body",
  labels: ["composer"],
  baseRefName: "main",
  headRefName: "composer-attachments",
};

function imageWithId(id: string): AttachmentMetadata {
  return { ...imageMetadata, id, storageKey: id, fileName: `${id}.png` };
}

function reviewWorkspaceAttachment(
  body: string,
): Extract<WorkspaceComposerAttachment, { kind: "review" }> {
  const attachment: Extract<AgentAttachment, { type: "review" }> = {
    type: "review",
    mimeType: "application/thoth-review",
    cwd: "/repo",
    mode: "uncommitted",
    baseRef: null,
    comments: [
      {
        filePath: "src/example.ts",
        side: "new",
        lineNumber: 41,
        body,
        context: {
          hunkHeader: "@@ -40,2 +40,2 @@",
          targetLine: {
            oldLineNumber: null,
            newLineNumber: 41,
            type: "add",
            content: "const value = newValue;",
          },
          lines: [
            {
              oldLineNumber: null,
              newLineNumber: 41,
              type: "add",
              content: "const value = newValue;",
            },
          ],
        },
      },
    ],
  };
  return {
    kind: "review",
    reviewDraftKey: `review:${body}`,
    commentCount: 1,
    attachment,
  };
}

function browserElementWorkspaceAttachment(): Extract<
  WorkspaceComposerAttachment,
  { kind: "browser_element" }
> {
  return {
    kind: "browser_element",
    attachment: {
      url: "https://example.com/page",
      selector: "button.primary",
      tag: "button",
      text: "Save",
      outerHTML: '<button class="primary">Save</button>',
      computedStyles: { display: "flex" },
      boundingRect: { x: 1, y: 2, width: 80, height: 32 },
      reactSource: null,
      parentChain: ["form.settings"],
      children: [],
      formatted: '<browser-element url="https://example.com/page">button.primary</browser-element>',
    },
  };
}

function createFakePersister(): AttachmentPersister & {
  blobCalls: Array<{ blob: Blob; mimeType: string; fileName: string | null }>;
  fileUriCalls: Array<{ uri: string; mimeType: string; fileName: string | null }>;
  deletedBatches: AttachmentMetadata[][];
} {
  const blobCalls: Array<{ blob: Blob; mimeType: string; fileName: string | null }> = [];
  const fileUriCalls: Array<{ uri: string; mimeType: string; fileName: string | null }> = [];
  const deletedBatches: AttachmentMetadata[][] = [];
  return {
    blobCalls,
    fileUriCalls,
    deletedBatches,
    persistFromBlob: async ({ blob, mimeType, fileName }) => {
      blobCalls.push({ blob, mimeType, fileName });
      return { ...imageMetadata, id: `blob-${blobCalls.length}` };
    },
    persistFromFileUri: async ({ uri, mimeType, fileName }) => {
      fileUriCalls.push({ uri, mimeType, fileName });
      return { ...imageMetadata, id: `uri-${fileUriCalls.length}` };
    },
    deleteAttachments: (metadata) => {
      deletedBatches.push(metadata);
    },
  };
}

interface FakeSendCall {
  agentId: string;
  text: string;
  options: {
    messageId: string;
    images: Array<{ data: string; mimeType: string }>;
    attachments: AgentAttachment[];
    thoth?: ThothTurnSnapshot;
    deliveryMode?: "queue" | "interrupt";
  };
}

function createFakeSendClient(
  options: { rejection?: Error } = {},
): ComposerSendClient & { calls: FakeSendCall[] } {
  const calls: FakeSendCall[] = [];
  return {
    calls,
    sendAgentMessage: async (agentId, text, opts) => {
      calls.push({ agentId, text, options: opts });
      if (options.rejection) {
        throw options.rejection;
      }
    },
    uploadFile: async () => ({ requestId: "test", file: null, error: null }),
  };
}

const passthroughEncodeImages = async (images: AttachmentMetadata[]) =>
  images.map((image) => ({ data: image.id, mimeType: image.mimeType }));

describe("cancelComposerAgent", () => {
  function baseInput(): {
    client: ComposerCancelClient & { canceledIds: string[] };
    agentId: string;
    isAgentRunning: boolean;
    isCancellingAgent: boolean;
    isConnected: boolean;
  } {
    const canceledIds: string[] = [];
    return {
      client: {
        canceledIds,
        cancelAgent: async (id) => {
          canceledIds.push(id);
        },
      },
      agentId: "agent",
      isAgentRunning: true,
      isCancellingAgent: false,
      isConnected: true,
    };
  }

  it("issues a cancel and reports true when the agent is running, connected, and not already canceling", () => {
    const input = baseInput();
    const result = cancelComposerAgent(input);
    expect(result).toBe(true);
    expect(input.client.canceledIds).toEqual(["agent"]);
  });

  it("does nothing when the agent is not running", () => {
    const input = baseInput();
    const result = cancelComposerAgent({ ...input, isAgentRunning: false });
    expect(result).toBe(false);
    expect(input.client.canceledIds).toEqual([]);
  });

  it("does nothing when the agent is already being canceled", () => {
    const input = baseInput();
    const result = cancelComposerAgent({ ...input, isCancellingAgent: true });
    expect(result).toBe(false);
    expect(input.client.canceledIds).toEqual([]);
  });

  it("does nothing when disconnected or the client is null", () => {
    const input = baseInput();
    expect(cancelComposerAgent({ ...input, isConnected: false })).toBe(false);
    expect(cancelComposerAgent({ ...input, client: null })).toBe(false);
    expect(input.client.canceledIds).toEqual([]);
  });
});

describe("pickAndPersistImages", () => {
  it("returns [] when the picker yields nothing", async () => {
    const persister = createFakePersister();
    const result = await pickAndPersistImages({
      pickImages: async () => null,
      persister,
    });
    expect(result).toEqual([]);
    expect(persister.blobCalls).toEqual([]);
    expect(persister.fileUriCalls).toEqual([]);
  });

  it("persists blob sources via persistFromBlob with the picked mime type and file name", async () => {
    const persister = createFakePersister();
    const blob = new Blob(["image"]);
    const result = await pickAndPersistImages({
      pickImages: async () => [
        { source: { kind: "blob", blob }, mimeType: "image/png", fileName: "img-1.png" },
      ],
      persister,
    });
    expect(persister.blobCalls).toEqual([{ blob, mimeType: "image/png", fileName: "img-1.png" }]);
    expect(result.map((m) => m.id)).toEqual(["blob-1"]);
  });

  it("persists file_uri sources via persistFromFileUri", async () => {
    const persister = createFakePersister();
    const result = await pickAndPersistImages({
      pickImages: async () => [
        { source: { kind: "file_uri", uri: "/tmp/x.jpg" }, mimeType: null, fileName: null },
      ],
      persister,
    });
    expect(persister.fileUriCalls).toEqual([
      { uri: "/tmp/x.jpg", mimeType: "image/jpeg", fileName: null },
    ]);
    expect(result).toHaveLength(1);
  });
});

describe("dispatchComposerAgentMessage", () => {
  it("sends text and attachments only through the daemon client", async () => {
    const client = createFakeSendClient();
    const image = imageWithId("img-2");

    await dispatchComposerAgentMessage({
      client,
      agentId: "agent",
      text: "send attachments",
      attachments: [
        { kind: "image", metadata: image },
        { kind: "github_pr", item: prItem },
      ],
      encodeImages: passthroughEncodeImages,
    });

    expect(client.calls).toHaveLength(1);
    const [call] = client.calls;
    expect(call.agentId).toBe("agent");
    expect(call.text).toBe("send attachments");
    expect(call.options.images).toEqual([{ data: image.id, mimeType: image.mimeType }]);
    expect(call.options.attachments).toEqual([
      {
        type: "github_pr",
        mimeType: "application/github-pr",
        number: 202,
        title: "Refactor composer attachments",
        url: "https://github.com/acme/thoth/pull/202",
        body: "PR body",
        baseRefName: "main",
        headRefName: "composer-attachments",
      },
    ]);

    expect(call.options.deliveryMode).toBe("queue");
  });

  it("submits empty wire arrays when no attachments are provided", async () => {
    const client = createFakeSendClient();

    await dispatchComposerAgentMessage({
      client,
      agentId: "agent",
      text: "plain message",
      attachments: [],
      encodeImages: passthroughEncodeImages,
    });

    expect(client.calls[0]?.options).toMatchObject({
      images: [],
      attachments: [],
    });
  });

  it("forwards the send-time Thoth snapshot through the ordinary agent API", async () => {
    const client = createFakeSendClient();
    const thoth: ThothTurnSnapshot = {
      enabled: true,
      executionMode: "loop",
      clarifyStrength: "balanced",
      loopStrength: "light",
    };

    await dispatchComposerAgentMessage({
      client,
      agentId: "agent",
      text: "run this in the background",
      attachments: [],
      encodeImages: passthroughEncodeImages,
      thoth,
    });

    expect(client.calls[0]?.options.thoth).toEqual(thoth);
  });

  it("serializes workspace review attachments through the structured attachment path", async () => {
    const client = createFakeSendClient();
    const review = reviewWorkspaceAttachment("Please simplify this.");

    await dispatchComposerAgentMessage({
      client,
      agentId: "agent",
      text: "review this",
      attachments: [review],
      encodeImages: passthroughEncodeImages,
    });

    expect(client.calls[0]?.options.attachments).toEqual([review.attachment]);
    expect(client.calls[0]?.options.images).toEqual([]);
  });

  it("serializes browser_element workspace attachments as text attachments at the wire boundary", async () => {
    const client = createFakeSendClient();
    const browserElement = browserElementWorkspaceAttachment();

    await dispatchComposerAgentMessage({
      client,
      agentId: "agent",
      text: "inspect element",
      attachments: [browserElement],
      encodeImages: passthroughEncodeImages,
    });

    expect(client.calls[0]?.options.attachments).toEqual([
      {
        type: "text",
        mimeType: "text/plain",
        title: "Browser element · button",
        text: browserElement.attachment.formatted,
      },
    ]);
  });
});

describe("removeComposerAttachmentAtIndex", () => {
  it("removes an image attachment and asks the persister to delete the underlying metadata", () => {
    const image = imageWithId("img-remove");
    const persister = createFakePersister();
    const next = removeComposerAttachmentAtIndex({
      attachments: [{ kind: "image", metadata: image }] satisfies UserComposerAttachment[],
      index: 0,
      deleteAttachments: persister.deleteAttachments,
    });
    expect(next).toEqual([]);
    expect(persister.deletedBatches).toEqual([[image]]);
  });

  it("removes a github attachment without scheduling any storage deletes", () => {
    const persister = createFakePersister();
    const next = removeComposerAttachmentAtIndex({
      attachments: [
        { kind: "github_issue", item: issueItem },
        { kind: "github_pr", item: prItem },
      ] satisfies UserComposerAttachment[],
      index: 0,
      deleteAttachments: persister.deleteAttachments,
    });
    expect(next).toEqual([{ kind: "github_pr", item: prItem }]);
    expect(persister.deletedBatches).toEqual([]);
  });
});

describe("openComposerAttachment", () => {
  it("opens the lightbox for image attachments", () => {
    const image = imageWithId("img-body");
    const lightboxCalls: AttachmentMetadata[] = [];
    const externalUrlCalls: string[] = [];
    openComposerAttachment({
      attachment: { kind: "image", metadata: image },
      setLightboxMetadata: (metadata) => {
        lightboxCalls.push(metadata);
      },
      openWorkspaceAttachment: () => false,
      openExternalUrl: (url) => {
        externalUrlCalls.push(url);
      },
    });
    expect(lightboxCalls).toEqual([image]);
    expect(externalUrlCalls).toEqual([]);
  });

  it("delegates workspace review attachments to the workspace opener", () => {
    const review = reviewWorkspaceAttachment("Open me.");
    const workspaceCalls: ComposerAttachment[] = [];
    openComposerAttachment({
      attachment: review,
      setLightboxMetadata: () => {
        throw new Error("unexpected lightbox call");
      },
      openWorkspaceAttachment: ({ attachment }) => {
        workspaceCalls.push(attachment);
        return true;
      },
      openExternalUrl: () => {
        throw new Error("unexpected external url call");
      },
    });
    expect(workspaceCalls).toEqual([review]);
  });

  it("opens GitHub item URLs through the external url opener", () => {
    const externalUrlCalls: string[] = [];
    openComposerAttachment({
      attachment: { kind: "github_issue", item: issueItem },
      setLightboxMetadata: () => {
        throw new Error("unexpected lightbox call");
      },
      openWorkspaceAttachment: () => false,
      openExternalUrl: (url) => {
        externalUrlCalls.push(url);
      },
    });
    expect(externalUrlCalls).toEqual([issueItem.url]);
  });
});

describe("toggleGithubAttachment", () => {
  it("appends a GitHub issue when not already attached", () => {
    const next = toggleGithubAttachment([], issueItem);
    expect(next).toEqual([{ kind: "github_issue", item: issueItem }]);
  });

  it("appends a GitHub PR when not already attached", () => {
    const next = toggleGithubAttachment([], prItem);
    expect(next).toEqual([{ kind: "github_pr", item: prItem }]);
  });

  it("removes an existing GitHub item with the same kind+number", () => {
    const next = toggleGithubAttachment([{ kind: "github_issue", item: issueItem }], issueItem);
    expect(next).toEqual([]);
  });

  it("does not affect other items with different kind or number", () => {
    const start: UserComposerAttachment[] = [
      { kind: "github_issue", item: issueItem },
      { kind: "github_pr", item: prItem },
    ];
    const otherIssue: GitHubSearchItem = { ...issueItem, number: 999 };
    const next = toggleGithubAttachment(start, otherIssue);
    expect(next).toEqual([
      { kind: "github_issue", item: issueItem },
      { kind: "github_pr", item: prItem },
      { kind: "github_issue", item: otherIssue },
    ]);
  });
});

describe("toggleGithubAttachmentFromPicker", () => {
  it("marks an existing GitHub item as removed when picker toggle removes it", () => {
    const markGithubAttachmentRemoved = vi.fn();
    const attachment: UserComposerAttachment = { kind: "github_pr", item: prItem };

    const next = toggleGithubAttachmentFromPicker({
      current: [attachment],
      item: prItem,
      markGithubAttachmentRemoved,
    });

    expect(next).toEqual([]);
    expect(markGithubAttachmentRemoved).toHaveBeenCalledTimes(1);
    expect(markGithubAttachmentRemoved).toHaveBeenCalledWith(attachment);
  });

  it("does not mark a GitHub item removed when picker toggle adds it", () => {
    const markGithubAttachmentRemoved = vi.fn();

    const next = toggleGithubAttachmentFromPicker({
      current: [],
      item: issueItem,
      markGithubAttachmentRemoved,
    });

    expect(next).toEqual([{ kind: "github_issue", item: issueItem }]);
    expect(markGithubAttachmentRemoved).not.toHaveBeenCalled();
  });
});

describe("findGithubItemByOption / isAttachmentSelectedForGithubItem", () => {
  it("locates items via their composite kind:number id", () => {
    expect(findGithubItemByOption([issueItem, prItem], "issue:101")).toBe(issueItem);
    expect(findGithubItemByOption([issueItem, prItem], "pr:202")).toBe(prItem);
    expect(findGithubItemByOption([issueItem], "pr:404")).toBeUndefined();
  });

  it("recognizes when an attachment list already contains a matching GitHub item", () => {
    const attachments: ComposerAttachment[] = [
      { kind: "image", metadata: imageWithId("img-x") },
      { kind: "github_issue", item: issueItem },
      reviewWorkspaceAttachment("ignored"),
    ];
    expect(isAttachmentSelectedForGithubItem(attachments, issueItem)).toBe(true);
    expect(isAttachmentSelectedForGithubItem(attachments, prItem)).toBe(false);
  });
});
