import { describe, expect, it } from "vitest";
import { AuthorityProjectionStore } from "./authority-projection";
import type { EmptyProjectDescriptor, WorkspaceDescriptor } from "./authority-model";
import {
  composeWorkspaceStructure,
  selectHasWorkspaces,
  selectProjectOrder,
  selectRecommendedProjectPaths,
  selectWorkspace,
  selectWorkspaceDirectory,
  selectWorkspaceFields,
  selectWorkspaceKeys,
  selectWorkspaceOrderByScope,
  selectWorkspaceStatusesForBadges,
  selectWorkspaceStructureProjects,
  workspaceEqualityFns,
} from "./workspace-selectors";
import { createTestProjection } from "@/test-utils/authority-projection";

const SERVER_ID = "test-server";

function workspace(input: Partial<WorkspaceDescriptor> & Pick<WorkspaceDescriptor, "id">) {
  return {
    id: input.id,
    projectId: input.projectId ?? "project-1",
    projectDisplayName: input.projectDisplayName ?? "Project 1",
    projectRootPath: input.projectRootPath ?? "/repo",
    workspaceDirectory: input.workspaceDirectory ?? "/repo",
    projectKind: input.projectKind ?? "git",
    workspaceKind: input.workspaceKind ?? "local_checkout",
    name: input.name ?? "main",
    status: input.status ?? "done",
    archivingAt: input.archivingAt ?? null,
    statusEnteredAt: input.statusEnteredAt ?? null,
    diffStat: input.diffStat ?? null,
    scripts: input.scripts ?? [],
  } satisfies WorkspaceDescriptor;
}

function storeWith(
  workspaces: WorkspaceDescriptor[],
  emptyProjects: EmptyProjectDescriptor[] = [],
  serverId = SERVER_ID,
): AuthorityProjectionStore {
  const store = new AuthorityProjectionStore();
  store.replaceSnapshot(
    serverId,
    createTestProjection({
      workspaces: new Map(workspaces.map((entry) => [entry.id, entry])),
      emptyProjects: new Map(emptyProjects.map((entry) => [entry.projectId, entry])),
    }),
  );
  return store;
}

