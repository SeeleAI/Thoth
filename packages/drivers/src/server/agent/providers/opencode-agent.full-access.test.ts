import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentStreamEvent } from "@thoth/drivers/agent-runtime";
import { OpenCodeHarnessAdapter } from "@thoth/drivers/internal/server/agent/providers/opencode-agent";
import {
  idleEvent,
  TestOpenCodeClient,
  TestOpenCodeHarness,
} from "./opencode/test-utils/test-opencode-harness.js";

interface MockOpenCodeClientOptions {
  agents?: unknown[];
  events?: unknown[];
}

function mockOpenCodeClient(options: MockOpenCodeClientOptions = {}) {
  const runtime = new TestOpenCodeHarness();
  const openCodeClient = new TestOpenCodeClient();
  openCodeClient.appAgentsResponse = { data: options.agents ?? [] };
  openCodeClient.sessionPromptAsyncEvents = options.events ?? [idleEvent()];
  openCodeClient.providerListResponse = {
    data: {
      connected: ["openai"],
      all: [{ id: "openai", source: "env", models: {} }],
    },
  };
  runtime.enqueueClient(openCodeClient);

  return { openCodeClient, runtime };
}

function toolPermissionEvent(): unknown {
  return {
    type: "permission.asked",
    properties: {
      id: "permission-1",
      sessionID: "session-1",
      permission: "bash",
      patterns: [],
      metadata: {
        command: "npm test",
        reason: "Run verification",
      },
    },
  };
}

function questionEvent(questionOverrides: Record<string, unknown> = {}): unknown {
  return {
    type: "question.asked",
    properties: {
      id: "question-1",
      sessionID: "session-1",
      questions: [
        {
          question: "Which option should OpenCode use?",
          header: "Decision",
          options: [{ label: "Proceed", description: "Continue with the change" }],
          ...questionOverrides,
        },
      ],
      tool: {
        messageID: "message-1",
        callID: "call-1",
      },
    },
  };
}

function questionRepliedEvent(): unknown {
  return {
    type: "question.replied",
    properties: {
      sessionID: "session-1",
      requestID: "question-1",
      answers: [["Proceed"]],
    },
  };
}

