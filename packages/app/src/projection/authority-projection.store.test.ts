import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDescriptorPayload } from "@thoth/protocol/messages";
import type { AgentThothState } from "@thoth/protocol/thoth/rpc-schemas";
import { AuthorityProjectionStore, type TimelineProjection } from "./authority-projection";
import {
  normalizeWorkspaceDescriptor,
  type Agent,
  type EmptyProjectDescriptor,
  type WorkspaceDescriptor,
} from "./authority-model";
import { createTestProjection } from "@/test-utils/authority-projection";

const SERVER_ID = "projection-store";

function payload(patch: Partial<WorkspaceDescriptorPayload> = {}): WorkspaceDescriptorPayload {
  return {
    id: "workspace-1",
    projectId: "project-1",
    projectDisplayName: "Project 1",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo/main",
    projectKind: "git",
    workspaceKind: "checkout",
    name: "main",
    archivingAt: null,
    status: "done",
    statusEnteredAt: null,
    activityAt: null,
    diffStat: null,
    scripts: [],
    ...patch,
  };
}

function workspace(patch: Partial<WorkspaceDescriptor> = {}): WorkspaceDescriptor {
  return normalizeWorkspaceDescriptor(payload(patch as Partial<WorkspaceDescriptorPayload>));
}

function agent(patch: Partial<Agent> = {}): Agent {
  const timestamp = new Date("2026-07-24T00:00:00.000Z");
  return {
    serverId: SERVER_ID,
    id: "agent-1",
    provider: "codex",
    status: "idle",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUserMessageAt: null,
    lastActivityAt: timestamp,
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
    persistence: null,
    title: "Agent",
    cwd: "/repo",
    model: null,
    parentAgentId: null,
    labels: {},
    archivedAt: null,
    ...patch,
  };
}

describe("normalizeWorkspaceDescriptor", () => {
  it("clones script payloads", () => {
    const scripts = [
      {
        scriptName: "web",
        type: "service" as const,
        hostname: "web.thoth.localhost",
        port: 3000,
        proxyUrl: null,
        lifecycle: "running" as const,
        health: "healthy" as const,
        exitCode: null,
        terminalId: null,
      },
    ];
    const result = normalizeWorkspaceDescriptor(payload({ scripts }));
    expect(result.scripts).toEqual(scripts);
    expect(result.scripts).not.toBe(scripts);
  });

  it("canonicalizes a trailing workspace separator", () => {
    expect(
      normalizeWorkspaceDescriptor(payload({ workspaceDirectory: "/repo/main/" }))
        .workspaceDirectory,
    ).toBe("/repo/main");
  });

  it("normalizes a blank workspace directory to empty", () => {
    expect(
      normalizeWorkspaceDescriptor(payload({ workspaceDirectory: "   " })).workspaceDirectory,
    ).toBe("");
  });

  it("defaults omitted scripts and archive timestamp", () => {
    const result = normalizeWorkspaceDescriptor({
      ...payload(),
      scripts: undefined,
      archivingAt: undefined,
    } as unknown as WorkspaceDescriptorPayload);
    expect(result.scripts).toEqual([]);
    expect(result.archivingAt).toBeNull();
  });

  it("parses statusEnteredAt and preserves null", () => {
    expect(
      normalizeWorkspaceDescriptor(payload({ statusEnteredAt: "2026-05-12T09:30:00.000Z" }))
        .statusEnteredAt,
    ).toEqual(new Date("2026-05-12T09:30:00.000Z"));
    expect(
      normalizeWorkspaceDescriptor(payload({ statusEnteredAt: null })).statusEnteredAt,
    ).toBeNull();
  });

  it("preserves protocol-owned project placement", () => {
    const project = {
      projectKey: "remote:github.com/acme/app",
      projectName: "acme/app",
      checkout: {
        cwd: "/repo/app",
        isGit: true as const,
        currentBranch: "main",
        remoteUrl: "https://github.com/acme/app.git",
        worktreeRoot: "/repo/app",
        isThothOwnedWorktree: false as const,
        mainRepoRoot: null,
      },
    };
    expect(normalizeWorkspaceDescriptor(payload({ project })).project).toBe(project);
  });
});

