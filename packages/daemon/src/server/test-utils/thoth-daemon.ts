import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";

import pino from "pino";
import { createThothDaemon, type ThothDaemonConfig } from "../bootstrap.js";
import type { HarnessAdapter, AgentProvider } from "@thoth/drivers/agent-runtime";
import { createTestHarnessAdapters } from "./fake-harness-adapter.js";
import type { PushNotificationSender } from "../push/notifications.js";

interface TestThothDaemonOptions {
  downloadTokenTtlMs?: number;
  corsAllowedOrigins?: string[];
  listen?: string;
  logger?: Parameters<typeof createThothDaemon>[1];
  mcpEnabled?: boolean;
  mcpDebug?: boolean;
  isDev?: boolean;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  harnessAdapters?: Partial<Record<AgentProvider, HarnessAdapter>>;
  providerOverrides?: ThothDaemonConfig["providerOverrides"];
  thothHomeRoot?: string;
  staticDir?: string;
  cleanup?: boolean;
  auth?: ThothDaemonConfig["auth"];
  pushNotificationSender?: PushNotificationSender;
  serviceProxy?: ThothDaemonConfig["serviceProxy"];
  webUi?: ThothDaemonConfig["webUi"];
  trustedProxies?: ThothDaemonConfig["trustedProxies"];
}

export interface TestThothDaemon {
  config: ThothDaemonConfig;
  daemon: Awaited<ReturnType<typeof createThothDaemon>>;
  port: number;
  thothHome: string;
  staticDir: string;
  close: () => Promise<void>;
}

const TEST_DAEMON_START_TIMEOUT_MS = 20_000;

async function startDaemonWithTimeout(
  daemon: Awaited<ReturnType<typeof createThothDaemon>>,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      const timeoutError = new Error(
        `Timed out starting test daemon after ${timeoutMs}ms`,
      ) as Error & { code?: string };
      timeoutError.code = "TEST_DAEMON_START_TIMEOUT";
      reject(timeoutError);
    }, timeoutMs);

    daemon.start().then(
      () => {
        clearTimeout(timeoutHandle);
        resolve();
        return;
      },
      (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      },
    );
  });
}

export async function createTestThothDaemon(
  options: TestThothDaemonOptions = {},
): Promise<TestThothDaemon> {
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { config, thothHomeRoot, thothHome, staticDir } = await prepareTestDaemonConfig(options);
    const logger = options.logger ?? pino({ level: "silent" });
    const daemon = await createThothDaemon(config, logger);
    try {
      await startDaemonWithTimeout(daemon, TEST_DAEMON_START_TIMEOUT_MS);
      const listenTarget = daemon.getListenTarget();
      if (!listenTarget || listenTarget.type !== "tcp") {
        throw new Error("Test daemon did not expose a bound TCP listen target");
      }

      const close = async (): Promise<void> => {
        await daemon.stop().catch(() => undefined);
        await daemon.executionService.flush().catch(() => undefined);
        if (options.cleanup ?? true) {
          await new Promise((r) => setTimeout(r, 50));
          await Promise.all([
            rm(thothHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
            rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
          ]);
        }
      };

      return {
        config,
        daemon,
        port: listenTarget.port,
        thothHome,
        staticDir,
        close,
      };
    } catch (error) {
      lastError = error;
      await daemon.stop().catch(() => undefined);
      await Promise.all([
        rm(thothHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
        rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
      ]);

      if (
        (!isAddressInUseError(error) && !isStartupTimeoutError(error)) ||
        attempt === maxAttempts - 1
      ) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Failed to start test daemon");
}

interface PreparedTestDaemonConfig {
  config: ThothDaemonConfig;
  thothHomeRoot: string;
  thothHome: string;
  staticDir: string;
}

async function prepareTestDaemonConfig(
  options: TestThothDaemonOptions,
): Promise<PreparedTestDaemonConfig> {
  const thothHomeRoot =
    options.thothHomeRoot ?? (await mkdtemp(path.join(os.tmpdir(), "thoth-home-")));
  const thothHome = path.join(thothHomeRoot, ".thoth");
  await mkdir(thothHome, { recursive: true });
  const staticDir = options.staticDir ?? (await mkdtemp(path.join(os.tmpdir(), "thoth-static-")));
  const listenHost = options.listen ?? "127.0.0.1";
  const config: ThothDaemonConfig = {
    listen: `${listenHost}:0`,
    thothHome,
    corsAllowedOrigins: options.corsAllowedOrigins ?? [],
    hostnames: true,
    mcpEnabled: options.mcpEnabled ?? true,
    staticDir,
    mcpDebug: options.mcpDebug ?? false,
    isDev: options.isDev,
    harnessAdapters: options.harnessAdapters ?? createTestHarnessAdapters(),
    providerOverrides: options.providerOverrides,
    agentStoragePath: path.join(thothHome, "agents"),
    relayEnabled: options.relayEnabled ?? false,
    relayEndpoint: options.relayEndpoint ?? "relay.thoth.seeles.ai:443",
    appBaseUrl: "https://app.thoth.seeles.ai",
    auth: options.auth,
    pushNotificationSender: options.pushNotificationSender,
    serviceProxy: options.serviceProxy,
    webUi: options.webUi,
    trustedProxies: options.trustedProxies,
    downloadTokenTtlMs: options.downloadTokenTtlMs,
  };
  return { config, thothHomeRoot, thothHome, staticDir };
}

function isAddressInUseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "EADDRINUSE";
}

function isStartupTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "TEST_DAEMON_START_TIMEOUT";
}
