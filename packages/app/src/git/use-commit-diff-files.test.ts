import { describe, expect, it } from "vitest";
import type { CheckoutCommitFile, ParsedDiffFile } from "@thoth/protocol/messages";
import { resolveCommitDiffFile, resolveCommitDiffFiles } from "./use-commit-diff-files";

const sourceFile: CheckoutCommitFile = {
  path: "src/a.ts",
  additions: 2,
  deletions: 1,
  status: "modified",
};

describe("commit diff file projection", () => {
  it("retains the canonical parsed file returned by the daemon", () => {
    const parsed: ParsedDiffFile = {
      path: sourceFile.path,
      isNew: false,
      isDeleted: false,
      additions: 2,
      deletions: 1,
      hunks: [],
      status: "ok",
    };
    expect(resolveCommitDiffFile(sourceFile, parsed)).toBe(parsed);
  });

  it("maps a daemon null result to an explicit read-only binary placeholder", () => {
    expect(resolveCommitDiffFile(sourceFile, null)).toEqual({
      path: sourceFile.path,
      isNew: false,
      isDeleted: false,
      additions: 2,
      deletions: 1,
      hunks: [],
      status: "binary",
    });
  });

  it("omits unresolved requests until their immutable query resolves", () => {
    expect(resolveCommitDiffFiles([sourceFile], new Map([[sourceFile.path, undefined]]))).toEqual(
      [],
    );
  });
});
