import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient as appQueryClient } from "@/query/query-client";
import type { WorkspaceDescriptor } from "@/projection/authority-model";
import { appProjectionRuntime } from "@/projection/projection-context";
import { clearTestProjections, setTestProjection } from "@/test-utils/authority-projection";
import {
  __resetCheckoutGitActionsStoreForTests,
  isLocalWorktreeArchivePending,
  useCheckoutGitActionsStore,
} from "@/git/actions-store";
import { isWorkspaceArchivePending } from "@/query/workspace-archive-state";

const hostRuntime = vi.hoisted(() => ({
  clients: new Map<string, unknown>(),
  serverInfo: new Map<string, unknown>(),
}));

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: (serverId: string) => hostRuntime.clients.get(serverId) ?? null,
    getSnapshot: (serverId: string) => ({
      client: hostRuntime.clients.get(serverId) ?? null,
      serverInfo: hostRuntime.serverInfo.get(serverId) ?? null,
    }),
  }),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function workspace(input: Partial<WorkspaceDescriptor> & Pick<WorkspaceDescriptor, "id">) {
  return {
    id: input.id,
    projectId: input.projectId ?? "project-1",
    projectDisplayName: input.projectDisplayName ?? "Project",
    projectRootPath: input.projectRootPath ?? "/tmp/repo",
    workspaceDirectory: input.workspaceDirectory ?? "/tmp/repo/worktrees/feature",
    projectKind: input.projectKind ?? "git",
    workspaceKind: input.workspaceKind ?? "worktree",
    name: input.name ?? input.id,
    status: input.status ?? "done",
    archivingAt: input.archivingAt ?? null,
    statusEnteredAt: null,
    diffStat: input.diffStat ?? null,
    scripts: input.scripts ?? [],
  } satisfies WorkspaceDescriptor;
}

function setRuntimeClient(client: unknown, features: Record<string, boolean> = {}): void {
  hostRuntime.clients.set("server-1", client);
  hostRuntime.serverInfo.set("server-1", {
    serverId: "server-1",
    hostname: null,
    version: null,
    features,
  });
}

