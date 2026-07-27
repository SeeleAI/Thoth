import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listCheckoutCommits } from "./checkout-git.js";
import { writeThothWorktreeMetadata } from "./worktree-metadata.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "thoth-checkout-commits-")));
  tempDirs.push(dir);
  return dir;
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd }).toString();
}

function commit(repoDir: string, message: string): void {
  git(["-c", "commit.gpgsign=false", "commit", "-m", message], repoDir);
}

function commitFile(repoDir: string, name: string, content: string, message: string): void {
  writeFileSync(join(repoDir, name), content);
  git(["add", "."], repoDir);
  commit(repoDir, message);
}

function initRepoOnMain(): { repoDir: string; tempDir: string } {
  const tempDir = makeTempDir();
  const repoDir = join(tempDir, "repo");
  mkdirSync(repoDir, { recursive: true });
  git(["init", "-b", "main"], repoDir);
  git(["config", "user.email", "test@test.com"], repoDir);
  git(["config", "user.name", "Test User"], repoDir);
  commitFile(repoDir, "README.md", "base\n", "initial");
  return { repoDir, tempDir };
}

function addBareRemote(repoDir: string, tempDir: string): void {
  const remoteDir = join(tempDir, "remote.git");
  git(["init", "--bare", "-b", "main", remoteDir], tempDir);
  git(["remote", "add", "origin", remoteDir], repoDir);
}

describe("listCheckoutCommits", () => {
  it("lists workspace commits before bounded base history with remote and file classification", async () => {
    const { repoDir, tempDir } = initRepoOnMain();
    addBareRemote(repoDir, tempDir);
    git(["push", "-u", "origin", "main"], repoDir);
    git(["checkout", "-b", "feature"], repoDir);
    commitFile(repoDir, "feature.txt", "one\ntwo\n", "Add feature");
    git(["push", "-u", "origin", "feature"], repoDir);
    commitFile(repoDir, "feature.txt", "one\nchanged\n", "Update feature");

    const { baseRef, commits } = await listCheckoutCommits({ cwd: repoDir });

    expect(baseRef).toBe("main");
    expect(commits.map((entry) => entry.subject)).toEqual([
      "Update feature",
      "Add feature",
      "initial",
    ]);
    expect(commits.map((entry) => entry.isOnBase)).toEqual([false, false, true]);
    expect(commits.map((entry) => entry.isOnRemote)).toEqual([false, true, true]);
    expect(commits[0]?.files).toEqual([
      { path: "feature.txt", additions: 1, deletions: 1, status: "modified" },
    ]);
  });

  it("uses the surviving base when stale worktree metadata names a deleted branch", async () => {
    const { repoDir, tempDir } = initRepoOnMain();
    const worktreesRoot = join(tempDir, "worktrees");
    const worktreeDir = join(worktreesRoot, "repo-hash", "feature");
    mkdirSync(join(worktreesRoot, "repo-hash"), { recursive: true });
    git(["worktree", "add", "-b", "feature", worktreeDir], repoDir);
    commitFile(worktreeDir, "feature.txt", "feature\n", "Feature work");
    writeThothWorktreeMetadata(worktreeDir, { baseRefName: "deleted-base" });

    const { baseRef, commits } = await listCheckoutCommits({
      cwd: worktreeDir,
      context: { worktreesRoot },
    });

    expect(baseRef).toBe("main");
    expect(commits.map((entry) => entry.subject)).toEqual(["Feature work", "initial"]);
    expect(commits.map((entry) => entry.isOnBase)).toEqual([false, true]);
  });

  it("normalizes renamed, deleted, and binary file records", async () => {
    const { repoDir } = initRepoOnMain();
    git(["checkout", "-b", "feature"], repoDir);
    commitFile(repoDir, "original.txt", "content\n", "Add original");
    git(["mv", "original.txt", "renamed.txt"], repoDir);
    commit(repoDir, "Rename original");
    writeFileSync(join(repoDir, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    git(["add", "binary.bin"], repoDir);
    commit(repoDir, "Add binary");
    git(["rm", "renamed.txt"], repoDir);
    commit(repoDir, "Delete renamed");

    const { commits } = await listCheckoutCommits({ cwd: repoDir });

    expect(commits[0]?.files).toEqual([
      { path: "renamed.txt", additions: 0, deletions: 1, status: "deleted" },
    ]);
    expect(commits[1]?.files).toEqual([
      { path: "binary.bin", additions: 0, deletions: 0, status: "added" },
    ]);
    expect(commits[2]?.files).toEqual([
      { path: "renamed.txt", additions: 0, deletions: 0, status: "renamed" },
    ]);
  });

  it("limits base-only history to ten commits", async () => {
    const { repoDir } = initRepoOnMain();
    for (let index = 1; index <= 14; index += 1) {
      commitFile(repoDir, "history.txt", `${index}\n`, `Base ${index}`);
    }

    const { baseRef, commits } = await listCheckoutCommits({ cwd: repoDir });

    expect(baseRef).toBeNull();
    expect(commits).toHaveLength(10);
    expect(commits.map((entry) => entry.subject)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Base ${14 - index}`),
    );
    expect(commits.every((entry) => entry.isOnBase)).toBe(true);
  });
});
