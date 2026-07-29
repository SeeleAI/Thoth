import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestThothDaemon, type TestThothDaemon } from "../test-utils/thoth-daemon.js";
import {
  canRunNativeCodexProvider,
  createNativeCodexProviderClient,
  getNativeCodexProviderConfig,
} from "./real-provider-test-config.js";
import { fetchTimelineItems } from "./test-utils/rewind-helpers.js";

const TURN_TIMEOUT_MS = 240_000;

async function waitForAssistantMarker(
  client: DaemonClient,
  agentId: string,
  marker: string,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const items = await fetchTimelineItems(client, agentId);
    if (items.some((item) => item.type === "assistant_message" && item.text.includes(marker))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for assistant marker ${marker}`);
}

async function waitForProviderQuestion(client: DaemonClient, agentId: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const snapshot = await client.fetchAgent({ agentId });
    const question = snapshot?.agent.pendingProviderQuestions?.[0];
    if (question) return question;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for native Provider question");
}

async function waitForThothLifecycle(
  client: DaemonClient,
  agentId: string,
  lifecycle: "awaiting_card" | "awaiting_implementation" | "interrupted" | "canceled",
) {
  const deadline = Date.now() + 120_000;
  let lastState: Awaited<ReturnType<DaemonClient["getAgentThothState"]>> | null = null;
  while (Date.now() < deadline) {
    const state = await client.getAgentThothState(agentId);
    lastState = state;
    if (state.state.lifecycle === lifecycle) return state.state;
    if (
      lifecycle === "awaiting_card" &&
      ["done", "interrupted", "canceled", "unsupported"].includes(state.state.lifecycle)
    ) {
      throw new Error(
        await formatAgentDiagnostics(
          client,
          agentId,
          `Foreground turn settled as ${state.state.lifecycle} before producing a Clarify card`,
          state,
        ),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    await formatAgentDiagnostics(
      client,
      agentId,
      `Timed out waiting for foreground lifecycle ${lifecycle}`,
      lastState,
    ),
  );
}

async function waitForPlanPermission(client: DaemonClient, agentId: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const snapshot = await client.fetchAgent({ agentId });
    const permission = snapshot?.agent.pendingPermissions.find((item) => item.kind === "plan");
    if (permission) return permission;
    const state = await client.getAgentThothState(agentId);
    if (["interrupted", "canceled", "unsupported"].includes(state.state.lifecycle)) {
      throw new Error(
        await formatAgentDiagnostics(
          client,
          agentId,
          `Plan turn settled as ${state.state.lifecycle} before opening Implement`,
          state,
        ),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    await formatAgentDiagnostics(
      client,
      agentId,
      "Timed out waiting for Daemon-owned Implement permission",
      await client.getAgentThothState(agentId),
    ),
  );
}

async function formatAgentDiagnostics(
  client: DaemonClient,
  agentId: string,
  reason: string,
  state: Awaited<ReturnType<DaemonClient["getAgentThothState"]>> | null,
): Promise<string> {
  const [snapshot, timeline] = await Promise.all([
    client.fetchAgent({ agentId }).catch((error: unknown) => ({
      diagnosticError: error instanceof Error ? error.message : String(error),
    })),
    fetchTimelineItems(client, agentId).catch((error: unknown) => [
      {
        diagnosticError: error instanceof Error ? error.message : String(error),
      },
    ]),
  ]);
  return [
    reason,
    `thothState=${JSON.stringify(state)}`,
    `agentSnapshot=${JSON.stringify(snapshot)}`,
    `timeline=${JSON.stringify(timeline)}`,
  ].join("\n");
}

describe("daemon E2E (real codex) - native Plan", () => {
  let canRun = false;
  let daemon: TestThothDaemon | undefined;
  let client: DaemonClient | undefined;
  let cwd: string | undefined;

  beforeAll(async () => {
    canRun = await canRunNativeCodexProvider();
    if (!canRun) return;
    const logger = pino({ level: "silent" });
    daemon = await createTestThothDaemon({
      harnessAdapters: { codex: createNativeCodexProviderClient(logger) },
      logger,
    });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.0.0-mvp-beta",
    });
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "codex-plan-real" } });
    cwd = await mkdtemp(path.join(tmpdir(), "thoth-real-codex-plan-"));
  }, 30_000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await daemon?.close().catch(() => undefined);
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  test(
    "publishes native capability, persists Plan, and implements on the same thread",
    async (context) => {
      if (!canRun || !client || !cwd) {
        context.skip();
        return;
      }
      const created = await client.createAgent({
        cwd,
        title: "Real native Plan acceptance",
        providerRunMode: "default",
        ...getNativeCodexProviderConfig(),
      });
      expect(created.providerControl).toMatchObject({
        runMode: "default",
        planCapability: { kind: "native" },
      });
      const threadId = created.persistence?.sessionId ?? created.runtimeInfo?.sessionId;
      expect(threadId).toBeTruthy();
      await client.sendAgentMessage(
        created.id,
        [
          "Use the active thoth.clarify Skill for this turn.",
          "Ask one Clarify card choosing between keeping or changing a sample API.",
          "Do not implement anything.",
        ].join("\n"),
        {
          thoth: {
            enabled: true,
            executionMode: "quick",
            clarifyStrength: "balanced",
          },
          providerRunMode: "default",
        },
      );
      await waitForThothLifecycle(client, created.id, "awaiting_card");
      await client.cancelAgent(created.id);
      await waitForThothLifecycle(client, created.id, "canceled");

      const initialControl = await client.getAgentProviderControl(created.id, { refresh: true });
      const planControl = await client.updateAgentProviderControl({
        agentId: created.id,
        runMode: "plan",
        expectedRevision: initialControl.revision,
        commandId: "real-plan-native",
      });
      expect(planControl).toMatchObject({ runMode: "plan" });

      const send = await client.sendAgentMessage(
        created.id,
        [
          "Thoth is off for this turn. Use native Plan mode for the current goal only.",
          "Before completing the Plan, call native request_user_input to ask which target to use: Local or CI.",
          "After the structured answer, produce a Plan for reporting the selected target.",
          "After I approve Implement, reply exactly REAL_NATIVE_PLAN_IMPLEMENTED.",
          "Do not modify files during the Plan turn.",
        ].join("\n"),
        { thoth: { enabled: false }, providerRunMode: "plan" },
      );
      expect(send.turnAck?.providerRunModeReceipt).toMatchObject({
        requestedMode: "plan",
        status: "applied",
      });
      const question = await waitForProviderQuestion(client, created.id);
      expect(question.providerThreadId).toBe(threadId);
      expect(question.questions).not.toHaveLength(0);
      const nativeQuestion = question.questions[0]!;
      const selectedValue = nativeQuestion.options[0]?.value;
      if (!selectedValue) throw new Error("Native Provider question exposed no selectable option");
      const selectedTarget = selectedValue.replace(/\s+\(Recommended\)$/iu, "");
      const questionResult = await client.respondProviderQuestionAndWait({
        agentId: created.id,
        interactionId: question.interactionId,
        expectedRevision: question.revision,
        commandId: "real-native-plan-question",
        resolution: {
          type: "answer",
          answers: [{ questionId: nativeQuestion.id, values: [selectedValue] }],
        },
        timeout: 30_000,
      });
      expect(questionResult).toMatchObject({ accepted: true, error: null });
      await waitForThothLifecycle(client, created.id, "awaiting_implementation");

      const beforeImplement = await client.fetchAgent({ agentId: created.id });
      const permission = await waitForPlanPermission(client, created.id);
      const beforeItems = await fetchTimelineItems(client, created.id);
      expect(beforeImplement?.agent.pendingProviderQuestions).toEqual([]);
      expect(permission.input?.plan).toEqual(expect.any(String));
      expect(String(permission.input?.plan)).toContain(selectedTarget);
      expect(String(permission.input?.plan)).not.toContain("Clarify card");
      expect(
        beforeItems.filter((item) => item.type === "tool_call" && item.detail.type === "plan"),
      ).toHaveLength(1);

      await client.respondToPermissionAndWait(
        created.id,
        permission!.id,
        { behavior: "allow", selectedActionId: "implement" },
        30_000,
      );
      await waitForAssistantMarker(client, created.id, "REAL_NATIVE_PLAN_IMPLEMENTED");
      await client.waitForFinish(created.id, TURN_TIMEOUT_MS);
      const final = await client.fetchAgent({ agentId: created.id });
      expect(final?.agent.persistence?.sessionId ?? final?.agent.runtimeInfo?.sessionId).toBe(
        threadId,
      );
      const finalItems = await fetchTimelineItems(client, created.id);
      expect(
        finalItems.filter((item) => item.type === "tool_call" && item.detail.type === "plan"),
      ).toHaveLength(1);
      if (
        !finalItems.some(
          (item) =>
            item.type === "assistant_message" && item.text.includes("REAL_NATIVE_PLAN_IMPLEMENTED"),
        )
      ) {
        throw new Error(
          `Plan implementation did not complete. timeline=${JSON.stringify(finalItems)}`,
        );
      }
    },
    TURN_TIMEOUT_MS,
  );
});
