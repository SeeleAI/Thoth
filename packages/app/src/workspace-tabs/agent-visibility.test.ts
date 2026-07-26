import { describe, expect, it } from "vitest";
import type { Agent } from "@/projection/authority-model";
import {
  buildWorkspaceTabSnapshot,
  deriveWorkspaceAgentVisibility,
  selectAuthorityBackedWorkspaceTabs,
  workspaceAgentVisibilityEqual,
} from "@/workspace-tabs/agent-visibility";
import { deriveProjectPlacementFromCwd } from "@/utils/project-placement";
import type { WorkspaceTab } from "@/stores/workspace-tabs-store";

function makeAgent(input: {
  id: string;
  cwd: string;
  workspaceId?: string;
  parentAgentId?: string | null;
  archivedAt?: Date | null;
  createdAt?: Date;
  lastActivityAt?: Date;
}): Agent {
  const createdAt = input.createdAt ?? new Date("2026-03-04T00:00:00.000Z");
  const lastActivityAt = input.lastActivityAt ?? createdAt;
  return {
    serverId: "srv",
    id: input.id,
    provider: "codex",
    status: "idle",
    createdAt,
    updatedAt: createdAt,
    lastUserMessageAt: null,
    lastActivityAt,
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
    runtimeInfo: {
      provider: "codex",
      sessionId: null,
    },
    title: null,
    cwd: input.cwd,
    workspaceId: input.workspaceId,
    model: null,
    thinkingOptionId: null,
    parentAgentId: input.parentAgentId ?? null,
    labels: {},
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: input.archivedAt ?? null,
    projectPlacement: input.workspaceId ? deriveProjectPlacementFromCwd(input.cwd) : null,
  };
}

const WORKSPACE_ID = "ws-1";

