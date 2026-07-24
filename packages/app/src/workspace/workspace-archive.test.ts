import type { DaemonClient } from "@thoth/client/internal/daemon-client";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isWorkspaceArchivePending } from "@/query/workspace-archive-state";
import type { WorkspaceDescriptor } from "@/projection/authority-model";
import {
  archiveWorkspaceOptimistically,
  archiveWorkspacesOptimistically,
  type WorkspaceArchiveTarget,
} from "@/workspace/workspace-archive";

const SERVER_ID = "workspace-archive-test";
const SECOND_SERVER_ID = "workspace-archive-test-2";

type ArchiveWorkspacePayload = Awaited<ReturnType<DaemonClient["archiveWorkspace"]>>;

function archivePayload(input: {
  workspaceId: string;
  error?: string | null;
}): ArchiveWorkspacePayload {
  return {
    requestId: "request",
    workspaceId: input.workspaceId,
    archivedAt: null,
    error: input.error ?? null,
  };
}

function workspace(input?: Partial<WorkspaceDescriptor>): WorkspaceDescriptor {
  return {
    id: "workspace-1",
    projectId: "project-1",
    projectDisplayName: "Project",
    projectRootPath: "/repo/project",
    workspaceDirectory: "/repo/project/workspace-1",
    projectKind: "git",
    workspaceKind: "worktree",
    name: "workspace-1",
    status: "done",
    archivingAt: null,
    statusEnteredAt: null,
    diffStat: null,
    scripts: [],
    ...input,
  };
}

function target(input?: Partial<WorkspaceArchiveTarget>): WorkspaceArchiveTarget {
  const base = workspace();
  return {
    serverId: SERVER_ID,
    workspaceId: base.id,
    ...input,
  };
}

function createClient(
  archiveWorkspace: DaemonClient["archiveWorkspace"],
): Pick<DaemonClient, "archiveWorkspace"> {
  return { archiveWorkspace };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient();
});

describe("archiveWorkspaceOptimistically", () => {
  it("hides the workspace and marks the archive pending while the daemon call runs", async () => {
    const archived = workspace();
    const releaseArchive = deferred<ArchiveWorkspacePayload>();
    const client = createClient(vi.fn(async () => releaseArchive.promise));

    const archive = archiveWorkspaceOptimistically({
      queryClient,
      client,
      workspace: target(),
    });

    expect(
      isWorkspaceArchivePending({
        queryClient,
        serverId: SERVER_ID,
        workspaceId: archived.id,
      }),
    ).toBe(true);

    releaseArchive.resolve(archivePayload({ workspaceId: archived.id }));
    await archive;

    expect(
      isWorkspaceArchivePending({ queryClient, serverId: SERVER_ID, workspaceId: archived.id }),
    ).toBe(true);
  });

  it("restores the workspace and clears pending state when the daemon rejects the archive", async () => {
    const archived = workspace();
    const client = createClient(
      vi.fn(async () => archivePayload({ workspaceId: archived.id, error: "nope" })),
    );

    await expect(
      archiveWorkspaceOptimistically({
        queryClient,
        client,
        workspace: target(),
      }),
    ).rejects.toThrow("nope");

    expect(
      isWorkspaceArchivePending({
        queryClient,
        serverId: SERVER_ID,
        workspaceId: archived.id,
      }),
    ).toBe(false);
  });

  it("runs the after-hide hook after local state is hidden", async () => {
    const archived = workspace();
    const client = createClient(vi.fn(async () => archivePayload({ workspaceId: archived.id })));
    const afterHide = vi.fn(() => {
      expect(
        isWorkspaceArchivePending({
          queryClient,
          serverId: SERVER_ID,
          workspaceId: archived.id,
        }),
      ).toBe(true);
    });

    await archiveWorkspaceOptimistically({
      queryClient,
      client,
      workspace: target(),
      afterHide,
    });

    expect(afterHide).toHaveBeenCalledOnce();
  });
});

describe("archiveWorkspacesOptimistically", () => {
  it("returns failures and restores only the workspaces whose archive failed", async () => {
    const first = workspace({ id: "workspace-1" });
    const second = workspace({
      id: "workspace-2",
      workspaceDirectory: "/repo/project/workspace-2",
      name: "workspace-2",
    });
    const client = createClient(
      vi.fn(async (workspaceId) =>
        archivePayload({
          workspaceId,
          error: workspaceId === second.id ? "failed" : null,
        }),
      ),
    );

    const failures = await archiveWorkspacesOptimistically({
      queryClient,
      getClient: () => client,
      workspaces: [
        target({ workspaceId: first.id, workspaceDirectory: first.workspaceDirectory }),
        target({ workspaceId: second.id, workspaceDirectory: second.workspaceDirectory }),
      ],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]?.workspaceId).toBe(second.id);
    expect(
      isWorkspaceArchivePending({ queryClient, serverId: SERVER_ID, workspaceId: first.id }),
    ).toBe(true);
    expect(
      isWorkspaceArchivePending({ queryClient, serverId: SERVER_ID, workspaceId: second.id }),
    ).toBe(false);
  });

  it("archives each workspace through its own server client", async () => {
    const first = workspace({ id: "workspace-1" });
    const second = workspace({
      id: "workspace-2",
      workspaceDirectory: "/repo/project/workspace-2",
      name: "workspace-2",
    });
    const archivedByServer = new Map<string, string[]>();
    const clientFor = (serverId: string) =>
      createClient(async (workspaceId) => {
        archivedByServer.set(serverId, [...(archivedByServer.get(serverId) ?? []), workspaceId]);
        return archivePayload({ workspaceId });
      });

    const failures = await archiveWorkspacesOptimistically({
      queryClient,
      getClient: (serverId) => clientFor(serverId),
      workspaces: [
        target({
          serverId: SERVER_ID,
          workspaceId: first.id,
          workspaceDirectory: first.workspaceDirectory,
        }),
        target({
          serverId: SECOND_SERVER_ID,
          workspaceId: second.id,
          workspaceDirectory: second.workspaceDirectory,
        }),
      ],
    });

    expect(failures).toEqual([]);
    expect(archivedByServer).toEqual(
      new Map([
        [SERVER_ID, [first.id]],
        [SECOND_SERVER_ID, [second.id]],
      ]),
    );
    expect(
      isWorkspaceArchivePending({ queryClient, serverId: SERVER_ID, workspaceId: first.id }),
    ).toBe(true);
    expect(
      isWorkspaceArchivePending({
        queryClient,
        serverId: SECOND_SERVER_ID,
        workspaceId: second.id,
      }),
    ).toBe(true);
  });
});
