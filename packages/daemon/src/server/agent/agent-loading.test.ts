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

function storedAgent(agentId: string): StoredAgentRecord {
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
    internal: true,
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
});
