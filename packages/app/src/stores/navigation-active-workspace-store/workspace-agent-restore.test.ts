import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import type { DaemonClient, FetchAgentHistoryEntry } from "@thoth/client/internal/daemon-client";
import type { AgentSnapshotPayload } from "@thoth/protocol/messages";
import type { WorkspaceDescriptor } from "@/projection/authority-model";
import { appProjectionRuntime } from "@/projection/projection-context";
import { clearTestProjections, setTestProjection } from "@/test-utils/authority-projection";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  resetWorkspaceAgentHistoryRestoreForTests,
  restoreWorkspaceAgentTabFromHistory,
} from "./workspace-agent-restore";

const SERVER_ID = "server-restore";
const WORKSPACE_ID = "workspace-history";
const WORKSPACE_KEY = buildWorkspaceTabPersistenceKey({
  serverId: SERVER_ID,
  workspaceId: WORKSPACE_ID,
})!;

function createWorkspace(input: Partial<WorkspaceDescriptor> = {}): WorkspaceDescriptor {
  return {
    id: WORKSPACE_ID,
    projectId: "/repo",
    projectDisplayName: "repo",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    projectKind: "git",
    workspaceKind: "checkout",
    name: "History Workspace",
    title: null,
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    ...input,
  };
}

function createAgentPayload(input: {
  id: string;
  updatedAt: string;
  workspaceId?: string;
  title?: string | null;
  archivedAt?: string | null;
}): AgentSnapshotPayload {
  return {
    id: input.id,
    provider: "codex",
    cwd: "/repo",
    workspaceId: input.workspaceId ?? WORKSPACE_ID,
    model: null,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: input.updatedAt,
    lastUserMessageAt: null,
    status: "idle",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    pendingProviderQuestions: [],
    persistence: null,
    title: input.title ?? null,
    labels: {},
    archivedAt: input.archivedAt ?? null,
  };
}

function createHistoryEntry(agent: AgentSnapshotPayload): FetchAgentHistoryEntry {
  return {
    agent,
    project: {
      projectKey: "/repo",
      projectName: "repo",
      checkout: {
        cwd: "/repo",
        isGit: true,
        currentBranch: "main",
        remoteUrl: null,
        worktreeRoot: "/repo",
        isThothOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  };
}

function createClient(entries: FetchAgentHistoryEntry[]): Pick<DaemonClient, "fetchAgentHistory"> {
  return {
    fetchAgentHistory: vi.fn(async () => ({
      requestId: "history-request",
      entries,
      pageInfo: {
        nextCursor: null,
        prevCursor: null,
        hasMore: false,
      },
    })),
  };
}

beforeEach(() => {
  resetWorkspaceAgentHistoryRestoreForTests();
  appProjectionRuntime.attach(
    {
      on: () => () => {},
      subscribeAgentThothStateUpdates: () => () => {},
      getLastServerInfoMessage: () => null,
    } as unknown as DaemonClient,
    SERVER_ID,
  );
  setTestProjection(SERVER_ID, {
    workspaces: new Map([[WORKSPACE_ID, createWorkspace()]]),
  });
});

afterEach(() => {
  resetWorkspaceAgentHistoryRestoreForTests();
  clearTestProjections();
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    splitSizesByWorkspace: {},
    pinnedAgentIdsByWorkspace: {},
    hiddenAgentIdsByWorkspace: {},
    restoredAgentIdsByWorkspace: {},
  });
  vi.clearAllMocks();
});

describe("restoreWorkspaceAgentTabFromHistory", () => {
  it("opens the newest historical agent tab for an original workspace session", async () => {
    const older = createHistoryEntry(
      createAgentPayload({
        id: "agent-old",
        updatedAt: "2026-07-09T00:01:00.000Z",
      }),
    );
    const newer = createHistoryEntry(
      createAgentPayload({
        id: "agent-new",
        updatedAt: "2026-07-09T00:02:00.000Z",
        title: "Restored history",
      }),
    );
    const client = createClient([older, newer]);

    await expect(
      restoreWorkspaceAgentTabFromHistory({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        client,
      }),
    ).resolves.toBe(true);

    expect(client.fetchAgentHistory).toHaveBeenCalledTimes(1);
    expect(appProjectionRuntime.store.getSnapshot(SERVER_ID).agents.get("agent-new")?.title).toBe(
      "Restored history",
    );
    expect(
      useWorkspaceLayoutStore
        .getState()
        .getWorkspaceTabs(WORKSPACE_KEY)
        .map((tab) => tab.target),
    ).toContainEqual({ kind: "agent", agentId: "agent-new" });
    expect(
      Array.from(
        useWorkspaceLayoutStore.getState().restoredAgentIdsByWorkspace[WORKSPACE_KEY] ?? [],
      ),
    ).toEqual(["agent-new"]);
  });

  it("does not open a tab when history has no agent for the workspace", async () => {
    const client = createClient([
      createHistoryEntry(
        createAgentPayload({
          id: "agent-other",
          workspaceId: "workspace-other",
          updatedAt: "2026-07-09T00:02:00.000Z",
        }),
      ),
    ]);

    await expect(
      restoreWorkspaceAgentTabFromHistory({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        client,
      }),
    ).resolves.toBe(false);

    expect(useWorkspaceLayoutStore.getState().getWorkspaceTabs(WORKSPACE_KEY)).toEqual([]);
  });

  it("never restores an archived history entry into a workspace tab", async () => {
    const archived = createHistoryEntry(
      createAgentPayload({
        id: "agent-archived",
        updatedAt: "2026-07-09T00:02:00.000Z",
        title: "Archived weather question",
        archivedAt: "2026-07-09T00:10:00.000Z",
      }),
    );
    const client = createClient([archived]);

    await expect(
      restoreWorkspaceAgentTabFromHistory({
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        client,
      }),
    ).resolves.toBe(false);

    expect(useWorkspaceLayoutStore.getState().getWorkspaceTabs(WORKSPACE_KEY)).toEqual([]);
    expect(
      appProjectionRuntime.store.getSnapshot(SERVER_ID).agents.get("agent-archived")?.archivedAt,
    ).toBeInstanceOf(Date);
  });
});
