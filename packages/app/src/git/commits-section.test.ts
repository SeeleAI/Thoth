import { describe, expect, it } from "vitest";
import { selectWorkspaceCommits } from "./commits-section-state";

describe("commit history presentation", () => {
  it("shows Workspace commits without turning base context into a second history", () => {
    const commit = {
      sha: "1".repeat(40),
      shortSha: "1111111",
      subject: "Workspace commit",
      authorName: "Test User",
      authorDate: "2026-07-27T00:00:00Z",
      isOnRemote: false,
      isOnBase: false,
      files: [],
    };
    expect(
      selectWorkspaceCommits([commit, { ...commit, sha: "2".repeat(40), isOnBase: true }]),
    ).toEqual([commit]);
  });
});
