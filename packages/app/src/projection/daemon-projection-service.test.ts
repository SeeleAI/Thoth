import { QueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@thoth/client";
import type { AgentSnapshotPayload, WorkspaceDescriptorPayload } from "@thoth/protocol/messages";
import { describe, expect, it, vi } from "vitest";
import { AuthorityProjectionStore, DaemonProjectionService } from "./authority-projection";
import {
  isWorkspaceArchivePending,
  markWorkspaceArchivePending,
} from "@/query/workspace-archive-state";
import {
  readWorkspaceRestoreStatus,
  setWorkspaceRestoreStatus,
} from "@/query/workspace-restore-state";

const SERVER_ID = "projection-service";

function agentSnapshot(patch: Partial<AgentSnapshotPayload> = {}): AgentSnapshotPayload {
  return {
    id: "agent-1",
    provider: "codex",
    cwd: "/repo",
    model: null,
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
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
    title: "Agent",
    labels: {},
    ...patch,
  };
}

function workspacePayload(
  patch: Partial<WorkspaceDescriptorPayload> = {},
): WorkspaceDescriptorPayload {
  return {
    id: "workspace-1",
    projectId: "project-1",
    projectDisplayName: "Project",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    projectKind: "git",
    workspaceKind: "checkout",
    name: "main",
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    activityAt: null,
    diffStat: null,
    scripts: [],
    ...patch,
  };
}

function transport() {
  const listeners = new Map<string, (message: unknown) => void>();
  const client = {
    on: vi.fn((type: string, listener: (message: unknown) => void) => {
      listeners.set(type, listener);
      return () => listeners.delete(type);
    }),
    subscribeAgentThothStateUpdates: vi.fn(() => () => {}),
    getLastServerInfoMessage: vi.fn(() => null),
  } as unknown as DaemonClient;
  return {
    client,
    emit(type: string, message: unknown) {
      listeners.get(type)?.(message);
    },
  };
}

function start(input?: { queryClient?: QueryClient }) {
  const store = new AuthorityProjectionStore();
  const queryClient = input?.queryClient ?? new QueryClient();
  const wire = transport();
  const service = new DaemonProjectionService(store, queryClient);
  service.start(wire.client, SERVER_ID);
  return { store, queryClient, service, wire };
}

describe("DaemonProjectionService events", () => {
  it("refreshes Agent and Workspace authority concurrently", async () => {
    type AgentPage = Awaited<ReturnType<DaemonClient["fetchAgents"]>>;
    type WorkspacePage = Awaited<ReturnType<DaemonClient["fetchWorkspaces"]>>;
    let resolveAgents!: (page: AgentPage) => void;
    const agents = new Promise<AgentPage>((resolve) => {
      resolveAgents = resolve;
    });
    const wire = transport();
    const fetchAgents = vi.fn(() => agents);
    const fetchWorkspaces = vi.fn(
      async () =>
        ({
          requestId: "workspaces-concurrent",
          entries: [],
          emptyProjects: [],
          workspaceRedirects: [],
          dedupeNotice: null,
          pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
        }) satisfies WorkspacePage,
    );
    Object.assign(wire.client, { fetchAgents, fetchWorkspaces });
    const service = new DaemonProjectionService(new AuthorityProjectionStore());
    service.start(wire.client, SERVER_ID);

    const revalidation = service.revalidate();

    expect(fetchAgents).toHaveBeenCalledOnce();
    expect(fetchWorkspaces).toHaveBeenCalledOnce();
    resolveAgents({
      entries: [],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
      requestId: "agents-concurrent",
    } as AgentPage);
    await revalidation;
  });

  it("correlates permission request and resolution through the normalized Agent", () => {
    const { store, service, wire } = start();
    service.acceptAgentSnapshot(agentSnapshot());
    wire.emit("agent_permission_request", {
      type: "agent_permission_request",
      payload: {
        agentId: "agent-1",
        request: {
          id: "",
          provider: "codex",
          name: "shell",
          kind: "tool",
          metadata: { id: "permission-1" },
        },
      },
    });
    expect(store.getSnapshot(SERVER_ID).agents.get("agent-1")?.pendingPermissions).toHaveLength(1);

    wire.emit("agent_permission_resolved", {
      type: "agent_permission_resolved",
      payload: {
        agentId: "agent-1",
        requestId: "permission-1",
        resolution: { behavior: "allow" },
      },
    });
    expect(store.getSnapshot(SERVER_ID).agents.get("agent-1")?.pendingPermissions).toEqual([]);
  });

  it("applies archived then deleted Agent authority events", () => {
    const { store, service, wire } = start();
    service.acceptAgentSnapshot(agentSnapshot());
    wire.emit("agent_archived", {
      type: "agent_archived",
      payload: { agentId: "agent-1", archivedAt: "2026-07-24T01:00:00.000Z" },
    });
    expect(store.getSnapshot(SERVER_ID).agents.get("agent-1")?.archivedAt).toEqual(
      new Date("2026-07-24T01:00:00.000Z"),
    );

    wire.emit("agent_deleted", {
      type: "agent_deleted",
      payload: { agentId: "agent-1" },
    });
    expect(store.getSnapshot(SERVER_ID).agents.has("agent-1")).toBe(false);
  });

  it("excludes internal Loop Agents from the user projection", () => {
    const { store, service, wire } = start();
    service.acceptAgentSnapshot(agentSnapshot());
    wire.emit("agent_update", {
      type: "agent_update",
      payload: {
        kind: "upsert",
        agent: agentSnapshot({ internal: true, labels: { surface: "thoth-loop" } }),
        project: null,
      },
    });
    expect(store.getSnapshot(SERVER_ID).agents.has("agent-1")).toBe(false);
  });

  it("suppresses a stale Workspace upsert until the canonical remove event", () => {
    const queryClient = new QueryClient();
    const { store, wire } = start({ queryClient });
    markWorkspaceArchivePending({
      queryClient,
      serverId: SERVER_ID,
      workspaceId: "workspace-1",
    });
    wire.emit("workspace_update", {
      type: "workspace_update",
      payload: { kind: "upsert", workspace: workspacePayload() },
    });
    expect(store.getSnapshot(SERVER_ID).workspaces.has("workspace-1")).toBe(false);

    wire.emit("workspace_update", {
      type: "workspace_update",
      payload: { kind: "remove", id: "workspace-1" },
    });
    expect(
      isWorkspaceArchivePending({
        queryClient,
        serverId: SERVER_ID,
        workspaceId: "workspace-1",
      }),
    ).toBe(false);
  });

  it("clears restore pending only when the canonical Workspace lands", () => {
    const queryClient = new QueryClient();
    const { store, service } = start({ queryClient });
    setWorkspaceRestoreStatus(queryClient, SERVER_ID, "workspace-1", "restoring");

    const workspace = service.acceptWorkspaceSnapshot(workspacePayload());

    expect(store.getSnapshot(SERVER_ID).workspaces.get(workspace.id)).toBe(workspace);
    expect(readWorkspaceRestoreStatus(queryClient, SERVER_ID, workspace.id)).toBeNull();
    expect(store.getSnapshot(SERVER_ID).hydration.workspaces).toBe("ready");
  });

  it("keeps a newer Agent snapshot when an older event arrives", () => {
    const { store, service, wire } = start();
    const newer = agentSnapshot({
      title: "newer",
      updatedAt: "2026-07-24T02:00:00.000Z",
    });
    service.acceptAgentSnapshot(newer);
    const before = store.getSnapshot(SERVER_ID).agents.get("agent-1");
    wire.emit("agent_update", {
      type: "agent_update",
      payload: {
        kind: "upsert",
        agent: agentSnapshot({
          title: "older",
          updatedAt: "2026-07-24T01:00:00.000Z",
        }),
        project: null,
      },
    });
    expect(store.getSnapshot(SERVER_ID).agents.get("agent-1")?.title).toBe("newer");
    expect(store.getSnapshot(SERVER_ID).agents.get("agent-1")).toBe(before);
  });
});
