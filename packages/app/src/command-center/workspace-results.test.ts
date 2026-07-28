import { describe, expect, it } from "vitest";
import {
  joinCommandCenterSubtitleParts,
  projectCommandCenterWorkspaceItems,
  type CommandCenterWorkspaceSource,
} from "./workspace-results";

const WORKSPACES: CommandCenterWorkspaceSource[] = [
  {
    serverId: "host-a",
    serverLabel: "Laptop",
    workspaceId: "workspace-main",
    title: "Main",
    projectName: "Thoth",
    branch: "agent/dev/mvp",
    workspaceDirectory: "/repo/thoth",
  },
  {
    serverId: "host-b",
    serverLabel: "Build host",
    workspaceId: "workspace-worktree",
    title: "Transport worktree",
    projectName: "Relay Lab",
    branch: "transport-v2",
    workspaceDirectory: "/repo/relay-worktree",
  },
];

describe("Command Center Workspace projection", () => {
  it("searches canonical title, project, branch, host, and directory fields", () => {
    for (const query of ["main", "thoth", "agent/dev", "laptop", "/repo/thoth"]) {
      expect(
        projectCommandCenterWorkspaceItems({
          workspaces: WORKSPACES,
          query,
          showHost: true,
        }).map((item) => item.workspaceId),
      ).toEqual(["workspace-main"]);
    }
  });

  it("shows project and branch on one host and prefixes host only for multi-host", () => {
    expect(
      projectCommandCenterWorkspaceItems({
        workspaces: [WORKSPACES[0]!],
        query: "",
        showHost: false,
      })[0],
    ).toMatchObject({
      subtitle: "Thoth · agent/dev/mvp",
      route: "/h/host-a/workspace/workspace-main",
    });
    expect(
      projectCommandCenterWorkspaceItems({
        workspaces: [WORKSPACES[0]!],
        query: "",
        showHost: true,
      })[0]?.subtitle,
    ).toBe("Laptop · Thoth · agent/dev/mvp");
  });

  it("drops absent subtitle fields without duplicate separators", () => {
    expect(joinCommandCenterSubtitleParts(["Laptop", null, ""])).toBe("Laptop");
  });
});
