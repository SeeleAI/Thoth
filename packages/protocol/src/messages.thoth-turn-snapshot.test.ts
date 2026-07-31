import { describe, expect, it } from "vitest";
import {
  CreateAgentRequestMessageSchema,
  SendAgentMessageRequestSchema,
  SendAgentMessageResponseMessageSchema,
  ThothTurnSnapshotSchema,
} from "./messages.js";

const config = { provider: "codex" as const, cwd: "/tmp/thoth" };

describe("foreground Thoth turn snapshot", () => {
  it("keeps old create and send payloads raw by leaving thoth absent", () => {
    expect(
      CreateAgentRequestMessageSchema.parse({
        type: "create_agent_request",
        requestId: "create-raw",
        config,
      }).thoth,
    ).toBeUndefined();
    expect(
      SendAgentMessageRequestSchema.parse({
        type: "send_agent_message_request",
        requestId: "send-raw",
        agentId: "agent-1",
        text: "hi",
      }).thoth,
    ).toBeUndefined();
  });

  it("round-trips one snapshot through both create and send", () => {
    const thoth = ThothTurnSnapshotSchema.parse({
      enabled: true,
      executionMode: "loop",
      clarifyStrength: "dive",
      loopStrength: "balanced",
    });
    expect(
      CreateAgentRequestMessageSchema.parse({
        type: "create_agent_request",
        requestId: "create-thoth",
        config,
        initialPrompt: "test loop",
        thoth,
      }).thoth,
    ).toEqual(thoth);
    expect(
      SendAgentMessageRequestSchema.parse({
        type: "send_agent_message_request",
        requestId: "send-thoth",
        agentId: "agent-1",
        text: "test loop",
        thoth,
      }).thoth,
    ).toEqual(thoth);
  });

  it("freezes Provider-selected Clarify depth without exposing a Composer strength choice", () => {
    expect(
      ThothTurnSnapshotSchema.parse({
        enabled: true,
        executionMode: "quick",
        clarifyStrength: "auto",
      }),
    ).toEqual({
      enabled: true,
      executionMode: "quick",
      clarifyStrength: "auto",
    });
  });

  it("freezes provider Plan independently from the Thoth snapshot", () => {
    const create = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      requestId: "create-plan",
      config,
      initialPrompt: "Plan this turn",
      thoth: { enabled: false },
      providerRunMode: "plan",
    });
    const send = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "send-default",
      agentId: "agent-1",
      text: "Use the default mode for the next turn",
      thoth: {
        enabled: true,
        executionMode: "quick",
        clarifyStrength: "light",
      },
      providerRunMode: "default",
    });

    expect(create).toMatchObject({ thoth: { enabled: false }, providerRunMode: "plan" });
    expect(send).toMatchObject({
      thoth: { enabled: true, executionMode: "quick" },
      providerRunMode: "default",
    });
  });

  it("lets a remote daemon resolve cwd exclusively from workspaceId", () => {
    const parsed = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      requestId: "create-remote",
      workspaceId: "workspace-remote",
      config: { provider: "codex" },
      initialPrompt: "remote task",
      thoth: { enabled: false },
    });
    expect(parsed.workspaceId).toBe("workspace-remote");
    expect(parsed.config).not.toHaveProperty("cwd");
    expect(() =>
      CreateAgentRequestMessageSchema.parse({
        type: "create_agent_request",
        requestId: "create-unscoped",
        config: { provider: "codex" },
      }),
    ).toThrow();
  });

  it("keeps the disabled shape minimal and requires a complete enabled turn", () => {
    expect(ThothTurnSnapshotSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(() =>
      ThothTurnSnapshotSchema.parse({
        enabled: false,
        executionMode: "quick",
        clarifyStrength: "light",
      }),
    ).toThrow();
    expect(() =>
      ThothTurnSnapshotSchema.parse({ enabled: true, executionMode: "quick" }),
    ).toThrow();
    expect(() =>
      ThothTurnSnapshotSchema.parse({
        enabled: true,
        executionMode: "loop",
        clarifyStrength: "light",
      }),
    ).toThrow();
  });

  it("keeps turn acknowledgements optional and provider-neutral", () => {
    expect(
      SendAgentMessageResponseMessageSchema.parse({
        type: "send_agent_message_response",
        payload: {
          requestId: "send-1",
          agentId: "agent-1",
          accepted: true,
          error: null,
          turnAck: { turnKind: "thoth", turnId: "turn-1", authorityRevision: 2 },
        },
      }).payload.turnAck,
    ).toEqual({ turnKind: "thoth", turnId: "turn-1", authorityRevision: 2 });
  });
});
