import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema } from "../messages.js";
import {
  AgentThothCardAnswerRequestSchema,
  AgentThothStateSchema,
  AgentThothStateUpdateSchema,
  ThothCardAnswerPayloadSchema,
} from "./rpc-schemas.js";

describe("agent-scoped Thoth protocol", () => {
  it("parses an authority state with a durable open card", () => {
    const state = AgentThothStateSchema.parse({
      agentId: "agent-1",
      revision: 3,
      lifecycle: "awaiting_card",
      turn: {
        id: "turn-1",
        agentId: "agent-1",
        kind: "thoth",
        lifecycle: "awaiting_card",
        controls: { mode: "loop", clarifyStrength: "light", loop: "light" },
        sourceMessageId: "message-1",
        startedAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:01.000Z",
      },
      pendingCard: {
        kind: "clarify_card",
        createdAt: "2026-07-18T00:00:01.000Z",
        card: {
          id: "card-1",
          sessionId: "clarify-session-1",
          roundIndex: 1,
          card: {
            title: "Deployment boundary",
            whyNow: "This choice changes the implementation target.",
            publicSummary: "Confirm one material Human-owned branch.",
            questions: [
              {
                nodeId: "runtime-target",
                question: "Which runtime target should own acceptance?",
                choices: [
                  { id: "native", label: "Native" },
                  { id: "portable", label: "Portable" },
                ],
                recommendedChoiceId: "native",
              },
            ],
          },
          submitted: false,
        },
      },
      backgroundTaskId: null,
      error: null,
    });

    expect(state.pendingCard?.kind).toBe("clarify_card");
    expect(
      AgentThothStateUpdateSchema.parse({
        type: "agent.thoth.state.update",
        payload: { state, reason: "card_opened" },
      }).payload.state.revision,
    ).toBe(3);
  });

  it("requires CAS and command idempotency fields for card answers", () => {
    const answer = ThothCardAnswerPayloadSchema.parse({
      intent: "accept_loop",
      cardId: "card-1",
      rawAnswer: "Run the confirmed Intent Contract in the background.",
    });
    const request = AgentThothCardAnswerRequestSchema.parse({
      type: "agent.thoth.card.answer.request",
      requestId: "request-1",
      agentId: "agent-1",
      cardId: "card-1",
      answer,
      expectedRevision: 7,
      commandId: "command-1",
    });

    expect(request.expectedRevision).toBe(7);
    expect(request.commandId).toBe("command-1");
  });

  it("binds recommendation and subtree delegation to exactly one Decision node", () => {
    const targetAnswer = {
      nodeId: "runtime-target",
      choiceIds: [],
      choiceNotes: {},
    };
    expect(
      ThothCardAnswerPayloadSchema.parse({
        intent: "recommend",
        questionCardId: "card-1",
        answers: [targetAnswer],
        delegatedNodeIds: ["runtime-target"],
        rawAnswer: "Use your recommendation for this node.",
      }),
    ).toMatchObject({ intent: "recommend", delegatedNodeIds: ["runtime-target"] });
    expect(
      ThothCardAnswerPayloadSchema.parse({
        intent: "delegate_subtree",
        questionCardId: "card-1",
        answers: [targetAnswer],
        delegatedNodeIds: ["runtime-target"],
        rawAnswer: "Delegate this subtree.",
      }),
    ).toMatchObject({ intent: "delegate_subtree", delegatedNodeIds: ["runtime-target"] });

    expect(() =>
      ThothCardAnswerPayloadSchema.parse({
        intent: "recommend",
        questionCardId: "card-1",
        answers: [targetAnswer, { ...targetAnswer, nodeId: "risk" }],
        delegatedNodeIds: ["runtime-target", "risk"],
        rawAnswer: "Recommend every question.",
      }),
    ).toThrow(/exactly one target Decision node/u);
  });

  it("rejects every removed Workspace Secretary RPC", () => {
    for (const type of [
      "workspace_secretary.send.request",
      "workspace_secretary.cancel.request",
      "workspace_secretary.topic.create.request",
      "workspace_secretary.snapshot.request",
      "workspace_secretary.answer.request",
    ]) {
      expect(SessionInboundMessageSchema.safeParse({ type, requestId: "request-1" }).success).toBe(
        false,
      );
    }
  });
});
