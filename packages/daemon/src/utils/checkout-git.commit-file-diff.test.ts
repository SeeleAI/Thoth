import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCommitFileDiff } from "./checkout-git.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function initRepo(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "thoth-commit-diff-")));
  tempDirs.push(root);
  const repoDir = join(root, "repo");
  mkdirSync(repoDir, { recursive: true });
  git(["init", "-b", "main"], repoDir);
  git(["config", "user.email", "test@test.com"], repoDir);
  git(["config", "user.name", "Test User"], repoDir);
  return repoDir;
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd }).toString();
}

function commitFile(
  repoDir: string,
  name: string,
  content: string | Buffer,
  message: string,
): void {
  writeFileSync(join(repoDir, name), content);
  git(["add", "."], repoDir);
  git(["-c", "commit.gpgsign=false", "commit", "-m", message], repoDir);
}

describe("getCommitFileDiff", () => {
  it("reuses the canonical highlighted diff shape for a commit", async () => {
    const repoDir = initRepo();
    commitFile(repoDir, "file.txt", "before\n", "initial");
    commitFile(repoDir, "file.txt", "after\nextra\n", "edit");
    const sha = git(["rev-parse", "HEAD"], repoDir).trim();

    const file = await getCommitFileDiff({ cwd: repoDir, sha, path: "file.txt" });

    expect(file).toMatchObject({
      path: "file.txt",
      additions: 2,
      deletions: 1,
      status: "ok",
    });
    expect(file?.hunks.flatMap((hunk) => hunk.lines).map((line) => line.type)).toEqual(
      expect.arrayContaining(["header", "remove", "add"]),
    );
  });

  it("compares merge commits to the first parent", async () => {
    const repoDir = initRepo();
    commitFile(repoDir, "README.md", "base\n", "initial");
    git(["checkout", "-b", "feature"], repoDir);
    commitFile(repoDir, "feature.txt", "feature\n", "feature");
    git(["checkout", "main"], repoDir);
    commitFile(repoDir, "main.txt", "main\n", "main");
    git(["merge", "--no-ff", "feature", "-m", "merge feature"], repoDir);
    const sha = git(["rev-parse", "HEAD"], repoDir).trim();

    const file = await getCommitFileDiff({ cwd: repoDir, sha, path: "feature.txt" });

    expect(file).toMatchObject({ path: "feature.txt", isNew: true, additions: 1, deletions: 0 });
  });

  it("returns null for unchanged and binary-only paths", async () => {
    const repoDir = initRepo();
    commitFile(repoDir, "README.md", "base\n", "initial");
    commitFile(repoDir, "binary.bin", Buffer.from([0, 1, 2, 3]), "binary");
    const sha = git(["rev-parse", "HEAD"], repoDir).trim();

    await expect(getCommitFileDiff({ cwd: repoDir, sha, path: "README.md" })).resolves.toBeNull();
    await expect(getCommitFileDiff({ cwd: repoDir, sha, path: "binary.bin" })).resolves.toBeNull();
  });
});
