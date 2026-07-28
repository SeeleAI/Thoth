import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  selectPinnedWorkspaces,
  useSidebarWorkspacePinsStore,
} from "./sidebar-workspace-pins-store";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

beforeEach(() => {
  useSidebarWorkspacePinsStore.setState({
    pinnedWorkspaceKeys: [],
    pinnedSectionCollapsed: false,
  });
});

describe("sidebar Workspace pins", () => {
  it("projects pinned workspaces in device-local pin order and ignores stale keys", () => {
    const workspaces = [
      { workspaceKey: "server-1:workspace-1", name: "one" },
      { workspaceKey: "server-1:workspace-2", name: "two" },
    ];

    expect(
      selectPinnedWorkspaces(workspaces, [
        "server-1:workspace-2",
        "missing:workspace",
        "server-1:workspace-1",
      ]),
    ).toEqual([workspaces[1], workspaces[0]]);
  });

  it("toggles a device-local Workspace key idempotently", () => {
    const store = useSidebarWorkspacePinsStore.getState();
    store.toggle("server-1:workspace-1");
    expect(useSidebarWorkspacePinsStore.getState().pinnedWorkspaceKeys).toEqual([
      "server-1:workspace-1",
    ]);
    useSidebarWorkspacePinsStore.getState().toggle("server-1:workspace-1");
    expect(useSidebarWorkspacePinsStore.getState().pinnedWorkspaceKeys).toEqual([]);
  });

  it("keeps Pinned-section collapse independent from pin state", () => {
    const store = useSidebarWorkspacePinsStore.getState();
    store.toggle("server-1:workspace-1");
    store.togglePinnedSectionCollapsed();
    expect(useSidebarWorkspacePinsStore.getState()).toMatchObject({
      pinnedWorkspaceKeys: ["server-1:workspace-1"],
      pinnedSectionCollapsed: true,
    });
  });
});
