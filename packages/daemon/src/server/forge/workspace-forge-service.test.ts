import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { WorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "../workspace-registry.js";
import type { GitCommandResult } from "../../utils/run-git-command.js";
import { WorkspaceForgeError, WorkspaceForgeService } from "./workspace-forge-service.js";

const logger = {
  trace: vi.fn(),
  warn: vi.fn(),
};

let root: string;
let records: PersistedWorkspaceRecord[];
let createWorkspaceForDirectory: ReturnType<
  typeof vi.fn<(cwd: string, title?: string | null) => Promise<PersistedWorkspaceRecord>>
>;
let runGit: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "thoth-forge-"));
  records = [];
  createWorkspaceForDirectory = vi.fn(async (cwd: string, title?: string | null) => {
    const workspace = makeWorkspace(cwd, title ?? null);
    records.push(workspace);
    return workspace;
  });
  runGit = vi.fn(async (args: string[]) => {
    const destination = args.at(-1);
    if (!destination) throw new Error("missing clone destination");
    await mkdir(destination, { recursive: true });
    return successResult();
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("WorkspaceForgeService", () => {
  test.each([
    ["https://github.com/acme/widgets.git", "github"],
    ["git@gitlab.com:acme/platform/widgets.git", "gitlab"],
    ["https://gitea.com/acme/widgets", "gitea"],
    ["ssh://git@forgejo.example.com/acme/widgets.git", "forgejo"],
    ["https://codeberg.org/acme/widgets.git", "codeberg"],
  ] as const)("resolves the supported Forge remote %s", (remoteUrl, forge) => {
    expect(createService().resolveRepository(remoteUrl)).toMatchObject({ forge });
  });

  test("clones with non-interactive credentials and registers the canonical Workspace", async () => {
    const destinationPath = join(root, "widgets");

    const result = await createService().cloneWorkspace({
      remoteUrl: "https://github.com/acme/widgets.git",
      destinationPath,
      title: "Widgets",
    });

    expect(runGit).toHaveBeenCalledWith(
      ["clone", "--", "https://github.com/acme/widgets.git", destinationPath],
      expect.objectContaining({
        cwd: root,
        envOverlay: { GIT_TERMINAL_PROMPT: "0" },
      }),
    );
    expect(createWorkspaceForDirectory).toHaveBeenCalledWith(destinationPath, "Widgets");
    expect(result.workspace).toMatchObject({ cwd: destinationPath, title: "Widgets" });
  });

  test("rejects an existing destination before Git runs", async () => {
    const destinationPath = join(root, "existing");
    await mkdir(destinationPath);

    await expect(
      createService().cloneWorkspace({
        remoteUrl: "https://codeberg.org/acme/widgets.git",
        destinationPath,
      }),
    ).rejects.toMatchObject({ code: "destination_exists" });
    expect(runGit).not.toHaveBeenCalled();
  });

  test("rejects a destination already owned by durable Workspace authority", async () => {
    const destinationPath = join(root, "missing-but-owned");
    records.push(makeWorkspace(destinationPath, null));

    await expect(
      createService().cloneWorkspace({
        remoteUrl: "https://gitlab.com/acme/widgets.git",
        destinationPath,
      }),
    ).rejects.toMatchObject({ code: "duplicate_workspace" });
    expect(runGit).not.toHaveBeenCalled();
  });

  test("maps credential failures and removes only the operation-owned partial clone", async () => {
    const destinationPath = join(root, "private");
    runGit.mockImplementationOnce(async (args: string[]) => {
      await mkdir(args.at(-1)!, { recursive: true });
      throw new Error("Git command failed: Authentication failed for remote");
    });

    const error = await createService()
      .cloneWorkspace({
        remoteUrl: "https://github.com/acme/private.git",
        destinationPath,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkspaceForgeError);
    expect(error).toMatchObject({ code: "authentication_failed" });
    await expectPathMissing(destinationPath);
    expect(createWorkspaceForDirectory).not.toHaveBeenCalled();
  });

  test("distinguishes malformed remotes from unsupported self-hosted Forges", () => {
    expect(() => createService().resolveRepository("not a remote")).toThrowError(
      expect.objectContaining({ code: "invalid_remote" }),
    );
    expect(() =>
      createService().resolveRepository("https://git.example.com/acme/widgets.git"),
    ).toThrowError(expect.objectContaining({ code: "unsupported_forge" }));
    expect(
      createService().resolveRepository("https://git.example.com/acme/widgets.git", "forgejo"),
    ).toMatchObject({ forge: "forgejo" });
  });
});

function createService(): WorkspaceForgeService {
  const workspaceRegistry = {
    list: async () => records,
  } as WorkspaceRegistry;
  const workspaceProvisioning = {
    createWorkspaceForDirectory,
  } as unknown as WorkspaceProvisioningService;
  return new WorkspaceForgeService({
    workspaceRegistry,
    workspaceProvisioning,
    logger,
    runGit,
  });
}

function makeWorkspace(cwd: string, title: string | null): PersistedWorkspaceRecord {
  return {
    workspaceId: `workspace-${records.length + 1}`,
    projectId: "project-1",
    cwd,
    kind: "local_checkout",
    displayName: "widgets",
    title,
    branch: "main",
    baseBranch: null,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    archivedAt: null,
  };
}

function successResult(): GitCommandResult {
  return { stdout: "", stderr: "", truncated: false, exitCode: 0, signal: null };
}

async function expectPathMissing(path: string): Promise<void> {
  await expect(import("node:fs/promises").then(({ lstat }) => lstat(path))).rejects.toMatchObject({
    code: "ENOENT",
  });
}
