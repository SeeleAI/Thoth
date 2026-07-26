import { describe, expect, it, vi } from "vitest";
import {
  buildBulkCloseConfirmationMessage,
  classifyBulkClosableTabs,
  closeBulkWorkspaceTabs,
} from "@/screens/workspace/workspace-bulk-close";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

const ROOT_AGENTS = new Map([
  ["a1", { parentAgentId: null, archivedAt: null }],
  ["a2", { parentAgentId: null, archivedAt: null }],
]);
const KNOWN_TERMINALS = new Set(["t1", "t2"]);

function classify(tabs: WorkspaceTabDescriptor[]) {
  return classifyBulkClosableTabs({
    tabs,
    agents: ROOT_AGENTS,
    knownTerminalIds: KNOWN_TERMINALS,
  });
}

function makeAgentTab(id: string): WorkspaceTabDescriptor {
  return {
    key: `agent_${id}`,
    tabId: `agent_${id}`,
    kind: "agent",
    target: { kind: "agent", agentId: id },
  };
}

function makeTerminalTab(id: string): WorkspaceTabDescriptor {
  return {
    key: `terminal_${id}`,
    tabId: `terminal_${id}`,
    kind: "terminal",
    target: { kind: "terminal", terminalId: id },
  };
}

function makeFileTab(path: string): WorkspaceTabDescriptor {
  return {
    key: `file_${path}`,
    tabId: `file_${path}`,
    kind: "file",
    target: { kind: "file", path },
  };
}

