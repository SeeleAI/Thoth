import { describe, expect, it } from "vitest";
import type { FetchAgentsEntry } from "@thoth/client/internal/daemon-client";
import type { AgentSnapshotPayload } from "@thoth/protocol/messages";
import { PARENT_AGENT_ID_LABEL } from "@thoth/protocol/agent-labels";
import { buildAgentDirectoryState } from "./agent-directory-sync";

function createAgentPayload(
  input: Partial<Omit<AgentSnapshotPayload, "labels">> & {
    id: string;
    labels?: Record<string, string>;
  },
): AgentSnapshotPayload {
  return {
    id: input.id,
    provider: input.provider ?? "codex",
    cwd: input.cwd ?? "/repo",
    model: input.model ?? null,
    createdAt: input.createdAt ?? "2026-04-20T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-20T00:01:00.000Z",
    lastUserMessageAt: input.lastUserMessageAt ?? null,
    status: input.status ?? "idle",
    capabilities: input.capabilities ?? {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: input.currentModeId ?? null,
    availableModes: input.availableModes ?? [],
    pendingPermissions: input.pendingPermissions ?? [],
    persistence: input.persistence ?? null,
    title: input.title ?? null,
    labels: input.labels ?? {},
  };
}

function createEntry(agent: AgentSnapshotPayload): FetchAgentsEntry {
  return {
    agent,
    project: {
      projectKey: agent.cwd,
      projectName: "repo",
      checkout: {
        cwd: agent.cwd,
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isThothOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  };
}

describe("replaceFetchedAgentDirectory", () => {
  it("re-derives parentAgentId every time an agent snapshot is ingested", () => {
    const serverId = "server-1";
    buildAgentDirectoryState({
      serverId,
      entries: [
        createEntry(
          createAgentPayload({
            id: "child-1",
            labels: { [PARENT_AGENT_ID_LABEL]: "parent-a" },
          }),
        ),
      ],
    });

    const state = buildAgentDirectoryState({
      serverId,
      entries: [
        createEntry(
          createAgentPayload({
            id: "child-1",
            labels: { [PARENT_AGENT_ID_LABEL]: "parent-b" },
          }),
        ),
      ],
    });

    expect(state.agents.get("child-1")?.parentAgentId).toBe("parent-b");
  });
});
