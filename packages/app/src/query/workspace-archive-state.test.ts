import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/projection/authority-model";
import {
  clearWorkspaceArchivePending,
  isWorkspaceArchivePending,
  markWorkspaceArchivePending,
  shouldSuppressWorkspaceForLocalArchive,
} from "@/query/workspace-archive-state";

const baseWorkspace: WorkspaceDescriptor = {
  id: "/repo/worktree",
  projectId: "/repo",
  projectDisplayName: "Repo",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo/worktree",
  projectKind: "git",
  workspaceKind: "worktree",
  name: "feature",
  status: "done",
  archivingAt: "2026-04-30T00:00:00.000Z",
  statusEnteredAt: null,
  diffStat: null,
  scripts: [],
};

function workspace(input?: Partial<WorkspaceDescriptor>): WorkspaceDescriptor {
  return { ...baseWorkspace, ...input };
}

describe("workspace archive pending query", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it("tracks a locally pending workspace archive by id", () => {
    markWorkspaceArchivePending({
      queryClient,
      serverId: "server-1",
      workspaceId: "/repo/worktree",
    });

    expect(
      isWorkspaceArchivePending({
        queryClient,
        serverId: "server-1",
        workspaceId: "/repo/worktree",
      }),
    ).toBe(true);
    expect(
      shouldSuppressWorkspaceForLocalArchive({
        queryClient,
        serverId: "server-1",
        workspace: workspace({ archivingAt: null }),
      }),
    ).toBe(true);

    clearWorkspaceArchivePending({
      queryClient,
      serverId: "server-1",
      workspaceId: "/repo/worktree",
    });
    expect(
      isWorkspaceArchivePending({
        queryClient,
        serverId: "server-1",
        workspaceId: "/repo/worktree",
      }),
    ).toBe(false);
  });

  it("keeps pending archives isolated by server", () => {
    markWorkspaceArchivePending({
      queryClient,
      serverId: "server-1",
      workspaceId: "/repo/worktree",
    });
    expect(
      isWorkspaceArchivePending({
        queryClient,
        serverId: "server-2",
        workspaceId: "/repo/worktree",
      }),
    ).toBe(false);
  });

  it("can correlate a pending archive by normalized directory", () => {
    markWorkspaceArchivePending({
      queryClient,
      serverId: "server-1",
      workspaceId: "workspace-id",
      workspaceDirectory: "/repo/worktree/",
    });
    expect(
      isWorkspaceArchivePending({
        queryClient,
        serverId: "server-1",
        workspaceDirectory: "/repo/worktree",
      }),
    ).toBe(true);
  });

  it("does not suppress a same-directory sibling without directory correlation", () => {
    markWorkspaceArchivePending({
      queryClient,
      serverId: "server-1",
      workspaceId: "/repo/worktree",
    });
    expect(
      shouldSuppressWorkspaceForLocalArchive({
        queryClient,
        serverId: "server-1",
        workspace: workspace({ id: "sibling" }),
      }),
    ).toBe(false);
  });

  it("does not suppress an archive this client did not start", () => {
    expect(
      shouldSuppressWorkspaceForLocalArchive({
        queryClient,
        serverId: "server-1",
        workspace: workspace(),
      }),
    ).toBe(false);
  });
});
