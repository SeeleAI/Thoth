import { describe, expect, it } from "vitest";
import type { FetchAgentsEntry } from "@thoth/client/internal/daemon-client";
import type { Agent } from "@/projection/authority-model";
import { deriveWorkspaceAgentVisibility } from "@/workspace-tabs/agent-visibility";
import {
  buildLegacyDaemonWorkspaceSnapshot,
  shouldUseLegacyDaemonWorkspaceDirectory,
} from "./legacy-daemon-workspaces";

const SERVER_ID = "srv_legacy";

function legacyAgent(input: {
  id: string;
  cwd: string;
  status?: FetchAgentsEntry["agent"]["status"];
  updatedAt?: string;
}): FetchAgentsEntry {
  const updatedAt = input.updatedAt ?? "2026-06-18T10:00:00.000Z";
  return {
    agent: {
      id: input.id,
      provider: "mock",
      cwd: input.cwd,
      model: null,
      createdAt: updatedAt,
      updatedAt,
      lastUserMessageAt: null,
      status: input.status ?? "idle",
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
      pendingProviderQuestions: [],
      persistence: null,
      title: null,
      labels: {},
    },
    project: {
      projectKey: "/repo",
      projectName: "repo",
      workspaceName: "app",
      checkout: {
        cwd: input.cwd,
        isGit: true,
        currentBranch: "main",
        remoteUrl: "git@example.com:repo/app.git",
        worktreeRoot: input.cwd,
        isThothOwnedWorktree: false,
        mainRepoRoot: "/repo",
      },
    },
  };
}

function getSnapshotAgent(snapshot: { agents: Map<string, Agent> }, agentId: string): Agent {
  const agent = snapshot.agents.get(agentId);
  if (!agent) {
    throw new Error(`test agent missing: ${agentId}`);
  }
  return agent;
}

describe("buildLegacyDaemonWorkspaceSnapshot", () => {
  it("creates path-backed workspace rows and stamps legacy agents with their workspace id", () => {
    const snapshot = buildLegacyDaemonWorkspaceSnapshot({
      serverId: SERVER_ID,
      entries: [
        legacyAgent({ id: "agent-running", cwd: "/repo/app", status: "running" }),
        legacyAgent({ id: "agent-idle", cwd: "/repo/app", status: "idle" }),
      ],
    });

    expect(Array.from(snapshot.workspaces.values())).toEqual([
      expect.objectContaining({
        id: "/repo/app",
        projectId: "/repo",
        projectDisplayName: "repo",
        projectRootPath: "/repo",
        workspaceDirectory: "/repo/app",
        projectKind: "git",
        workspaceKind: "checkout",
        name: "app",
        status: "running",
        scripts: [],
      }),
    ]);
    expect(
      Array.from(snapshot.agents.values()).map((agent) => ({
        id: agent.id,
        serverId: agent.serverId,
        cwd: agent.cwd,
        workspaceId: agent.workspaceId,
      })),
    ).toEqual([
      {
        id: "agent-running",
        serverId: SERVER_ID,
        cwd: "/repo/app",
        workspaceId: "/repo/app",
      },
      {
        id: "agent-idle",
        serverId: SERVER_ID,
        cwd: "/repo/app",
        workspaceId: "/repo/app",
      },
    ]);
  });

  it("keeps old-daemon agent updates attached to the path-backed workspace", () => {
    const initial = buildLegacyDaemonWorkspaceSnapshot({
      serverId: SERVER_ID,
      entries: [legacyAgent({ id: "agent-running", cwd: "/repo/app", status: "running" })],
    });
    const updated = buildLegacyDaemonWorkspaceSnapshot({
      serverId: SERVER_ID,
      entries: [
        legacyAgent({
          id: "agent-running",
          cwd: "/repo/app",
          status: "idle",
          updatedAt: "2026-06-18T10:01:00.000Z",
        }),
      ],
    });
    const stampedUpdate = getSnapshotAgent(updated, "agent-running");
    const visibility = deriveWorkspaceAgentVisibility({
      agents: updated.agents,
      workspaceId: "/repo/app",
    });

    expect(getSnapshotAgent(initial, "agent-running").workspaceId).toBe("/repo/app");
    expect(stampedUpdate.workspaceId).toBe("/repo/app");
    expect(visibility.activeAgentIds).toEqual(new Set(["agent-running"]));
  });

  it("uses path-backed synthesis only when workspace multiplicity is unavailable", () => {
    expect(
      shouldUseLegacyDaemonWorkspaceDirectory({
        serverId: SERVER_ID,
        hostname: null,
        version: "0.1.96",
        features: {},
      }),
    ).toBe(true);
    expect(
      shouldUseLegacyDaemonWorkspaceDirectory({
        serverId: SERVER_ID,
        hostname: null,
        version: "0.2.0",
        features: { workspaceMultiplicity: true },
      }),
    ).toBe(false);
  });
});
