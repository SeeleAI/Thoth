import { describe, expect, test, vi } from "vitest";

import type { GitHubService } from "./github-service.js";
import type { WorkspaceGitRuntimeSnapshot } from "../server/workspace-git-service.js";
import type { GitCommandResult } from "../utils/run-git-command.js";
import {
  ForgeChangeRequestError,
  ForgeChangeRequestService,
} from "./forge-change-request-service.js";

const REMOTES = [
  ["https://github.com/acme/widgets.git", "github", "https://github.com/acme/widgets/pull/17"],
  [
    "git@gitlab.com:acme/platform/widgets.git",
    "gitlab",
    "https://gitlab.com/acme/platform/widgets/-/merge_requests/17",
  ],
  ["https://gitea.com/acme/widgets.git", "gitea", "https://gitea.com/acme/widgets/pulls/17"],
  [
    "ssh://git@forgejo.example.com/acme/widgets.git",
    "forgejo",
    "https://forgejo.example.com/acme/widgets/pulls/17",
  ],
  [
    "https://codeberg.org/acme/widgets.git",
    "codeberg",
    "https://codeberg.org/acme/widgets/pulls/17",
  ],
] as const;

describe("ForgeChangeRequestService", () => {
  test.each(REMOTES)("creates a neutral change request for %s", async (remoteUrl, forge, url) => {
    const runGit = vi.fn(async () => successGitResult());
    const runCommand = vi.fn(async (command: string) => ({
      stdout: command === "glab" ? `${url}\n` : `${url}\n`,
      stderr: "",
    }));
    const createPullRequest = vi.fn(async () => ({ url, number: 17 }));
    const invalidate = vi.fn();
    const service = new ForgeChangeRequestService({
      workspaceGitService: {
        getSnapshot: async () => gitSnapshot(remoteUrl),
      },
      github: { createPullRequest, invalidate } as Pick<
        GitHubService,
        "createPullRequest" | "invalidate"
      >,
      runGit,
      runCommand,
    });

    const result = await service.create({
      cwd: "/work/widgets",
      title: "Ship widgets",
      body: "Ready",
    });

    expect(result).toMatchObject({ url, number: 17, repository: { forge } });
    expect(runGit).toHaveBeenCalledWith(
      ["push", "-u", "origin", "feature/widgets"],
      expect.objectContaining({
        cwd: "/work/widgets",
        envOverlay: { GIT_TERMINAL_PROMPT: "0" },
      }),
    );
    if (forge === "github") {
      expect(createPullRequest).toHaveBeenCalledWith({
        cwd: "/work/widgets",
        repo: "acme/widgets",
        title: "Ship widgets",
        body: "Ready",
        head: "feature/widgets",
        base: "main",
      });
      expect(runCommand).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledWith({ cwd: "/work/widgets" });
    } else {
      expect(createPullRequest).not.toHaveBeenCalled();
      expect(runCommand).toHaveBeenCalledWith(
        forge === "gitlab" ? "glab" : "tea",
        expect.any(Array),
        expect.objectContaining({ cwd: "/work/widgets" }),
      );
    }
  });

  test("returns a typed missing-CLI error without exposing title or body", async () => {
    const missing = Object.assign(new Error("spawn failed SECRET_TITLE SECRET_BODY"), {
      code: "ENOENT",
    });
    const service = new ForgeChangeRequestService({
      workspaceGitService: { getSnapshot: async () => gitSnapshot("https://gitlab.com/a/b.git") },
      github: {
        createPullRequest: vi.fn(),
        invalidate: vi.fn(),
      } as unknown as Pick<GitHubService, "createPullRequest" | "invalidate">,
      runGit: async () => successGitResult(),
      runCommand: async () => {
        throw missing;
      },
    });

    const error = await service
      .create({
        cwd: "/work/widgets",
        title: "SECRET_TITLE",
        body: "SECRET_BODY",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForgeChangeRequestError);
    expect(error).toMatchObject({ code: "missing_cli" });
    expect(String(error)).not.toContain("SECRET_TITLE");
    expect(String(error)).not.toContain("SECRET_BODY");
  });

  test("rejects unknown remotes before pushing", async () => {
    const runGit = vi.fn(async () => successGitResult());
    const service = new ForgeChangeRequestService({
      workspaceGitService: {
        getSnapshot: async () => gitSnapshot("https://git.example.com/acme/widgets.git"),
      },
      github: {
        createPullRequest: vi.fn(),
        invalidate: vi.fn(),
      } as unknown as Pick<GitHubService, "createPullRequest" | "invalidate">,
      runGit,
    });

    await expect(service.create({ cwd: "/work/widgets", title: "Widgets" })).rejects.toMatchObject({
      code: "unsupported_forge",
    });
    expect(runGit).not.toHaveBeenCalled();
  });
});

function gitSnapshot(remoteUrl: string): WorkspaceGitRuntimeSnapshot {
  return {
    cwd: "/work/widgets",
    git: {
      isGit: true,
      repoRoot: "/work/widgets",
      mainRepoRoot: null,
      currentBranch: "feature/widgets",
      remoteUrl,
      isThothOwnedWorktree: false,
      isDirty: false,
      baseRef: "origin/main",
      aheadBehind: { ahead: 1, behind: 0 },
      aheadOfOrigin: 1,
      behindOfOrigin: 0,
      hasRemote: true,
      diffStat: { additions: 1, deletions: 0 },
    },
    github: { featuresEnabled: false, pullRequest: null, error: null },
  };
}

function successGitResult(): GitCommandResult {
  return { stdout: "", stderr: "", truncated: false, exitCode: 0, signal: null };
}