describe("checkout-git-actions-store", () => {
  const serverId = "server-1";
  const cwd = "/tmp/repo/worktrees/feature";
  const workspaceId = "ws-feature";

  beforeEach(() => {
    vi.useFakeTimers();
    __resetCheckoutGitActionsStoreForTests();
    hostRuntime.clients.clear();
    hostRuntime.serverInfo.clear();
    appQueryClient.clear();
    clearTestProjections();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetCheckoutGitActionsStoreForTests();
    hostRuntime.clients.clear();
    hostRuntime.serverInfo.clear();
    appQueryClient.clear();
    clearTestProjections();
  });

  it("shares pending state per checkout and de-dupes in-flight calls", async () => {
    const deferred = createDeferred<unknown>();
    const client = {
      checkoutCommit: vi.fn(() => deferred.promise),
    };

    setRuntimeClient(client);

    const store = useCheckoutGitActionsStore.getState();

    const first = store.commit({ serverId, cwd });
    const second = store.commit({ serverId, cwd });

    expect(store.getStatus({ serverId, cwd, actionId: "commit" })).toBe("pending");

    deferred.resolve({});
    await Promise.all([first, second]);

    expect(store.getStatus({ serverId, cwd, actionId: "commit" })).toBe("success");

    vi.advanceTimersByTime(1000);
    expect(store.getStatus({ serverId, cwd, actionId: "commit" })).toBe("idle");
  });

  it("runs pull then push sequentially for pull-and-push", async () => {
    const order: string[] = [];
    const client = {
      checkoutPull: vi.fn(async () => {
        order.push("pull");
        return {};
      }),
      checkoutPush: vi.fn(async () => {
        order.push("push");
        return {};
      }),
    };
    setRuntimeClient(client);

    await useCheckoutGitActionsStore.getState().pullAndPush({ serverId, cwd });

    expect(order).toEqual(["pull", "push"]);
    expect(
      useCheckoutGitActionsStore.getState().getStatus({ serverId, cwd, actionId: "pull-and-push" }),
    ).toBe("success");
  });

  it("does not push when pull fails for pull-and-push", async () => {
    const client = {
      checkoutPull: vi.fn(async () => ({ error: { message: "pull conflict" } })),
      checkoutPush: vi.fn(async () => ({})),
    };
    setRuntimeClient(client);

    await expect(
      useCheckoutGitActionsStore.getState().pullAndPush({ serverId, cwd }),
    ).rejects.toThrow("pull conflict");
    expect(
      useCheckoutGitActionsStore.getState().getStatus({ serverId, cwd, actionId: "pull-and-push" }),
    ).toBe("idle");
  });

  it("surfaces push errors from pull-and-push after a successful pull", async () => {
    const client = {
      checkoutPull: vi.fn(async () => ({})),
      checkoutPush: vi.fn(async () => ({ error: { message: "push rejected" } })),
    };
    setRuntimeClient(client);

    await expect(
      useCheckoutGitActionsStore.getState().pullAndPush({ serverId, cwd }),
    ).rejects.toThrow("push rejected");
    expect(
      useCheckoutGitActionsStore.getState().getStatus({ serverId, cwd, actionId: "pull-and-push" }),
    ).toBe("idle");
  });

  it("refreshes git and GitHub state and reports success", async () => {
    const client = {
      checkoutRefresh: vi.fn(async () => ({ success: true, error: null })),
    };
    setRuntimeClient(client);

    await useCheckoutGitActionsStore.getState().refresh({ serverId, cwd });

    expect(client.checkoutRefresh).toHaveBeenCalledWith(cwd);
    expect(
      useCheckoutGitActionsStore.getState().getStatus({ serverId, cwd, actionId: "refresh" }),
    ).toBe("success");
  });

  it("surfaces a refresh error and returns to idle", async () => {
    const client = {
      checkoutRefresh: vi.fn(async () => ({ error: { message: "not a git repository" } })),
    };
    setRuntimeClient(client);

    await expect(useCheckoutGitActionsStore.getState().refresh({ serverId, cwd })).rejects.toThrow(
      "not a git repository",
    );
    expect(
      useCheckoutGitActionsStore.getState().getStatus({ serverId, cwd, actionId: "refresh" }),
    ).toBe("idle");
  });

  it("enables PR auto-merge when the daemon advertises auto-merge actions", async () => {
    const client = {
      checkoutGithubSetAutoMerge: vi.fn(async () => ({
        enabled: true,
        success: true,
        error: null,
      })),
    };
    setRuntimeClient(client, { checkoutGithubSetAutoMerge: true });

    await useCheckoutGitActionsStore
      .getState()
      .enablePrAutoMerge({ serverId, cwd, method: "squash" });

    expect(client.checkoutGithubSetAutoMerge).toHaveBeenCalledWith(cwd, {
      enabled: true,
      method: "squash",
    });
    expect(
      useCheckoutGitActionsStore
        .getState()
        .getStatus({ serverId, cwd, actionId: "enable-pr-auto-merge-squash" }),
    ).toBe("success");
  });

  it("disables PR auto-merge when the daemon advertises auto-merge actions", async () => {
    const client = {
      checkoutGithubSetAutoMerge: vi.fn(async () => ({
        enabled: false,
        success: true,
        error: null,
      })),
    };
    setRuntimeClient(client, { checkoutGithubSetAutoMerge: true });

    await useCheckoutGitActionsStore.getState().disablePrAutoMerge({ serverId, cwd });

    expect(client.checkoutGithubSetAutoMerge).toHaveBeenCalledWith(cwd, { enabled: false });
    expect(
      useCheckoutGitActionsStore
        .getState()
        .getStatus({ serverId, cwd, actionId: "disable-pr-auto-merge" }),
    ).toBe("success");
  });

  it("does not call PR auto-merge RPCs when the daemon lacks the feature flag", async () => {
    const client = {
      checkoutGithubSetAutoMerge: vi.fn(async () => ({
        enabled: true,
        success: true,
        error: null,
      })),
    };
    setRuntimeClient(client);

    await expect(
      useCheckoutGitActionsStore.getState().enablePrAutoMerge({ serverId, cwd, method: "merge" }),
    ).rejects.toThrow("Update the host to use GitHub auto-merge actions.");

    expect(client.checkoutGithubSetAutoMerge).not.toHaveBeenCalled();
    expect(
      useCheckoutGitActionsStore
        .getState()
        .getStatus({ serverId, cwd, actionId: "enable-pr-auto-merge-merge" }),
    ).toBe("idle");
  });

  it("hides an archived worktree optimistically while the archive RPC is in flight", async () => {
    const deferred = createDeferred<Record<string, never>>();
    const client = {
      archiveThothWorktree: vi.fn(() => deferred.promise),
    };
    const featureWorkspace = workspace({
      id: workspaceId,
      name: "feature",
      workspaceDirectory: cwd,
    });
    setRuntimeClient(client);
    setTestProjection(serverId, {
      workspaces: new Map([[workspaceId, featureWorkspace]]),
    });
    appQueryClient.setQueryData(
      ["sidebarThothWorktreeList", serverId, "/tmp"],
      [{ worktreePath: cwd }, { worktreePath: "/tmp/other" }],
    );

    const archive = useCheckoutGitActionsStore
      .getState()
      .archiveWorktree({ serverId, cwd, worktreePath: cwd, workspaceId });

    expect(appProjectionRuntime.store.getSnapshot(serverId).workspaces.get(workspaceId)).toBe(
      featureWorkspace,
    );
    expect(appQueryClient.getQueryData(["sidebarThothWorktreeList", serverId, "/tmp"])).toEqual([
      { worktreePath: "/tmp/other" },
    ]);
    expect(isLocalWorktreeArchivePending({ serverId, cwd })).toBe(true);

    deferred.resolve({});
    await archive;

    expect(
      isWorkspaceArchivePending({
        queryClient: appQueryClient,
        serverId,
        workspaceId,
      }),
    ).toBe(true);
    expect(
      isWorkspaceArchivePending({
        queryClient: appQueryClient,
        serverId,
        workspaceId: cwd,
      }),
    ).toBe(false);
  });

  it("archives on the server even when its workspace cannot be resolved", async () => {
    const client = {
      archiveThothWorktree: vi.fn(async () => ({})),
    };
    setRuntimeClient(client);

    await useCheckoutGitActionsStore
      .getState()
      .archiveWorktree({ serverId, cwd, worktreePath: cwd });

    // The server archive is keyed by worktreePath and must run regardless.
    expect(client.archiveThothWorktree).toHaveBeenCalledWith({ worktreePath: cwd });
    // The optimistic client-side mark is never keyed by the path.
    expect(
      isWorkspaceArchivePending({ queryClient: appQueryClient, serverId, workspaceId: cwd }),
    ).toBe(false);
  });

  it("restores an optimistically hidden worktree when archive fails", async () => {
    const client = {
      archiveThothWorktree: vi.fn(async () => ({ error: { message: "archive failed" } })),
    };
    const featureWorkspace = workspace({
      id: workspaceId,
      name: "feature",
      workspaceDirectory: cwd,
    });
    const listSnapshot = [{ worktreePath: cwd }, { worktreePath: "/tmp/other" }];
    setRuntimeClient(client);
    setTestProjection(serverId, {
      workspaces: new Map([[workspaceId, featureWorkspace]]),
    });
    appQueryClient.setQueryData(["sidebarThothWorktreeList", serverId, "/tmp"], listSnapshot);

    await expect(
      useCheckoutGitActionsStore
        .getState()
        .archiveWorktree({ serverId, cwd, worktreePath: cwd, workspaceId }),
    ).rejects.toThrow("archive failed");

    expect(appProjectionRuntime.store.getSnapshot(serverId).workspaces.get(workspaceId)).toEqual(
      featureWorkspace,
    );
    expect(appQueryClient.getQueryData(["sidebarThothWorktreeList", serverId, "/tmp"])).toEqual(
      listSnapshot,
    );
  });

  it("reports local archive pending only while the archive action is in flight", async () => {
    const deferred = createDeferred<Record<string, never>>();
    const client = {
      archiveThothWorktree: vi.fn(() => deferred.promise),
    };
    const featureWorkspace = workspace({
      id: workspaceId,
      name: "feature",
      workspaceDirectory: cwd,
    });
    setRuntimeClient(client);
    setTestProjection(serverId, {
      workspaces: new Map([[workspaceId, featureWorkspace]]),
    });

    const archive = useCheckoutGitActionsStore
      .getState()
      .archiveWorktree({ serverId, cwd, worktreePath: cwd });

    expect(isLocalWorktreeArchivePending({ serverId, cwd })).toBe(true);

    deferred.resolve({});
    await archive;

    expect(isLocalWorktreeArchivePending({ serverId, cwd })).toBe(false);
  });
});
