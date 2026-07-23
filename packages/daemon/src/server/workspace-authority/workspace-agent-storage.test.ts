import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CatalogProjectRegistry,
  CatalogWorkspaceRegistry,
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "../workspace-registry.js";
import { WorkspaceAuthorityManager } from "./workspace-authority-manager.js";
import { WorkspaceAgentStorage } from "./workspace-agent-storage.js";
import { WorkspaceAgentTimelineStore } from "./workspace-agent-timeline-store.js";

const temporaryHomes: string[] = [];

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("Workspace Agent persistence", () => {
  it("stores Agent records and timelines only in the owning authority shard", async () => {
    const home = mkdtempSync(join(tmpdir(), "thoth-workspace-agents-"));
    temporaryHomes.push(home);
    const authority = new WorkspaceAuthorityManager(home);
    const projects = new CatalogProjectRegistry(authority.catalog);
    const workspaces = new CatalogWorkspaceRegistry(authority.catalog);
    const createdAt = "2026-07-21T00:00:00.000Z";
    await projects.upsert(
      createPersistedProjectRecord({
        projectId: "project-1",
        rootPath: "/workspace/project",
        kind: "git",
        displayName: "Project",
        createdAt,
        updatedAt: createdAt,
      }),
    );
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: "workspace-1",
      projectId: "project-1",
      cwd: "/workspace/project",
      kind: "local_checkout",
      displayName: "main",
      createdAt,
      updatedAt: createdAt,
    });
    await workspaces.upsert(workspace);
    authority.registerWorkspace(workspace);

    const agents = new WorkspaceAgentStorage(authority);
    const timeline = new WorkspaceAgentTimelineStore(authority);
    await agents.upsert({
      id: "agent-1",
      provider: "future-acp",
      cwd: workspace.cwd,
      workspaceId: workspace.workspaceId,
      createdAt,
      updatedAt: createdAt,
      labels: {},
      lastStatus: "idle",
      config: { model: "provider-model" },
      persistence: {
        provider: "future-acp",
        sessionId: "native-session-1",
        nativeHandle: "native-thread-1",
      },
    });
    timeline.bindAgentWorkspace("agent-1", workspace.workspaceId);
    const rows = [
      {
        seq: 1,
        timestamp: createdAt,
        item: { type: "assistant_message" as const, text: "ready" },
      },
      {
        seq: 2,
        timestamp: createdAt,
        item: { type: "assistant_message" as const, text: "x".repeat(20_000) },
      },
    ];
    const authorityStore = authority.forWorkspace(workspace.workspaceId);
    const revisionBeforeTimeline = authorityStore.readSnapshot(workspace.workspaceId).revision;
    await timeline.bulkInsert("agent-1", rows);
    const revisionAfterTimeline = authorityStore.readSnapshot(workspace.workspaceId).revision;
    expect(revisionAfterTimeline).toBe(revisionBeforeTimeline + 1);
    await timeline.bulkInsert("agent-1", rows);
    expect(authorityStore.readSnapshot(workspace.workspaceId).revision).toBe(revisionAfterTimeline);

    expect(await agents.get("agent-1")).toMatchObject({
      provider: "future-acp",
      workspaceId: "workspace-1",
      persistence: { nativeHandle: "native-thread-1" },
    });
    expect(await timeline.getLatestCommittedSeq("agent-1")).toBe(2);
    expect((await timeline.getCommittedRows("agent-1"))[1]?.item).toMatchObject({
      type: "assistant_message",
    });
    expect(existsSync(join(home, "agents"))).toBe(false);
    expect(existsSync(join(home, "agent-timeline"))).toBe(false);
    expect(existsSync(join(home, "projects"))).toBe(false);

    const database = new DatabaseSync(
      join(home, "workspaces", workspace.workspaceId, "authority.sqlite"),
      { readOnly: true },
    );
    const largeRow = database
      .prepare("SELECT item_json, item_digest FROM agent_timeline_rows WHERE seq = 2")
      .get() as { item_json: string | null; item_digest: string | null };
    expect(largeRow.item_json).toBeNull();
    expect(largeRow.item_digest).toMatch(/^[a-f0-9]{64}$/u);
    database.close();
    authority.close();
  });
});
