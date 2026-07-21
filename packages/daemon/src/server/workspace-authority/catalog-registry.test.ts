import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CatalogProjectRegistry,
  CatalogWorkspaceRegistry,
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "../workspace-registry.js";
import { WorkspaceCatalogStore } from "./catalog-store.js";

const temporaryHomes: string[] = [];

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("catalog-backed Project and Workspace registries", () => {
  it("persists registry truth in catalog.sqlite without JSON projections", async () => {
    const home = mkdtempSync(join(tmpdir(), "thoth-catalog-registry-"));
    temporaryHomes.push(home);
    const catalog = new WorkspaceCatalogStore(home);
    const projects = new CatalogProjectRegistry(catalog);
    const workspaces = new CatalogWorkspaceRegistry(catalog);
    const createdAt = "2026-07-21T00:00:00.000Z";

    await projects.upsert(
      createPersistedProjectRecord({
        projectId: "project-1",
        rootPath: "/workspace/project",
        kind: "git",
        displayName: "Project",
        customName: "Thoth Project",
        createdAt,
        updatedAt: createdAt,
      }),
    );
    await workspaces.upsert(
      createPersistedWorkspaceRecord({
        workspaceId: "workspace-1",
        projectId: "project-1",
        cwd: "/workspace/project",
        kind: "local_checkout",
        displayName: "main",
        title: "MVP",
        branch: null,
        baseBranch: null,
        createdAt,
        updatedAt: createdAt,
      }),
    );

    expect(await projects.existsOnDisk()).toBe(true);
    expect(await workspaces.existsOnDisk()).toBe(true);
    expect(await projects.get("project-1")).toMatchObject({ customName: "Thoth Project" });
    expect(await workspaces.get("workspace-1")).toMatchObject({ title: "MVP" });
    expect(catalog.getWorkspace("workspace-1")).toMatchObject({
      id: "workspace-1",
      canonicalPath: "/workspace/project",
    });

    await workspaces.archive("workspace-1", "2026-07-21T01:00:00.000Z");
    expect((await workspaces.get("workspace-1"))?.archivedAt).toBe("2026-07-21T01:00:00.000Z");
    catalog.close();
  });
});
