import { describe, expect, it } from "vitest";
import {
  AgentRewindResponseMessageSchema,
  SendAgentMessageRequestSchema,
  SendAgentMessageResponseMessageSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("Agent turn queue protocol", () => {
  it("defaults old sends to Queue and freezes an explicit Interrupt", () => {
    const oldSend = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "send-old",
      agentId: "agent-1",
      text: "wait for the current turn",
    });
    const interrupt = SendAgentMessageRequestSchema.parse({
      ...oldSend,
      requestId: "send-interrupt",
      deliveryMode: "interrupt",
    });

    expect(oldSend.deliveryMode).toBe("queue");
    expect(interrupt.deliveryMode).toBe("interrupt");
  });

  it("round-trips queued acknowledgement and CAS queue commands", () => {
    const response = SendAgentMessageResponseMessageSchema.parse({
      type: "send_agent_message_response",
      payload: {
        requestId: "send-queued",
        agentId: "agent-1",
        accepted: true,
        error: null,
        turnAck: {
          turnKind: "raw",
          turnId: "queued-turn-1",
          authorityRevision: 4,
          disposition: "queued",
          queuePosition: 2,
        },
      },
    });
    expect(response.payload.turnAck).toMatchObject({ disposition: "queued", queuePosition: 2 });

    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.turn_queue.command.request",
        requestId: "queue-command-1",
        agentId: "agent-1",
        queuedTurnId: "queued-turn-1",
        command: "interrupt",
        expectedRevision: 4,
        commandId: "command-1",
      }),
    ).toMatchObject({ command: "interrupt", expectedRevision: 4 });

    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.turn_queue.command.request",
        requestId: "queue-command-edit",
        agentId: "agent-1",
        queuedTurnId: "queued-turn-1",
        command: "edit",
        text: "updated text",
        expectedRevision: 4,
        commandId: "command-edit",
      }),
    ).toMatchObject({ command: "edit", text: "updated text" });
    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "agent.turn_queue.command.request",
        requestId: "queue-command-invalid-edit",
        agentId: "agent-1",
        queuedTurnId: "queued-turn-1",
        command: "edit",
        expectedRevision: 4,
        commandId: "command-invalid-edit",
      }),
    ).toThrow("Queue edit commands require replacement text");

    expect(
      SessionOutboundMessageSchema.parse({
        type: "agent.turn_queue.command.response",
        payload: {
          requestId: "queue-command-1",
          agentId: "agent-1",
          accepted: true,
          conflict: false,
          duplicate: false,
          revision: 5,
          queuedTurns: [],
          restoredText: null,
          error: null,
        },
      }).payload.revision,
    ).toBe(5);
  });

  it("marks conversation rewind as a full timeline epoch reset", () => {
    const response = AgentRewindResponseMessageSchema.parse({
      type: "agent.rewind.response",
      payload: {
        requestId: "rewind-1",
        agentId: "agent-1",
        ok: true,
        error: null,
        timelineEpoch: "epoch-2",
        authorityRevision: 7,
        reset: true,
      },
    });
    expect(response.payload).toMatchObject({ timelineEpoch: "epoch-2", reset: true });
  });
});
