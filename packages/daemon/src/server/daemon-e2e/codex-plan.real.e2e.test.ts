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
        providerRunMode: "plan",
        ...getNativeCodexProviderConfig(),
      });
      expect(created.providerControl).toMatchObject({
        runMode: "plan",
        planCapability: { kind: "native" },
      });
      const threadId = created.persistence?.sessionId ?? created.runtimeInfo?.sessionId;
      expect(threadId).toBeTruthy();
      const initialControl = await client.getAgentProviderControl(created.id, { refresh: true });
      const defaultControl = await client.updateAgentProviderControl({
        agentId: created.id,
        runMode: "default",
        expectedRevision: initialControl.revision,
        commandId: "real-plan-default",
      });
      const planControl = await client.updateAgentProviderControl({
        agentId: created.id,
        runMode: "plan",
        expectedRevision: defaultControl.revision,
        commandId: "real-plan-native",
      });
      expect(planControl).toMatchObject({ runMode: "plan", revision: 2 });

      const send = await client.sendAgentMessage(
        created.id,
        [
          "Use native Plan mode to plan a direct response.",
          "After I approve Implement, reply exactly REAL_NATIVE_PLAN_IMPLEMENTED.",
          "Do not use tools and do not modify files.",
        ].join("\n"),
        { providerRunMode: "plan" },
      );
      expect(send.turnAck?.providerRunModeReceipt).toMatchObject({
        requestedMode: "plan",
        status: "applied",
      });
      await client.waitForFinish(created.id, TURN_TIMEOUT_MS);

      const beforeImplement = await client.fetchAgent({ agentId: created.id });
      const permission = beforeImplement?.agent.pendingPermissions.find(
        (item) => item.kind === "plan",
      );
      const beforeItems = await fetchTimelineItems(client, created.id);
      if (!permission) {
        throw new Error(
          `Native Plan produced no implementation permission. pending=${JSON.stringify(beforeImplement?.agent.pendingPermissions)} timeline=${JSON.stringify(beforeItems)}`,
        );
      }
      expect(permission.input).toEqual({ planId: expect.any(String) });
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