describe("workspace projection selectors", () => {
  it("resolves a descriptor by identity when the map key differs", () => {
    const entry = workspace({ id: "workspace-a" });
    const projection = createTestProjection({ workspaces: new Map([["map-key-a", entry]]) });
    expect(selectWorkspace(projection, entry.id)).toBe(entry);
  });

  it("returns null for a missing workspace", () => {
    expect(selectWorkspace(createTestProjection(), "missing")).toBeNull();
  });

  it("returns the workspace directory instead of the opaque id", () => {
    const entry = workspace({ id: "wks_opaque", workspaceDirectory: "/repo/project" });
    const projection = createTestProjection({ workspaces: new Map([[entry.id, entry]]) });
    expect(selectWorkspaceDirectory(projection, entry.id)).toBe("/repo/project");
  });

  it("projects only requested workspace fields", () => {
    const entry = workspace({ id: "workspace-a", name: "A", status: "running" });
    const projection = createTestProjection({ workspaces: new Map([[entry.id, entry]]) });
    expect(selectWorkspaceFields(projection, entry.id, ({ id, name }) => ({ id, name }))).toEqual({
      id: "workspace-a",
      name: "A",
    });
  });

  it("preserves workspace map iteration order", () => {
    const first = workspace({ id: "first" });
    const second = workspace({ id: "second" });
    const projection = createTestProjection({
      workspaces: new Map([
        [second.id, second],
        [first.id, first],
      ]),
    });
    expect(selectWorkspaceKeys(projection)).toEqual(["second", "first"]);
  });

  it("selects current project root paths", () => {
    const projection = createTestProjection({
      workspaces: new Map([
        ["a", workspace({ id: "a", projectRootPath: "/repo/a" })],
        ["b", workspace({ id: "b", projectRootPath: "/repo/b" })],
      ]),
    });
    expect(selectRecommendedProjectPaths(projection)).toEqual(["/repo/a", "/repo/b"]);
  });

  it("reports whether a projection has workspaces", () => {
    expect(selectHasWorkspaces(createTestProjection())).toBe(false);
    expect(
      selectHasWorkspaces(
        createTestProjection({ workspaces: new Map([["a", workspace({ id: "a" })]]) }),
      ),
    ).toBe(true);
  });

  it("builds project membership from normalized workspaces", () => {
    const store = storeWith([
      workspace({ id: "a", projectId: "project-a" }),
      workspace({ id: "b", projectId: "project-a" }),
    ]);
    expect(selectWorkspaceStructureProjects(store, [SERVER_ID])[0]?.workspaceKeys).toEqual([
      `${SERVER_ID}:a`,
      `${SERVER_ID}:b`,
    ]);
  });

  it("keeps an empty project visible without active workspaces", () => {
    const store = storeWith(
      [],
      [
        {
          projectId: "empty",
          projectDisplayName: "Empty",
          projectCustomName: null,
          projectRootPath: "/repo/empty",
          projectKind: "git",
        },
      ],
    );
    expect(selectWorkspaceStructureProjects(store, [SERVER_ID])).toEqual([
      expect.objectContaining({ projectKey: "empty", projectName: "Empty", workspaceKeys: [] }),
    ]);
  });

  it("collects badge statuses across servers", () => {
    const store = storeWith([workspace({ id: "a", status: "running" })]);
    store.replaceSnapshot(
      "server-2",
      createTestProjection({
        workspaces: new Map([["b", workspace({ id: "b", status: "attention" })]]),
      }),
    );
    expect(selectWorkspaceStatusesForBadges(store)).toEqual(["running", "attention"]);
  });

  it("applies persisted project order", () => {
    const projects = selectWorkspaceStructureProjects(
      storeWith([
        workspace({ id: "a", projectId: "project-a", projectDisplayName: "A" }),
        workspace({ id: "b", projectId: "project-b", projectDisplayName: "B" }),
      ]),
      [SERVER_ID],
    );
    const result = composeWorkspaceStructure({
      projects,
      projectOrder: ["project-b", "project-a"],
      workspaceOrderByScope: {},
    });
    expect(result.projects.map((project) => project.projectKey)).toEqual([
      "project-b",
      "project-a",
    ]);
  });

  it("applies persisted workspace order within a project", () => {
    const projects = selectWorkspaceStructureProjects(
      storeWith([
        workspace({ id: "a", projectId: "project-a" }),
        workspace({ id: "b", projectId: "project-a" }),
      ]),
      [SERVER_ID],
    );
    const result = composeWorkspaceStructure({
      projects,
      projectOrder: [],
      workspaceOrderByScope: { "project-a": [`${SERVER_ID}:b`, `${SERVER_ID}:a`] },
    });
    expect(result.projects[0]?.workspaceKeys).toEqual([`${SERVER_ID}:b`, `${SERVER_ID}:a`]);
  });

  it("ignores duplicate and unknown persisted order keys", () => {
    const projects = selectWorkspaceStructureProjects(
      storeWith([workspace({ id: "a" }), workspace({ id: "b" })]),
      [SERVER_ID],
    );
    const result = composeWorkspaceStructure({
      projects,
      projectOrder: ["missing", "project-1", "project-1"],
      workspaceOrderByScope: {},
    });
    expect(result.projects).toHaveLength(1);
  });

  it("selects sidebar project order without copying it", () => {
    const projectOrder = ["b", "a"];
    expect(selectProjectOrder({ projectOrder, workspaceOrderByProject: {} })).toBe(projectOrder);
  });

  it("selects workspace order by scope without copying it", () => {
    const workspaceOrderByProject = { project: ["b", "a"] };
    expect(selectWorkspaceOrderByScope({ projectOrder: [], workspaceOrderByProject })).toBe(
      workspaceOrderByProject,
    );
  });

  it("provides identity and deep equality policies", () => {
    expect(workspaceEqualityFns.identity({ value: 1 }, { value: 1 })).toBe(false);
    expect(workspaceEqualityFns.deep({ value: 1 }, { value: 1 })).toBe(true);
  });
});
