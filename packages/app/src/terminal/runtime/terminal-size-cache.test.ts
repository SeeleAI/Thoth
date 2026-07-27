import { beforeEach, describe, expect, it } from "vitest";

import {
  estimateTerminalViewportSize,
  rememberTerminalViewportSize,
  resetTerminalViewportSizeCacheForTests,
} from "./terminal-size-cache";

describe("terminal viewport size cache", () => {
  beforeEach(() => resetTerminalViewportSizeCacheForTests());

  it("returns null until a viewport has been measured", () => {
    expect(
      estimateTerminalViewportSize({ serverId: "server-1", workspaceId: "ws-1", cwd: "/repo" }),
    ).toBeNull();
  });

  it("uses the most recent size for the same Workspace", () => {
    rememberTerminalViewportSize({
      serverId: "server-1",
      workspaceId: "ws-1",
      cwd: "/repo",
      size: { rows: 48, cols: 160 },
    });
    expect(
      estimateTerminalViewportSize({ serverId: "server-1", workspaceId: "ws-1", cwd: "/repo" }),
    ).toEqual({ rows: 48, cols: 160 });
  });

  it("does not collide same-directory Workspaces and falls back to the latest device size", () => {
    rememberTerminalViewportSize({
      serverId: "server-1",
      workspaceId: "ws-a",
      cwd: "/repo",
      size: { rows: 32, cols: 100 },
    });
    rememberTerminalViewportSize({
      serverId: "server-1",
      workspaceId: "ws-b",
      cwd: "/repo",
      size: { rows: 52, cols: 180 },
    });

    expect(
      estimateTerminalViewportSize({ serverId: "server-1", workspaceId: "ws-a", cwd: "/repo" }),
    ).toEqual({ rows: 32, cols: 100 });
    expect(
      estimateTerminalViewportSize({ serverId: "server-2", workspaceId: "ws-c", cwd: "/other" }),
    ).toEqual({ rows: 52, cols: 180 });
  });
});
