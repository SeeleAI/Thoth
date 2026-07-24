import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { HostServerInfo } from "@/runtime/host-runtime";

const refreshAgent = vi.fn<(agentId: string) => Promise<unknown>>();
let connected = true;
let serverInfo: HostServerInfo;

vi.mock("expo-router", () => ({
  router: { navigate: vi.fn() },
}));

vi.mock("@/utils/workspace-navigation", () => ({
  navigateToPreparedWorkspaceTab: vi.fn(() => ""),
}));

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getSnapshot: () => ({ client: { refreshAgent }, serverInfo }) as unknown as HostRuntimeSnapshot,
  }),
  isHostRuntimeConnected: () => connected,
}));

import type { Agent, WorkspaceDescriptor } from "@/projection/authority-model";
import { appProjectionRuntime } from "@/projection/projection-context";
import { queryClient } from "@/query/query-client";
import { readWorkspaceRestoreStatus } from "@/query/workspace-restore-state";
import {
  clearTestProjections,
  patchTestProjection,
  setTestProjection,
} from "@/test-utils/authority-projection";
import { navigateToAgent } from "./index";

const SERVER_ID = "server-1";
const AGENT_ID = "agent-1";
const WORKSPACE_ID = "workspace-1";

function status(): "restoring" | "failed" | "needs-host-upgrade" | null {
  return readWorkspaceRestoreStatus(queryClient, SERVER_ID, WORKSPACE_ID);
}

function seedArchivedAgent(options?: { worktreeRestore?: boolean }): void {
  serverInfo = {
    serverId: SERVER_ID,
    hostname: "host",
    version: "0.1.98",
    features: { worktreeRestore: options?.worktreeRestore ?? true },
  } as HostServerInfo;
  setTestProjection(SERVER_ID, {
    agents: new Map([
      [
        AGENT_ID,
        {
          id: AGENT_ID,
          workspaceId: WORKSPACE_ID,
          archivedAt: new Date(),
        } as Agent,
      ],
    ]),
  });
}

describe("restoreArchivedWorkspace via navigateToAgent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshAgent.mockReset();
    connected = true;
    queryClient.clear();
    seedArchivedAgent();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    clearTestProjections();
    queryClient.clear();
  });

  function trigger(): void {
    navigateToAgent({ serverId: SERVER_ID, agentId: AGENT_ID });
  }

  it("calls refreshAgent once and marks the workspace restoring", () => {
    refreshAgent.mockImplementation(() => new Promise(() => {}));

    trigger();

    expect(refreshAgent).toHaveBeenCalledTimes(1);
    expect(refreshAgent).toHaveBeenCalledWith(AGENT_ID);
    expect(status()).toBe("restoring");
  });

  it("does not re-fire while a restore for the same workspace is in flight", () => {
    refreshAgent.mockImplementation(() => new Promise(() => {}));

    trigger();
    trigger();
    trigger();

    expect(refreshAgent).toHaveBeenCalledTimes(1);
  });

  it("does not fire for a non-archived agent", () => {
    patchTestProjection(SERVER_ID, {
      agents: new Map([
        [
          AGENT_ID,
          {
            id: AGENT_ID,
            workspaceId: WORKSPACE_ID,
            archivedAt: undefined,
          } as Agent,
        ],
      ]),
    });
    refreshAgent.mockImplementation(() => new Promise(() => {}));

    trigger();

    expect(refreshAgent).not.toHaveBeenCalled();
    expect(status()).toBeNull();
  });

  it("does not fire while disconnected", () => {
    connected = false;
    refreshAgent.mockImplementation(() => new Promise(() => {}));

    trigger();

    expect(refreshAgent).not.toHaveBeenCalled();
    expect(status()).toBeNull();
  });

  it("flips to failed when refreshAgent rejects", async () => {
    refreshAgent.mockImplementation(() => Promise.reject(new Error("dir gone")));

    trigger();
    expect(status()).toBe("restoring");

    await vi.runAllTicks();
    await Promise.resolve();

    expect(status()).toBe("failed");
  });

  it("flips to failed via the timeout when refreshAgent resolves without a workspace update", async () => {
    refreshAgent.mockImplementation(() => Promise.resolve({}));

    trigger();
    await Promise.resolve();
    expect(status()).toBe("restoring");

    await vi.advanceTimersByTimeAsync(30000);
    expect(status()).toBe("failed");
  });

  it("marks the workspace needs-host-upgrade without refreshing when the daemon lacks worktreeRestore", () => {
    seedArchivedAgent({ worktreeRestore: false });
    refreshAgent.mockImplementation(() => new Promise(() => {}));

    trigger();

    expect(refreshAgent).not.toHaveBeenCalled();
    expect(status()).toBe("needs-host-upgrade");
  });

  it("is a no-op when the workspace descriptor is already present", () => {
    refreshAgent.mockImplementation(() => new Promise(() => {}));
    patchTestProjection(SERVER_ID, {
      workspaces: new Map<string, WorkspaceDescriptor>([
        [
          WORKSPACE_ID,
          {
            id: WORKSPACE_ID,
            projectId: "project-1",
            projectDisplayName: "Project 1",
            projectRootPath: "/repo",
            workspaceDirectory: "/repo",
            projectKind: "git",
            workspaceKind: "local_checkout",
            name: "main",
            status: "done",
            statusEnteredAt: null,
            archivingAt: null,
            diffStat: null,
            scripts: [],
          },
        ],
      ]),
    });

    trigger();

    expect(refreshAgent).not.toHaveBeenCalled();
  });
});