describe("workspace agent visibility", () => {
  it("keeps subagents active and known while excluding them from auto-open", () => {
    const parent = makeAgent({
      id: "parent-agent",
      cwd: "/repo/worktree",
      workspaceId: WORKSPACE_ID,
    });
    const child = makeAgent({
      id: "child-agent",
      cwd: "/repo/worktree",
      workspaceId: WORKSPACE_ID,
      parentAgentId: "parent-agent",
    });

    const result = deriveWorkspaceAgentVisibility({
      agents: new Map<string, Agent>([
        [parent.id, parent],
        [child.id, child],
      ]),
      workspaceId: WORKSPACE_ID,
    });

    expect(result.activeAgentIds).toEqual(new Set(["parent-agent", "child-agent"]));
    expect(result.autoOpenAgentIds).toEqual(new Set(["parent-agent"]));
    expect(result.knownAgentIds).toEqual(new Set(["parent-agent", "child-agent"]));
  });

  it("keeps archived subagents known but excludes them from active and auto-open", () => {
    const archivedChild = makeAgent({
      id: "archived-child",
      cwd: "/repo/worktree",
      workspaceId: WORKSPACE_ID,
      parentAgentId: "parent-agent",
      archivedAt: new Date("2026-03-04T00:01:00.000Z"),
    });

    const result = deriveWorkspaceAgentVisibility({
      agents: new Map<string, Agent>([[archivedChild.id, archivedChild]]),
      workspaceId: WORKSPACE_ID,
    });

    expect(result.activeAgentIds).toEqual(new Set<string>());
    expect(result.autoOpenAgentIds).toEqual(new Set<string>());
    expect(result.knownAgentIds).toEqual(new Set(["archived-child"]));
    expect(result.archivedAgentIds).toEqual(new Set(["archived-child"]));
  });

  it("excludes a child from auto-open even when its snapshot arrives before the parent", () => {
    const child = makeAgent({
      id: "child-agent",
      cwd: "/repo/worktree",
      workspaceId: WORKSPACE_ID,
      parentAgentId: "parent-agent",
    });
    const parent = makeAgent({
      id: "parent-agent",
      cwd: "/repo/worktree",
      workspaceId: WORKSPACE_ID,
    });

    const result = deriveWorkspaceAgentVisibility({
      agents: new Map<string, Agent>([
        [child.id, child],
        [parent.id, parent],
      ]),
      workspaceId: WORKSPACE_ID,
    });

    expect(result.activeAgentIds).toEqual(new Set(["child-agent", "parent-agent"]));
    expect(result.autoOpenAgentIds).toEqual(new Set(["parent-agent"]));
    expect(result.knownAgentIds).toEqual(new Set(["child-agent", "parent-agent"]));
  });

  it("keeps archived agents out of activeAgentIds but present in knownAgentIds", () => {
    const visible = makeAgent({
      id: "visible-agent",
      cwd: "/repo/worktree",
      workspaceId: WORKSPACE_ID,
      createdAt: new Date("2026-03-04T00:00:00.000Z"),
    });
    const archived = makeAgent({
      id: "archived-agent",
      cwd: "/repo/worktree",
      workspaceId: WORKSPACE_ID,
      archivedAt: new Date("2026-03-04T00:01:00.000Z"),
      createdAt: new Date("2026-03-04T00:01:00.000Z"),
    });
    const otherWorkspace = makeAgent({
      id: "other-workspace-agent",
      cwd: "/repo/other",
      workspaceId: "ws-other",
    });

    const agents = new Map<string, Agent>([
      [visible.id, visible],
      [archived.id, archived],
      [otherWorkspace.id, otherWorkspace],
    ]);

    const result = deriveWorkspaceAgentVisibility({
      agents,
      workspaceId: WORKSPACE_ID,
    });

    expect(result.activeAgentIds).toEqual(new Set(["visible-agent"]));
    expect(result.autoOpenAgentIds).toEqual(new Set(["visible-agent"]));
    expect(result.knownAgentIds.has("visible-agent")).toBe(true);
    expect(result.knownAgentIds.has("archived-agent")).toBe(true);
    expect(result.knownAgentIds.has("other-workspace-agent")).toBe(false);
    expect(result.archivedAgentIds).toEqual(new Set(["archived-agent"]));
  });

  it("keeps archived lazy history known without treating it as a restorable tab", () => {
    const active = makeAgent({
      id: "active-agent",
      cwd: "/repo/worktree",
      workspaceId: WORKSPACE_ID,
    });
    const historicalDetail = makeAgent({
      id: "historical-agent",
      cwd: "/repo/worktree",
      workspaceId: WORKSPACE_ID,
      archivedAt: new Date("2026-03-04T00:01:00.000Z"),
    });

    const result = deriveWorkspaceAgentVisibility({
      agents: new Map([
        [active.id, active],
        [historicalDetail.id, historicalDetail],
      ]),
      workspaceId: WORKSPACE_ID,
    });

    expect(result.activeAgentIds).toEqual(new Set(["active-agent"]));
    expect(result.knownAgentIds).toEqual(new Set(["active-agent", "historical-agent"]));
    expect(result.archivedAgentIds).toEqual(new Set(["historical-agent"]));
    expect(result.restorableAgentIds).toEqual(new Set<string>());
  });

  it("does not mark session-directory archived agents as restorable", () => {
    const archived = makeAgent({
      id: "archived-agent",
      cwd: "/repo/worktree",
      workspaceId: WORKSPACE_ID,
      archivedAt: new Date("2026-03-04T00:01:00.000Z"),
    });

    const result = deriveWorkspaceAgentVisibility({
      agents: new Map([[archived.id, archived]]),
      workspaceId: WORKSPACE_ID,
    });

    expect(result.activeAgentIds).toEqual(new Set<string>());
    expect(result.knownAgentIds).toEqual(new Set(["archived-agent"]));
    expect(result.archivedAgentIds).toEqual(new Set(["archived-agent"]));
    expect(result.restorableAgentIds).toEqual(new Set<string>());
  });

  it("exposes only current authority-backed entity tabs", () => {
    const tabs: WorkspaceTab[] = [
      { tabId: "agent_active", target: { kind: "agent", agentId: "active" }, createdAt: 1 },
      {
        tabId: "agent_historical",
        target: { kind: "agent", agentId: "historical" },
        createdAt: 2,
      },
      {
        tabId: "agent_archived",
        target: { kind: "agent", agentId: "archived" },
        createdAt: 3,
      },
      { tabId: "agent_missing", target: { kind: "agent", agentId: "missing" }, createdAt: 4 },
      {
        tabId: "terminal_live",
        target: { kind: "terminal", terminalId: "terminal-live" },
        createdAt: 5,
      },
      {
        tabId: "terminal_missing",
        target: { kind: "terminal", terminalId: "terminal-missing" },
        createdAt: 6,
      },
      {
        tabId: "file_readme",
        target: { kind: "file", path: "/repo/README.md" },
        createdAt: 7,
      },
      { tabId: "draft_new", target: { kind: "draft", draftId: "new" }, createdAt: 8 },
      {
        tabId: "browser_docs",
        target: { kind: "browser", browserId: "docs" },
        createdAt: 9,
      },
      {
        tabId: "setup_workspace",
        target: { kind: "setup", workspaceId: "workspace-1" },
        createdAt: 10,
      },
    ];

    expect(
      selectAuthorityBackedWorkspaceTabs({
        tabs,
        knownAgentIds: new Set(["active", "historical", "archived"]),
        archivedAgentIds: new Set(["archived"]),
        knownTerminalIds: new Set(["terminal-live"]),
      }).map((tab) => tab.tabId),
    ).toEqual([
      "agent_active",
      "agent_historical",
      "terminal_live",
      "file_readme",
      "draft_new",
      "browser_docs",
      "setup_workspace",
    ]);
  });

  it("returns the original tab array when every entity has current authority", () => {
    const tabs: WorkspaceTab[] = [
      { tabId: "agent_active", target: { kind: "agent", agentId: "active" }, createdAt: 1 },
      {
        tabId: "terminal_live",
        target: { kind: "terminal", terminalId: "terminal-live" },
        createdAt: 2,
      },
    ];

    expect(
      selectAuthorityBackedWorkspaceTabs({
        tabs,
        knownAgentIds: new Set(["active"]),
        archivedAgentIds: new Set(),
        knownTerminalIds: new Set(["terminal-live"]),
      }),
    ).toBe(tabs);
  });

  it("matches agents by workspaceId regardless of cwd", () => {
    const agents = new Map<string, Agent>([
      [
        "stamped-agent",
        makeAgent({
          id: "stamped-agent",
          cwd: "/repo/subdir",
          workspaceId: "ws-1",
        }),
      ],
    ]);

    const result = deriveWorkspaceAgentVisibility({
      agents,
      workspaceId: "ws-1",
    });

    expect(result.activeAgentIds).toEqual(new Set(["stamped-agent"]));
    expect(result.knownAgentIds).toEqual(new Set(["stamped-agent"]));
  });

  it("excludes a stamped agent whose workspaceId belongs to another workspace sharing the cwd", () => {
    const agents = new Map<string, Agent>([
      [
        "other-ws-agent",
        makeAgent({
          id: "other-ws-agent",
          cwd: "/repo/worktree",
          workspaceId: "ws-2",
        }),
      ],
    ]);

    const result = deriveWorkspaceAgentVisibility({
      agents,
      workspaceId: "ws-1",
    });

    expect(result.activeAgentIds).toEqual(new Set<string>());
    expect(result.knownAgentIds).toEqual(new Set<string>());
  });

  it("excludes agents without a workspaceId", () => {
    const agents = new Map<string, Agent>([
      ["ownerless-agent", makeAgent({ id: "ownerless-agent", cwd: "/repo/worktree" })],
    ]);

    const result = deriveWorkspaceAgentVisibility({
      agents,
      workspaceId: "ws-1",
    });

    expect(result.activeAgentIds).toEqual(new Set<string>());
    expect(result.knownAgentIds).toEqual(new Set<string>());
  });

  it("builds the tab reconciliation snapshot without callers unpacking agent visibility", () => {
    const agentVisibility = {
      activeAgentIds: new Set(["active-agent"]),
      autoOpenAgentIds: new Set(["root-agent"]),
      knownAgentIds: new Set(["active-agent", "archived-agent"]),
      restorableAgentIds: new Set(["historical-agent"]),
    };

    expect(
      buildWorkspaceTabSnapshot({
        agentVisibility,
        agentsHydrated: true,
        terminalsHydrated: true,
        knownTerminalIds: ["terminal-1", "script-terminal"],
        standaloneTerminalIds: ["terminal-1"],
        hasActivePendingDraftCreate: false,
      }),
    ).toEqual({
      agentsHydrated: true,
      terminalsHydrated: true,
      activeAgentIds: agentVisibility.activeAgentIds,
      autoOpenAgentIds: agentVisibility.autoOpenAgentIds,
      knownAgentIds: agentVisibility.knownAgentIds,
      archivedAgentIds: new Set<string>(),
      restorableAgentIds: agentVisibility.restorableAgentIds,
      knownTerminalIds: ["terminal-1", "script-terminal"],
      standaloneTerminalIds: ["terminal-1"],
      hasActivePendingDraftCreate: false,
    });
  });

  describe("workspaceAgentVisibilityEqual", () => {
    it("returns true for identical sets", () => {
      const a = {
        activeAgentIds: new Set(["a", "b"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a", "b", "c"]),
        restorableAgentIds: new Set(["c"]),
      };
      const b = {
        activeAgentIds: new Set(["a", "b"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a", "b", "c"]),
        restorableAgentIds: new Set(["c"]),
      };
      expect(workspaceAgentVisibilityEqual(a, b)).toBe(true);
    });

    it("returns false when activeAgentIds differ", () => {
      const a = {
        activeAgentIds: new Set(["a"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a"]),
      };
      const b = {
        activeAgentIds: new Set(["b"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a"]),
      };
      expect(workspaceAgentVisibilityEqual(a, b)).toBe(false);
    });

    it("returns false when autoOpenAgentIds differ", () => {
      const a = {
        activeAgentIds: new Set(["a", "b"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a", "b"]),
      };
      const b = {
        activeAgentIds: new Set(["a", "b"]),
        autoOpenAgentIds: new Set(["b"]),
        knownAgentIds: new Set(["a", "b"]),
      };
      expect(workspaceAgentVisibilityEqual(a, b)).toBe(false);
    });

    it("returns false when knownAgentIds differ", () => {
      const a = {
        activeAgentIds: new Set(["a"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a"]),
      };
      const b = {
        activeAgentIds: new Set(["a"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a", "b"]),
      };
      expect(workspaceAgentVisibilityEqual(a, b)).toBe(false);
    });

    it("returns false when restorableAgentIds differ", () => {
      const a = {
        activeAgentIds: new Set(["a"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a", "b"]),
        restorableAgentIds: new Set(["b"]),
      };
      const b = {
        activeAgentIds: new Set(["a"]),
        autoOpenAgentIds: new Set(["a"]),
        knownAgentIds: new Set(["a", "b"]),
        restorableAgentIds: new Set<string>(),
      };
      expect(workspaceAgentVisibilityEqual(a, b)).toBe(false);
    });

    it("returns true for empty sets", () => {
      const a = {
        activeAgentIds: new Set<string>(),
        autoOpenAgentIds: new Set<string>(),
        knownAgentIds: new Set<string>(),
      };
      const b = {
        activeAgentIds: new Set<string>(),
        autoOpenAgentIds: new Set<string>(),
        knownAgentIds: new Set<string>(),
      };
      expect(workspaceAgentVisibilityEqual(a, b)).toBe(true);
    });
  });
});
