import { describe, expect, it } from "vitest";
import type { AgentSnapshotPayload } from "@thoth/protocol/messages";
import { PARENT_AGENT_ID_LABEL } from "@thoth/protocol/agent-labels";
import { normalizeAgentSnapshot } from "./agent-snapshots";

function createSnapshot(
  input: Partial<Omit<AgentSnapshotPayload, "labels">> & {
    labels?: Record<string, unknown>;
  } = {},
): AgentSnapshotPayload {
  return {
    id: input.id ?? "agent-1",
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
    pendingProviderQuestions: input.pendingProviderQuestions ?? [],
    persistence: input.persistence ?? null,
    title: input.title ?? null,
    ...(input.providerControl ? { providerControl: input.providerControl } : {}),
    labels: (input.labels ?? {}) as AgentSnapshotPayload["labels"],
  };
}

describe("normalizeAgentSnapshot", () => {
  it("preserves Agent-scoped provider control and defaults legacy snapshots", () => {
    const current = normalizeAgentSnapshot(
      createSnapshot({
        providerControl: {
          runMode: "plan",
          planCapability: { kind: "native" },
          revision: 2,
        },
      }),
      "server-1",
    );
    const legacy = normalizeAgentSnapshot(createSnapshot(), "server-1");

    expect(current.providerControl).toEqual({
      runMode: "plan",
      planCapability: { kind: "native" },
      revision: 2,
    });
    expect(legacy.providerControl).toMatchObject({
      runMode: "default",
      planCapability: { kind: "unavailable" },
      revision: 0,
    });
  });

  it("derives parentAgentId from the parent label while preserving labels", () => {
    const labels = {
      [PARENT_AGENT_ID_LABEL]: "parent-1",
      "custom.label": "still-here",
    };

    const agent = normalizeAgentSnapshot(createSnapshot({ labels }), "server-1");

    expect(agent.parentAgentId).toBe("parent-1");
    expect(agent.labels).toEqual(labels);
  });

  it("trims whitespace around the parent label", () => {
    const agent = normalizeAgentSnapshot(
      createSnapshot({ labels: { [PARENT_AGENT_ID_LABEL]: "  parent-1 \n" } }),
      "server-1",
    );

    expect(agent.parentAgentId).toBe("parent-1");
  });

  it("maps missing, empty, and non-string parent labels to null", () => {
    const missing = normalizeAgentSnapshot(createSnapshot(), "server-1");
    const empty = normalizeAgentSnapshot(
      createSnapshot({ labels: { [PARENT_AGENT_ID_LABEL]: "   " } }),
      "server-1",
    );
    const nonString = normalizeAgentSnapshot(
      createSnapshot({ labels: { [PARENT_AGENT_ID_LABEL]: 42 } }),
      "server-1",
    );

    expect(missing.parentAgentId).toBeNull();
    expect(empty.parentAgentId).toBeNull();
    expect(nonString.parentAgentId).toBeNull();
  });
});
