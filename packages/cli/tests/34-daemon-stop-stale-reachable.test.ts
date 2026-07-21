#!/usr/bin/env npx tsx

/**
 * Regression: `thoth daemon stop` must use the lifecycle RPC for a reachable
 * supervised daemon even when its local PID lock has become stale.
 */

import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "zx";
import { getAvailablePort } from "./helpers/network.ts";

$.verbose = false;

const pollIntervalMs = 100;
const testEnv = {
  THOTH_LOCAL_SPEECH_AUTO_DOWNLOAD: process.env.THOTH_LOCAL_SPEECH_AUTO_DOWNLOAD ?? "0",
  THOTH_DICTATION_ENABLED: process.env.THOTH_DICTATION_ENABLED ?? "0",
  THOTH_VOICE_MODE_ENABLED: process.env.THOTH_VOICE_MODE_ENABLED ?? "0",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  async function poll(): Promise<void> {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(message);
    await sleep(pollIntervalMs);
    return poll();
  }

  return poll();
}

interface DaemonStatus {
  localDaemon: string | null;
  connectedDaemon: string | null;
  pid: number | null;
}

async function readDaemonStatus(thothHome: string): Promise<DaemonStatus> {
  const result =
    await $`THOTH_HOME=${thothHome} THOTH_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.THOTH_LOCAL_SPEECH_AUTO_DOWNLOAD} THOTH_DICTATION_ENABLED=${testEnv.THOTH_DICTATION_ENABLED} THOTH_VOICE_MODE_ENABLED=${testEnv.THOTH_VOICE_MODE_ENABLED} npx thoth daemon status --home ${thothHome} --json`.nothrow();
  if (result.exitCode !== 0) {
    return { localDaemon: null, connectedDaemon: null, pid: null };
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      localDaemon?: unknown;
      connectedDaemon?: unknown;
      pid?: unknown;
    };
    return {
      localDaemon: typeof parsed.localDaemon === "string" ? parsed.localDaemon : null,
      connectedDaemon: typeof parsed.connectedDaemon === "string" ? parsed.connectedDaemon : null,
      pid:
        typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0
          ? parsed.pid
          : null,
    };
  } catch {
    return { localDaemon: null, connectedDaemon: null, pid: null };
  }
}

function findUnusedPid(): number {
  for (let pid = 999_999; pid > 900_000; pid--) {
    if (!isProcessRunning(pid)) {
      return pid;
    }
  }
  throw new Error("Unable to find unused pid for stale pid fixture");
}

console.log("=== Daemon Stop (stale pid, reachable supervisor regression) ===\n");

const port = await getAvailablePort();
const thothHome = await mkdtemp(join(tmpdir(), "thoth-stop-stale-reachable-"));
const cliRoot = join(import.meta.dirname, "..");
const host = `127.0.0.1:${port}`;
const pidPath = join(thothHome, "thoth.pid");
const stalePid = findUnusedPid();

let supervisorProcess: ChildProcess | null = null;

try {
  console.log("Test 1: start supervised daemon, then replace its PID lock with a stale owner");

  supervisorProcess = spawn(
    process.execPath,
    ["--import", "tsx", "../daemon/scripts/supervisor-entrypoint.ts", "--dev"],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        ...testEnv,
        THOTH_HOME: thothHome,
        THOTH_LISTEN: host,
        THOTH_RELAY_ENABLED: "false",
        CI: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  await waitFor(
    async () => {
      const status = await readDaemonStatus(thothHome);
      return (
        status.localDaemon === "running" &&
        status.connectedDaemon === "reachable" &&
        status.pid === supervisorProcess?.pid
      );
    },
    120000,
    "supervised daemon did not become reachable in time",
  );

  await writeFile(
    pidPath,
    `${JSON.stringify(
      {
        pid: stalePid,
        startedAt: new Date().toISOString(),
        hostname: "stale-supervisor-fixture.local",
        uid: typeof process.getuid === "function" ? process.getuid() : undefined,
        listen: host,
      },
      null,
      2,
    )}\n`,
  );

  await waitFor(
    async () => {
      const status = await readDaemonStatus(thothHome);
      return status.localDaemon === "stale_pid" && status.connectedDaemon === "reachable";
    },
    15000,
    "daemon did not enter stale_pid + reachable state in time",
  );

  const statusBeforeStop = await readDaemonStatus(thothHome);
  assert.strictEqual(statusBeforeStop.pid, stalePid, "status should report the stale owner pid");
  assert(
    supervisorProcess.pid && isProcessRunning(supervisorProcess.pid),
    "supervisor should be running",
  );
  console.log(`✓ fixture has stale pid ${stalePid} and live supervisor ${supervisorProcess.pid}\n`);

  console.log("Test 2: `thoth daemon stop` should use lifecycle shutdown despite the stale lock");
  const stopResult =
    await $`THOTH_HOME=${thothHome} THOTH_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.THOTH_LOCAL_SPEECH_AUTO_DOWNLOAD} THOTH_DICTATION_ENABLED=${testEnv.THOTH_DICTATION_ENABLED} THOTH_VOICE_MODE_ENABLED=${testEnv.THOTH_VOICE_MODE_ENABLED} npx thoth daemon stop --home ${thothHome} --json`.nothrow();
  assert.strictEqual(stopResult.exitCode, 0, `stop should succeed: ${stopResult.stderr}`);
  const stopJson = JSON.parse(stopResult.stdout) as {
    action?: unknown;
    pid?: unknown;
    message?: unknown;
  };
  assert.strictEqual(stopJson.action, "stopped", "stop should report stopped action");
  assert.strictEqual(
    stopJson.pid,
    String(stalePid),
    "stop should report the stale pid it recovered from",
  );
  assert.strictEqual(
    stopJson.message,
    "Daemon stopped gracefully",
    "stop should route through lifecycle shutdown",
  );

  await waitFor(
    () => !isProcessRunning(supervisorProcess?.pid ?? -1),
    15000,
    "supervisor remained running after lifecycle stop",
  );
  assert.strictEqual(existsSync(pidPath), false, "stale pid file should be removed after stop");
  console.log("✓ stop recovered stale supervisor pid state\n");
} finally {
  if (supervisorProcess?.pid && isProcessRunning(supervisorProcess.pid)) {
    supervisorProcess.kill("SIGTERM");
    await waitFor(
      () => !isProcessRunning(supervisorProcess!.pid ?? -1),
      5000,
      "supervisor cleanup timed out",
    ).catch(() => {
      supervisorProcess?.kill("SIGKILL");
    });
  }

  await $`THOTH_HOME=${thothHome} THOTH_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.THOTH_LOCAL_SPEECH_AUTO_DOWNLOAD} THOTH_DICTATION_ENABLED=${testEnv.THOTH_DICTATION_ENABLED} THOTH_VOICE_MODE_ENABLED=${testEnv.THOTH_VOICE_MODE_ENABLED} npx thoth daemon stop --home ${thothHome} --force`.nothrow();
  await rm(thothHome, { recursive: true, force: true });
}

console.log("=== Stale reachable stop regression test passed ===");
