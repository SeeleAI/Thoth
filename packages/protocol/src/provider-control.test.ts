import { describe, expect, it } from "vitest";
import {
  AgentSnapshotPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";
import { ProviderPlanCapabilitySchema } from "./provider-control.js";

describe("Agent provider control protocol", () => {
  it("distinguishes transient capability failure from true unsupported", () => {
    expect(
      ProviderPlanCapabilitySchema.parse({ kind: "unavailable", reason: "probe timed out" }),
    ).toEqual({ kind: "unavailable", reason: "probe timed out" });
    expect(
      ProviderPlanCapabilitySchema.parse({ kind: "unsupported", reason: "no native mode" }),
    ).toEqual({ kind: "unsupported", reason: "no native mode" });
  });

  it("round-trips Agent-scoped get and CAS update messages", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.provider_control.get.request",
        requestId: "request-get",
        agentId: "agent-1",
        refresh: true,
      }),
    ).toMatchObject({ refresh: true });
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.provider_control.update.request",
        requestId: "request-update",
        commandId: "command-update",
        agentId: "agent-1",
        runMode: "plan",
        expectedRevision: 3,
      }),
    ).toMatchObject({ runMode: "plan", expectedRevision: 3 });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "agent.provider_control.update.response",
        payload: {
          requestId: "request-update",
          agentId: "agent-1",
          accepted: true,
          error: null,
          providerControl: {
            runMode: "plan",
            planCapability: { kind: "native" },
            revision: 4,
          },
        },
      }),
    ).toMatchObject({ payload: { providerControl: { runMode: "plan", revision: 4 } } });
  });

  it("keeps legacy snapshots parseable while projecting new Agent authority", () => {
    const base = {
      id: "agent-1",
      provider: "codex",
      cwd: "/workspace",
      model: null,
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle" as const,
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
      title: null,
      labels: {},
    };
    const legacy = AgentSnapshotPayloadSchema.parse(base);
    expect(legacy.providerControl).toBeUndefined();
    expect(legacy.pendingProviderQuestions).toEqual([]);
    expect(
      AgentSnapshotPayloadSchema.parse({
        ...base,
        providerControl: {
          runMode: "default",
          planCapability: { kind: "native" },
          revision: 0,
        },
      }).providerControl,
    ).toEqual({ runMode: "default", planCapability: { kind: "native" }, revision: 0 });
  });
});