describe("OpenCode auto_accept feature", () => {
  test("lists discovered OpenCode modes without injecting defaults", async () => {
    const { runtime } = mockOpenCodeClient({
      agents: [
        { name: "build", mode: "primary", hidden: false, description: "Build agent" },
        { name: "thoth-custom", mode: "primary", hidden: false, description: "Custom agent" },
      ],
    });

    const client = new OpenCodeHarnessAdapter(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const { modes } = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/project",
      force: false,
    });

    expect(modes.map((mode) => mode.id)).toEqual(["build", "thoth-custom"]);
  });

  test("falls back to default OpenCode modes when discovery returns no modes", async () => {
    const { runtime } = mockOpenCodeClient({ agents: [] });

    const client = new OpenCodeHarnessAdapter(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const { modes } = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/project",
      force: false,
    });

    expect(modes.map((mode) => mode.id)).toEqual(["build", "plan"]);
  });

  test("lists auto accept as a provider feature", async () => {
    const { runtime } = mockOpenCodeClient();

    const client = new OpenCodeHarnessAdapter(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const enabledFeatures = await client.listFeatures({
      provider: "opencode",
      cwd: "/tmp/project",
      featureValues: { auto_accept: true },
    });
    const legacyFeatures = await client.listFeatures({
      provider: "opencode",
      cwd: "/tmp/project",
      modeId: "full-access",
    });

    expect(enabledFeatures).toEqual([
      expect.objectContaining({
        type: "toggle",
        id: "auto_accept",
        label: "Auto Accept",
        value: true,
      }),
    ]);
    expect(legacyFeatures).toEqual([expect.objectContaining({ id: "auto_accept", value: true })]);
  });

  test("keeps legacy full-access as an alias for build plus auto accept", async () => {
    const { openCodeClient, runtime } = mockOpenCodeClient();

    const client = new OpenCodeHarnessAdapter(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const session = await client.createSession({
      provider: "opencode",
      cwd: "/tmp/project",
      modeId: "full-access",
    });

    expect(await session.getCurrentMode()).toBe("build");
    expect(session.features).toEqual([expect.objectContaining({ id: "auto_accept", value: true })]);

    await session.run("Implement the change");

    expect(openCodeClient.calls.sessionPromptAsync).toHaveLength(1);
    expect(openCodeClient.calls.sessionPromptAsync[0]).toEqual(
      expect.objectContaining({ agent: "build" }),
    );

    await session.close();
  });

  test("resolves legacy full-access for provider-driven child creation", () => {
    const client = new OpenCodeHarnessAdapter(createTestLogger());

    expect(
      client.resolveCreateConfig({
        provider: "opencode",
        requestedMode: "full-access",
        featureValues: undefined,
        parent: null,
        unattended: false,
        availableModes: [
          { id: "build", label: "Build" },
          { id: "plan", label: "Plan" },
        ],
      }),
    ).toEqual({ modeId: "build", featureValues: { auto_accept: true } });
  });

  test("inherits unattended callers as build plus auto accept", () => {
    const client = new OpenCodeHarnessAdapter(createTestLogger());

    expect(
      client.resolveCreateConfig({
        provider: "opencode",
        requestedMode: undefined,
        featureValues: undefined,
        parent: {
          provider: "claude",
          modeId: "bypassPermissions",
          isUnattended: true,
        },
        unattended: true,
        availableModes: [
          { id: "build", label: "Build" },
          { id: "plan", label: "Plan" },
        ],
      }),
    ).toEqual({ modeId: "build", featureValues: { auto_accept: true } });
  });

  test("defaults unattended creation without a parent to build plus auto accept", () => {
    const client = new OpenCodeHarnessAdapter(createTestLogger());

    expect(
      client.resolveCreateConfig({
        provider: "opencode",
        requestedMode: undefined,
        featureValues: undefined,
        parent: null,
        unattended: true,
        availableModes: [
          { id: "build", label: "Build" },
          { id: "plan", label: "Plan" },
        ],
      }),
    ).toEqual({ modeId: "build", featureValues: { auto_accept: true } });
  });

  test("preserves the selected OpenCode agent when inheriting auto accept from an OpenCode parent", () => {
    const client = new OpenCodeHarnessAdapter(createTestLogger());

    expect(
      client.resolveCreateConfig({
        provider: "opencode",
        requestedMode: undefined,
        featureValues: undefined,
        parent: {
          provider: "opencode",
          modeId: "thoth-custom",
          isUnattended: true,
        },
        unattended: true,
        availableModes: [
          { id: "build", label: "Build" },
          { id: "plan", label: "Plan" },
          { id: "thoth-custom", label: "Thoth Custom" },
        ],
      }),
    ).toEqual({ modeId: "thoth-custom", featureValues: { auto_accept: true } });
  });

  test("inherits auto accept from an OpenCode parent when the child chooses a mode", () => {
    const client = new OpenCodeHarnessAdapter(createTestLogger());

    expect(
      client.resolveCreateConfig({
        provider: "opencode",
        requestedMode: "base",
        featureValues: undefined,
        parent: {
          provider: "opencode",
          modeId: "orchestrator",
          isUnattended: true,
        },
        unattended: true,
        availableModes: [
          { id: "build", label: "Build" },
          { id: "base", label: "Base" },
          { id: "orchestrator", label: "Orchestrator" },
        ],
      }),
    ).toEqual({ modeId: "base", featureValues: { auto_accept: true } });
  });

  test("auto-approves tool permissions when auto accept is enabled", async () => {
    const { openCodeClient, runtime } = mockOpenCodeClient({
      events: [toolPermissionEvent(), idleEvent()],
    });
    const receivedEvents: AgentStreamEvent[] = [];

    const client = new OpenCodeHarnessAdapter(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const session = await client.createSession(
      {
        provider: "opencode",
        cwd: "/tmp/project",
        featureValues: { auto_accept: true },
      },
      { agentId: "agent-opencode-question" },
    );
    session.subscribe((event) => receivedEvents.push(event));

    await session.run("Run verification");

    expect(openCodeClient.calls.permissionReply).toHaveLength(1);
    expect(openCodeClient.calls.permissionReply[0]).toEqual({
      requestID: "permission-1",
      directory: "/tmp/project",
      reply: "once",
    });
    expect(receivedEvents.filter((event) => event.type === "permission_requested")).toEqual([]);
    expect(session.getPendingPermissions()).toEqual([]);

    await session.close();
  });

  test("keeps questions separate from auto accept tool approval", async () => {
    const { openCodeClient, runtime } = mockOpenCodeClient({
      events: [questionEvent(), idleEvent()],
    });
    const receivedEvents: AgentStreamEvent[] = [];

    const client = new OpenCodeHarnessAdapter(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const session = await client.createSession(
      {
        provider: "opencode",
        cwd: "/tmp/project",
        featureValues: { auto_accept: true },
      },
      { agentId: "agent-opencode-question" },
    );
    session.subscribe((event) => receivedEvents.push(event));

    await session.run("Ask a question");

    expect(receivedEvents.filter((event) => event.type === "provider_question_requested")).toEqual([
      expect.objectContaining({
        question: expect.objectContaining({
          interactionId: "question-1",
          agentId: "agent-opencode-question",
          questions: [expect.objectContaining({ id: "question-1:0" })],
        }),
      }),
    ]);
    expect(session.getPendingPermissions()).toEqual([]);

    await session.respondToProviderQuestion?.("question-1", {
      type: "answer",
      answers: [{ questionId: "question-1:0", values: ["Proceed"] }],
    });

    expect(openCodeClient.calls.questionReply).toHaveLength(1);
    expect(openCodeClient.calls.questionReply[0]).toEqual({
      requestID: "question-1",
      directory: "/tmp/project",
      answers: [["Proceed"]],
    });
    expect(openCodeClient.calls.permissionReply).toEqual([]);
    expect(session.getPendingPermissions()).toEqual([]);

    await session.close();
  });

  test("clears a pending question when OpenCode resolves it outside Thoth", async () => {
    const { runtime } = mockOpenCodeClient({
      events: [questionEvent(), questionRepliedEvent(), idleEvent()],
    });
    const receivedEvents: AgentStreamEvent[] = [];

    const client = new OpenCodeHarnessAdapter(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const session = await client.createSession(
      { provider: "opencode", cwd: "/tmp/project" },
      { agentId: "agent-opencode-external-question" },
    );
    session.subscribe((event) => receivedEvents.push(event));

    await session.run("Ask and resolve a question externally");

    expect(receivedEvents.filter((event) => event.type === "provider_question_resolved")).toEqual([
      expect.objectContaining({
        interactionId: "question-1",
        status: "answered",
      }),
    ]);
    await expect(
      session.respondToProviderQuestion?.("question-1", {
        type: "answer",
        answers: [{ questionId: "question-1:0", values: ["Proceed"] }],
      }),
    ).rejects.toThrow("No pending OpenCode Provider question");

    await session.close();
  });

  test("preserves OpenCode closed-option questions without a free-write fallback", async () => {
    const { openCodeClient, runtime } = mockOpenCodeClient({
      events: [questionEvent({ custom: false }), idleEvent()],
    });
    const receivedEvents: AgentStreamEvent[] = [];

    const client = new OpenCodeHarnessAdapter(createTestLogger(), undefined, {
      serverManager: runtime,
      createClient: runtime.createClient,
    });
    const session = await client.createSession(
      {
        provider: "opencode",
        cwd: "/tmp/project",
      },
      { agentId: "agent-opencode-closed-question" },
    );
    session.subscribe((event) => receivedEvents.push(event));

    await session.run("Ask a question");

    expect(receivedEvents.filter((event) => event.type === "provider_question_requested")).toEqual([
      expect.objectContaining({
        question: expect.objectContaining({
          interactionId: "question-1",
          questions: [
            {
              id: "question-1:0",
              header: "Decision",
              prompt: "Which option should OpenCode use?",
              options: [
                {
                  value: "Proceed",
                  label: "Proceed",
                  description: "Continue with the change",
                },
              ],
              selectionMode: "single",
              allowOther: false,
              secret: false,
            },
          ],
        }),
      }),
    ]);

    await session.respondToProviderQuestion?.("question-1", {
      type: "answer",
      answers: [{ questionId: "question-1:0", values: ["Proceed"] }],
    });

    expect(openCodeClient.calls.questionReply).toEqual([
      {
        requestID: "question-1",
        directory: "/tmp/project",
        answers: [["Proceed"]],
      },
    ]);

    await session.close();
  });
});
