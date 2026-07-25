import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { ensureAgentLoaded } from "./agent/agent-loading.js";
import type { ThothDaemonConfig } from "./bootstrap.js";
import { WorkspaceAuthorityManager } from "./workspace-authority/workspace-authority-manager.js";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "./workspace-registry.js";

const originalEnv = {
  PATH: process.env.PATH,
  PATHEXT: process.env.PATHEXT,
};

describe("bootstrap provider availability", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    process.env.PATH = originalEnv.PATH;
    process.env.PATHEXT = originalEnv.PATHEXT;
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  test("loads a persisted Codex record without spawning a missing Codex binary", async () => {
    const { createThothDaemon } = await import("./bootstrap.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "thoth-bootstrap-provider-"));
    tempRoots.push(root);
    const binDir = await mkdtemp(path.join(os.tmpdir(), "thoth-bootstrap-provider-bin-"));
    tempRoots.push(binDir);
    process.env.PATH = binDir;
    if (process.platform === "win32") {
      process.env.PATHEXT = ".CMD";
    }
    const thothHome = path.join(root, ".thoth");
    const staticDir = path.join(root, "static");
    const agentStoragePath = path.join(thothHome, "agents");
    const now = new Date("2026-04-16T00:00:00.000Z").toISOString();
    const agentId = "11111111-1111-4111-8111-111111111111";
    await mkdir(staticDir, { recursive: true });
    const workspaceId = "workspace-bootstrap-provider";
    const projectId = "project-bootstrap-provider";
    const authority = new WorkspaceAuthorityManager(thothHome);
    authority.catalog.upsertProjectRecord(
      createPersistedProjectRecord({
        projectId,
        rootPath: root,
        kind: "non_git",
        displayName: "Bootstrap Provider",
        createdAt: now,
        updatedAt: now,
      }),
    );
    authority.catalog.upsertWorkspaceRecord(
      createPersistedWorkspaceRecord({
        workspaceId,
        projectId,
        cwd: root,
        kind: "directory",
        displayName: "Bootstrap Provider",
        createdAt: now,
        updatedAt: now,
      }),
    );
    authority.forWorkspace(workspaceId).upsertAgentRecord({
      id: agentId,
      provider: "codex",
      cwd: root,
      workspaceId,
      createdAt: now,
      updatedAt: now,
      labels: {},
      lastStatus: "idle",
      lastModeId: "auto",
      providerRunMode: "default",
      providerControlRevision: 0,
      config: {
        modeId: "auto",
        model: "gpt-5.4",
      },
      persistence: {
        provider: "codex",
        sessionId: "codex-session-1",
        metadata: {
          provider: "codex",
          cwd: root,
        },
      },
    });
    authority.close();

    const config: ThothDaemonConfig = {
      listen: "127.0.0.1:0",
      thothHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: false,
      staticDir,
      mcpDebug: false,
      harnessAdapters: {},
      agentStoragePath,
      relayEnabled: false,
      appBaseUrl: "https://app.thoth.seeles.ai",
      openai: undefined,
    };
    const processFailures: Error[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      processFailures.push(reason instanceof Error ? reason : new Error(String(reason)));
    };
    const onUncaughtException = (error: Error) => {
      processFailures.push(error);
    };
    process.on("unhandledRejection", onUnhandledRejection);
    process.on("uncaughtException", onUncaughtException);

    const daemon = await createThothDaemon(config, pino({ level: "silent" }));
    try {
      await expect(daemon.agentStorage.list()).resolves.toHaveLength(1);
      await expect(daemon.executionService.listProviderAvailability()).resolves.toContainEqual({
        provider: "codex",
        available: false,
        error: null,
      });
      await expect(
        ensureAgentLoaded(agentId, {
          executionService: daemon.executionService,
          agentStorage: daemon.agentStorage,
          logger: pino({ level: "silent" }),
        }),
      ).rejects.toThrow("Provider 'codex' is not available");
      await new Promise((resolve) => setImmediate(resolve));
      expect(processFailures).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      process.off("uncaughtException", onUncaughtException);
      await daemon.stop().catch(() => undefined);
      await daemon.executionService.flush().catch(() => undefined);
    }
  });
});
