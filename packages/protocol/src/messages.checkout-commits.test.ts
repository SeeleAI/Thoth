import { describe, expect, test } from "vitest";

import {
  CheckoutCommitFileDiffRequestSchema,
  CheckoutCommitFileDiffResponseSchema,
  CheckoutCommitsListRequestSchema,
  CheckoutCommitsListResponseSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  rpcRegistry,
} from "./messages.js";

describe("read-only checkout commit history RPC contracts", () => {
  test("parses commit history through the Registry and session unions", () => {
    const request = {
      type: "checkout.commits.list.request" as const,
      cwd: "/tmp/repo",
      requestId: "commits-1",
    };
    const response = {
      type: "checkout.commits.list.response" as const,
      payload: {
        cwd: "/tmp/repo",
        baseRef: "main",
        commits: [
          {
            sha: "1".repeat(40),
            shortSha: "1111111",
            subject: "Add history",
            authorName: "Test User",
            authorDate: "2026-07-27T00:00:00Z",
            isOnRemote: false,
            isOnBase: false,
            files: [
              {
                path: "src/history.ts",
                additions: 3,
                deletions: 1,
                status: "modified" as const,
              },
            ],
          },
        ],
        error: null,
        requestId: "commits-1",
      },
    };

    expect(CheckoutCommitsListRequestSchema.parse(request)).toEqual(request);
    expect(CheckoutCommitsListResponseSchema.parse(response)).toEqual(response);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    expect(rpcRegistry.operationForRequestType(request.type)?.operation).toBe(
      "listCheckoutCommits",
    );
  });

  test("parses textual and binary-only commit file diff results", () => {
    const request = {
      type: "checkout.commits.file_diff.request" as const,
      cwd: "/tmp/repo",
      sha: "2".repeat(40),
      path: "src/history.ts",
      requestId: "commit-diff-1",
    };
    const response = {
      type: "checkout.commits.file_diff.response" as const,
      payload: {
        cwd: request.cwd,
        sha: request.sha,
        path: request.path,
        file: {
          path: request.path,
          isNew: false,
          isDeleted: false,
          additions: 1,
          deletions: 1,
          hunks: [
            {
              oldStart: 1,
              oldCount: 1,
              newStart: 1,
              newCount: 1,
              lines: [
                { type: "header" as const, content: "@@ -1 +1 @@" },
                { type: "remove" as const, content: "before" },
                { type: "add" as const, content: "after" },
              ],
            },
          ],
          status: "ok" as const,
        },
        error: null,
        requestId: request.requestId,
      },
    };

    expect(CheckoutCommitFileDiffRequestSchema.parse(request)).toEqual(request);
    expect(CheckoutCommitFileDiffResponseSchema.parse(response)).toEqual(response);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);

    expect(
      CheckoutCommitFileDiffResponseSchema.parse({
        ...response,
        payload: { ...response.payload, file: null },
      }).payload.file,
    ).toBeNull();
    expect(rpcRegistry.operationForRequestType(request.type)?.operation).toBe("getCommitFileDiff");
  });
});