describe("workspace bulk close helpers", () => {
  it("classifies agent, terminal, and passive tabs for shared bulk close handling", () => {
    const groups = classify([
      makeAgentTab("a1"),
      makeTerminalTab("t1"),
      makeFileTab("/repo/README.md"),
    ]);

    expect(groups).toEqual({
      agentTabs: [{ tabId: "agent_a1", agentId: "a1" }],
      terminalTabs: [{ tabId: "terminal_t1", terminalId: "t1" }],
      otherTabs: [
        {
          tabId: "file_/repo/README.md",
          target: { kind: "file", path: "/repo/README.md" },
        },
      ],
    });
  });

  it("keeps subagent, archived, missing Agent, and stale Terminal tabs out of destructive RPC groups", () => {
    const groups = classifyBulkClosableTabs({
      tabs: [
        makeAgentTab("root"),
        makeAgentTab("subagent"),
        makeAgentTab("archived"),
        makeAgentTab("missing"),
        makeTerminalTab("terminal-live"),
        makeTerminalTab("terminal-stale"),
        makeFileTab("/repo/README.md"),
      ],
      agents: new Map([
        ["root", { parentAgentId: null, archivedAt: null }],
        ["subagent", { parentAgentId: "root", archivedAt: null }],
        ["archived", { parentAgentId: null, archivedAt: new Date("2026-07-25T00:00:00.000Z") }],
      ]),
      knownTerminalIds: new Set(["terminal-live"]),
    });

    expect(groups).toEqual({
      agentTabs: [{ tabId: "agent_root", agentId: "root" }],
      terminalTabs: [{ tabId: "terminal_terminal-live", terminalId: "terminal-live" }],
      otherTabs: [
        { tabId: "agent_subagent", target: { kind: "agent", agentId: "subagent" } },
        { tabId: "agent_archived", target: { kind: "agent", agentId: "archived" } },
        { tabId: "agent_missing", target: { kind: "agent", agentId: "missing" } },
        {
          tabId: "terminal_terminal-stale",
          target: { kind: "terminal", terminalId: "terminal-stale" },
        },
        {
          tabId: "file_/repo/README.md",
          target: { kind: "file", path: "/repo/README.md" },
        },
      ],
    });
  });

  it("removes stale entity tabs locally without calling the daemon", async () => {
    const groups = classifyBulkClosableTabs({
      tabs: [makeAgentTab("missing"), makeTerminalTab("stale")],
      agents: new Map(),
      knownTerminalIds: new Set(),
    });
    const closeItems = vi.fn();
    const cleanupCalls: string[] = [];

    await closeBulkWorkspaceTabs({
      groups,
      client: { closeItems },
      closeTab: async (_tabId, action) => action(),
      closeWorkspaceTabWithCleanup: ({ tabId }) => cleanupCalls.push(tabId),
      logLabel: "stale tabs",
    });

    expect(closeItems).not.toHaveBeenCalled();
    expect(cleanupCalls).toEqual(["agent_missing", "terminal_stale"]);
  });

  it("describes mixed destructive bulk close operations in the confirmation copy", () => {
    const message = buildBulkCloseConfirmationMessage(
      classify([
        makeAgentTab("a1"),
        makeAgentTab("a2"),
        makeTerminalTab("t1"),
        makeFileTab("/repo/README.md"),
      ]),
    );

    expect(message).toBe(
      "This will archive 2 agent(s), close 1 terminal(s), and close 1 tab(s). Any running process in a closed terminal will be stopped immediately.",
    );
  });

  it("keeps terminal-only confirmations explicit about stopping running processes", () => {
    const message = buildBulkCloseConfirmationMessage(classify([makeTerminalTab("t1")]));

    expect(message).toBe(
      "This will close 1 terminal(s). Any running process in a closed terminal will be stopped immediately.",
    );
  });

  it("closes only daemon-confirmed destructive tabs after closeItems returns", async () => {
    const groups = classify([
      makeAgentTab("a1"),
      makeTerminalTab("t1"),
      makeTerminalTab("t2"),
      makeFileTab("/repo/README.md"),
    ]);
    const closedTabIds: string[] = [];
    const cleanupCalls: Array<{ tabId: string; target?: WorkspaceTabDescriptor["target"] }> = [];
    const closeItems = vi.fn(async () => ({
      agents: [{ agentId: "a1", archivedAt: "2026-04-01T04:00:00.000Z" }],
      terminals: [
        { terminalId: "t1", success: true },
        { terminalId: "t2", success: false },
      ],
      requestId: "req-1",
    }));

    await closeBulkWorkspaceTabs({
      groups,
      client: { closeItems },
      closeTab: async (tabId, action) => {
        closedTabIds.push(tabId);
        await action();
      },
      closeWorkspaceTabWithCleanup: (input) => {
        cleanupCalls.push(input);
      },
      logLabel: "all tabs",
    });

    expect(closeItems).toHaveBeenCalledTimes(1);
    expect(closeItems).toHaveBeenCalledWith({
      agentIds: ["a1"],
      terminalIds: ["t1", "t2"],
    });
    expect(closedTabIds).toEqual(["agent_a1", "terminal_t1", "file_/repo/README.md"]);
    expect(cleanupCalls).toEqual([
      { tabId: "agent_a1", target: { kind: "agent", agentId: "a1" } },
      { tabId: "terminal_t1", target: { kind: "terminal", terminalId: "t1" } },
      { tabId: "file_/repo/README.md", target: { kind: "file", path: "/repo/README.md" } },
    ]);
  });

  it("retains destructive tabs when closeItems fails and still closes passive tabs", async () => {
    const groups = classify([
      makeAgentTab("a1"),
      makeTerminalTab("t1"),
      makeFileTab("/repo/README.md"),
    ]);
    const closedTabIds: string[] = [];
    const cleanupCalls: Array<{ tabId: string; target?: WorkspaceTabDescriptor["target"] }> = [];
    const warn = vi.fn();

    await closeBulkWorkspaceTabs({
      groups,
      client: {
        closeItems: async () => {
          throw new Error("rpc failed");
        },
      },
      closeTab: async (tabId, action) => {
        closedTabIds.push(tabId);
        await action();
      },
      closeWorkspaceTabWithCleanup: (input) => {
        cleanupCalls.push(input);
      },
      warn,
      logLabel: "others",
    });

    await Promise.resolve();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(closedTabIds).toEqual(["file_/repo/README.md"]);
    expect(cleanupCalls).toEqual([
      { tabId: "file_/repo/README.md", target: { kind: "file", path: "/repo/README.md" } },
    ]);
  });
});
