import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { ExecutionService } from "./execution-service.js";
import { ensureAgentLoaded } from "./agent-loading.js";
import { AgentStorage, type StoredAgentRecord } from "./agent-storage.js";
import { SqliteAgentTimelineStore } from "./sqlite-agent-timeline-store.js";
import type { HarnessAdapter } from "@thoth/drivers/agent-runtime";
import { createTestHarnessAdapters } from "../test-utils/fake-harness-adapter.js";

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "thoth-agent-loading-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const unavailableRolloutClient: HarnessAdapter = {
  provider: "codex",
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsSessionListing: false,
    supportsDynamicModes: false,
    supportsMcpServers: false,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
  async createSession() {
    throw new Error("createSession should not run when durable history exists");
  },
  async resumeSession() {
    throw new Error("no rollout found for thread id archived-thread");
  },
  async fetchCatalog() {
    return { models: [], modes: [] };
  },
  async isAvailable() {
    return true;
  },
};

function storedAgent(agentId: string, options?: { internal?: boolean }): StoredAgentRecord {
  return {
    id: agentId,
    provider: "codex",
    cwd: process.cwd(),
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    labels: { surface: "thoth-loop", phase: "review" },
    lastStatus: "idle",
    config: null,
    persistence: { provider: "codex", sessionId: "archived-thread" },
    internal: options?.internal ?? true,
  };
}

describe("ensureAgentLoaded durable history fallback", () => {
  it("serves local timeline rows when a Codex thread can no longer resume", async () => {
    const root = createRoot();
    const agentId = "f4a7ca73-c728-4c7d-ae93-6d0f8e7af6ef";
    const logger = createTestLogger();
    const storage = new AgentStorage(path.join(root, "agents"), logger);
    const timeline = new SqliteAgentTimelineStore(root);
    await storage.upsert(storedAgent(agentId));
    await timeline.appendCommitted(agentId, {
      type: "assistant_message",
      text: "The foreground Plan+Exec output survives provider archive.",
    });
    const manager = new ExecutionService({
      adapters: { codex: unavailableRolloutClient },
      registry: storage,
      durableTimelineStore: timeline,
      logger,
    });

    const restored = await ensureAgentLoaded(agentId, {
      executionService: manager,
      agentStorage: storage,
      logger,
    });

    expect(restored).toMatchObject({ id: agentId, lifecycle: "closed", internal: true });
    expect(manager.fetchTimeline(agentId, { direction: "tail", limit: 0 }).rows).toEqual([
      expect.objectContaining({
        item: {
          type: "assistant_message",
          text: "The foreground Plan+Exec output survives provider archive.",
        },
      }),
    ]);
    timeline.close();
  });

  it("returns typed Plan unavailability for a visible history-only Agent", async () => {
    const root = createRoot();
    const agentId = "5dd7ecc7-4472-45bc-80fa-811d8772e0df";
    const logger = createTestLogger();
    const storage = new AgentStorage(path.join(root, "agents"), logger);
    const timeline = new SqliteAgentTimelineStore(root);
    await storage.upsert(storedAgent(agentId, { internal: false }));
    await timeline.appendCommitted(agentId, {
      type: "assistant_message",
      text: "Durable visible history remains readable.",
    });
    const manager = new ExecutionService({
      adapters: { codex: unavailableRolloutClient },
      registry: storage,
      durableTimelineStore: timeline,
      logger,
    });

    const restored = await ensureAgentLoaded(agentId, {
      executionService: manager,
      agentStorage: storage,
      logger,
    });
    const capability = await manager.refreshAgentPlanCapability(agentId);

    expect(restored).toMatchObject({ id: agentId, lifecycle: "closed", internal: false });
    expect(capability).toEqual({
      kind: "unavailable",
      reason:
        "Provider session could not be resumed. Restore the Provider session to detect native Plan capability.",
    });
    expect(manager.getAgentProviderControl(agentId)).toMatchObject({
      planCapability: capability,
    });
    expect(JSON.stringify(manager.getAgentProviderControl(agentId))).not.toContain("Unknown agent");
    expect(manager.fetchTimeline(agentId, { direction: "tail", limit: 0 }).rows).toEqual([
      expect.objectContaining({
        item: { type: "assistant_message", text: "Durable visible history remains readable." },
      }),
    ]);
    timeline.close();
  });

  it("retries the canonical resume path after a history-only recovery", async () => {
    const root = createRoot();
    const agentId = "914f2e49-c6ce-45dc-85a7-11634fa66a09";
    const logger = createTestLogger();
    const storage = new AgentStorage(path.join(root, "agents"), logger);
    const timeline = new SqliteAgentTimelineStore(root);
    await storage.upsert(storedAgent(agentId, { internal: false }));
    await timeline.appendCommitted(agentId, {
      type: "assistant_message",
      text: "History before Provider recovery.",
    });
    const baseAdapter = createTestHarnessAdapters().codex!;
    let resumeAttempts = 0;
    const recoveringAdapter: HarnessAdapter = {
      provider: baseAdapter.provider,
      capabilities: baseAdapter.capabilities,
      harnessCapabilities: baseAdapter.harnessCapabilities,
      createSession: (...args) => baseAdapter.createSession(...args),
      resumeSession: async (...args) => {
        resumeAttempts += 1;
        if (resumeAttempts === 1) throw new Error("Provider thread is temporarily unavailable");
        return await baseAdapter.resumeSession!(...args);
      },
      fetchCatalog: (...args) => baseAdapter.fetchCatalog(...args),
      isAvailable: (...args) => baseAdapter.isAvailable(...args),
    };
    const manager = new ExecutionService({
      adapters: { codex: recoveringAdapter },
      registry: storage,
      durableTimelineStore: timeline,
      logger,
    });

    const historyOnly = await ensureAgentLoaded(agentId, {
      executionService: manager,
      agentStorage: storage,
      logger,
    });
    expect(historyOnly.lifecycle).toBe("closed");
    expect(manager.hasRunnableSession(agentId)).toBe(false);

    const resumed = await ensureAgentLoaded(agentId, {
      executionService: manager,
      agentStorage: storage,
      logger,
    });
    expect(resumeAttempts).toBe(2);
    expect(resumed.lifecycle).not.toBe("closed");
    expect(manager.hasRunnableSession(agentId)).toBe(true);
    expect(await manager.refreshAgentPlanCapability(agentId)).not.toMatchObject({
      kind: "unavailable",
    });
    timeline.close();
  });
});
