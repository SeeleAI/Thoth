import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { seedConfirmedIntentContract } from "../test-utils/authority-fixtures.js";
import { WorkspaceAuthorityManager } from "./workspace-authority-manager.js";

const roots: string[] = [];

function createManager(): WorkspaceAuthorityManager {
  const root = mkdtempSync(path.join(tmpdir(), "thoth-coordination-"));
  roots.push(root);
  const manager = new WorkspaceAuthorityManager(root);
  for (const id of ["workspace-a", "workspace-b"]) {
    manager.catalog.upsertWorkspace({
      id,
      canonicalPath: path.join(root, id),
      displayName: id,
      kind: "workspace",
      parentWorkspaceId: null,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }
  return manager;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("WorkspaceCoordinationRepository", () => {
  it("isolates same-named chat rooms between Workspace shards", () => {
    const manager = createManager();
    const first = manager.forWorkspace("workspace-a").coordination;
    const second = manager.forWorkspace("workspace-b").coordination;

    const roomA = first.createChatRoom({ name: "status" });
    const roomB = second.createChatRoom({ name: "status" });
    first.postChatMessage({
      room: roomA.id,
      authorAgentId: "agent-a",
      body: "workspace A",
      mentionAgentIds: [],
    });
    second.postChatMessage({
      room: roomB.id,
      authorAgentId: "agent-b",
      body: "workspace B",
      mentionAgentIds: [],
    });

    expect(first.readChatMessages({ room: "status", limit: 0 }).map((row) => row.body)).toEqual([
      "workspace A",
    ]);
    expect(second.readChatMessages({ room: "status", limit: 0 }).map((row) => row.body)).toEqual([
      "workspace B",
    ]);
    manager.close();
  });

  it("persists schedules only in the owning Workspace authority", () => {
    const manager = createManager();
    const firstAuthority = manager.forWorkspace("workspace-a");
    const contract = seedConfirmedIntentContract({
      store: firstAuthority,
      workspaceId: "workspace-a",
      agentId: "agent-schedule-owner",
    });
    const first = firstAuthority.coordination;
    const second = manager.forWorkspace("workspace-b").coordination;
    const created = first.createSchedule({
      name: "Workspace A schedule",
      prompt: "inspect",
      cadence: { type: "every", everyMs: 60_000 },
      target: { type: "new-agent", config: { provider: "codex" } },
      intentContractId: contract.id,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: "2026-01-01T00:01:00.000Z",
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [],
    });

    expect(first.getSchedule(created.id)?.name).toBe("Workspace A schedule");
    expect(second.getSchedule(created.id)).toBeNull();
    manager.close();
  });

  it("keeps coordination tables out of catalog.sqlite", () => {
    const manager = createManager();
    manager.forWorkspace("workspace-a");
    manager.close();
    const catalog = new DatabaseSync(path.join(roots[0]!, "catalog.sqlite"), { readOnly: true });
    const tables = catalog
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String((row as { name: unknown }).name));
    catalog.close();
    expect(tables).not.toContain("chat_rooms");
    expect(tables).not.toContain("schedules");
  });
});