describe("AuthorityProjectionStore", () => {
  it("publishes a replaced snapshot", () => {
    const store = new AuthorityProjectionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const snapshot = createTestProjection();
    store.replaceSnapshot(SERVER_ID, snapshot);
    expect(store.getSnapshot(SERVER_ID)).toBe(snapshot);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("preserves an equal Agent identity during replacement", () => {
    const store = new AuthorityProjectionStore();
    const first = agent();
    store.replaceSnapshot(
      SERVER_ID,
      createTestProjection({ agents: new Map([[first.id, first]]) }),
    );
    store.applyProjectionDelta(SERVER_ID, {
      type: "agents_replace",
      agents: new Map([[first.id, { ...first, labels: {} }]]),
    });
    expect(store.getSnapshot(SERVER_ID).agents.get(first.id)).toBe(first);
  });

  it("rejects a stale Agent snapshot", () => {
    const store = new AuthorityProjectionStore();
    const current = agent({ updatedAt: new Date("2026-07-24T02:00:00.000Z"), title: "new" });
    store.replaceSnapshot(
      SERVER_ID,
      createTestProjection({ agents: new Map([[current.id, current]]) }),
    );
    store.applyProjectionDelta(SERVER_ID, {
      type: "agent_upsert",
      agent: { ...current, updatedAt: new Date("2026-07-24T01:00:00.000Z"), title: "old" },
    });
    expect(store.getSnapshot(SERVER_ID).agents.get(current.id)).toBe(current);
  });

  it("accepts independent usage from a stale Agent snapshot", () => {
    const store = new AuthorityProjectionStore();
    const current = agent({ updatedAt: new Date("2026-07-24T02:00:00.000Z") });
    store.replaceSnapshot(
      SERVER_ID,
      createTestProjection({ agents: new Map([[current.id, current]]) }),
    );
    store.applyProjectionDelta(SERVER_ID, {
      type: "agent_upsert",
      agent: {
        ...current,
        updatedAt: new Date("2026-07-24T01:00:00.000Z"),
        lastUsage: { inputTokens: 2, outputTokens: 3 },
      },
    });
    expect(store.getSnapshot(SERVER_ID).agents.get(current.id)?.lastUsage).toEqual({
      inputTokens: 2,
      outputTokens: 3,
    });
  });

  it("removes Agent-owned Thoth and Timeline projections together", () => {
    const store = new AuthorityProjectionStore();
    const current = agent();
    const timeline: TimelineProjection = {
      epoch: "epoch-1",
      entries: [],
      startCursor: null,
      endCursor: null,
      hasOlder: false,
      hasNewer: false,
      loadingTail: false,
      loadingOlder: false,
    };
    store.replaceSnapshot(
      SERVER_ID,
      createTestProjection({
        agents: new Map([[current.id, current]]),
        agentThothStates: new Map([[current.id, { agentId: current.id } as AgentThothState]]),
        timelines: new Map([[current.id, timeline]]),
      }),
    );
    store.applyProjectionDelta(SERVER_ID, { type: "agent_remove", agentId: current.id });
    const snapshot = store.getSnapshot(SERVER_ID);
    expect(snapshot.agents.has(current.id)).toBe(false);
    expect(snapshot.agentThothStates.has(current.id)).toBe(false);
    expect(snapshot.timelines.has(current.id)).toBe(false);
  });

  it("deduplicates stale Thoth state revisions", () => {
    const store = new AuthorityProjectionStore();
    const newer = { agentId: "agent-1", revision: 2 } as AgentThothState;
    const older = { agentId: "agent-1", revision: 1 } as AgentThothState;
    store.applyProjectionDelta(SERVER_ID, { type: "agent_thoth_state", state: newer });
    const snapshot = store.getSnapshot(SERVER_ID);
    store.applyProjectionDelta(SERVER_ID, { type: "agent_thoth_state", state: older });
    expect(store.getSnapshot(SERVER_ID)).toBe(snapshot);
    expect(store.getSnapshot(SERVER_ID).agentThothStates.get("agent-1")).toBe(newer);
  });

  it("preserves equal Workspace identities during replacement", () => {
    const store = new AuthorityProjectionStore();
    const current = workspace();
    store.replaceSnapshot(
      SERVER_ID,
      createTestProjection({ workspaces: new Map([[current.id, current]]) }),
    );
    store.applyProjectionDelta(SERVER_ID, {
      type: "workspaces_replace",
      workspaces: new Map([[current.id, { ...current, scripts: [] }]]),
    });
    expect(store.getSnapshot(SERVER_ID).workspaces.get(current.id)).toBe(current);
  });

  it("updates one Workspace without replacing unaffected entries", () => {
    const store = new AuthorityProjectionStore();
    const first = workspace({ id: "first", name: "First" });
    const second = workspace({ id: "second", name: "Second" });
    store.replaceSnapshot(
      SERVER_ID,
      createTestProjection({
        workspaces: new Map([
          [first.id, first],
          [second.id, second],
        ]),
      }),
    );
    store.applyProjectionDelta(SERVER_ID, {
      type: "workspace_upsert",
      workspace: { ...first, status: "running" },
    });
    expect(store.getSnapshot(SERVER_ID).workspaces.get(first.id)).not.toBe(first);
    expect(store.getSnapshot(SERVER_ID).workspaces.get(second.id)).toBe(second);
  });

  it("does not publish when removing a missing Workspace", () => {
    const store = new AuthorityProjectionStore();
    const snapshot = createTestProjection({ workspaces: new Map([["one", workspace()]]) });
    store.replaceSnapshot(SERVER_ID, snapshot);
    store.applyProjectionDelta(SERVER_ID, { type: "workspace_remove", workspaceId: "missing" });
    expect(store.getSnapshot(SERVER_ID)).toBe(snapshot);
  });

  it("removes an empty project by project id", () => {
    const store = new AuthorityProjectionStore();
    const project: EmptyProjectDescriptor = {
      projectId: "empty",
      projectDisplayName: "Empty",
      projectCustomName: null,
      projectRootPath: "/repo/empty",
      projectKind: "git",
    };
    store.replaceSnapshot(
      SERVER_ID,
      createTestProjection({ emptyProjects: new Map([[project.projectId, project]]) }),
    );
    store.applyProjectionDelta(SERVER_ID, {
      type: "empty_project_remove",
      projectId: project.projectId,
    });
    expect(store.getSnapshot(SERVER_ID).emptyProjects.size).toBe(0);
  });

  it("does not publish when removing a missing empty project", () => {
    const store = new AuthorityProjectionStore();
    const snapshot = createTestProjection();
    store.replaceSnapshot(SERVER_ID, snapshot);
    store.applyProjectionDelta(SERVER_ID, {
      type: "empty_project_remove",
      projectId: "missing",
    });
    expect(store.getSnapshot(SERVER_ID)).toBe(snapshot);
  });

  it("does not publish an unchanged hydration status", () => {
    const store = new AuthorityProjectionStore();
    const snapshot = createTestProjection({
      hydration: { agents: "ready", workspaces: "idle" },
    });
    store.replaceSnapshot(SERVER_ID, snapshot);
    store.applyProjectionDelta(SERVER_ID, {
      type: "hydration",
      target: "agents",
      status: "ready",
    });
    expect(store.getSnapshot(SERVER_ID)).toBe(snapshot);
  });

  it("resets every stale Timeline to the requested epoch", () => {
    const store = new AuthorityProjectionStore();
    const timeline: TimelineProjection = {
      epoch: "old",
      entries: [],
      startCursor: { epoch: "old", seq: 1 },
      endCursor: { epoch: "old", seq: 2 },
      hasOlder: true,
      hasNewer: true,
      loadingTail: true,
      loadingOlder: true,
    };
    store.replaceSnapshot(
      SERVER_ID,
      createTestProjection({ timelines: new Map([["agent-1", timeline]]) }),
    );
    store.resetEpoch(SERVER_ID, "new");
    expect(store.getSnapshot(SERVER_ID).timelines.get("agent-1")).toEqual({
      epoch: "new",
      entries: [],
      startCursor: null,
      endCursor: null,
      hasOlder: false,
      hasNewer: false,
      loadingTail: false,
      loadingOlder: false,
    });
  });
});
