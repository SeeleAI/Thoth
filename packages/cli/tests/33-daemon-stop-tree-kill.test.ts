#!/usr/bin/env npx tsx

/**
 * Regression: daemon stop is ownership-driven. The PID lock identifies the
 * supervisor owner; CLI stop must never scan and kill unrelated descendants.
 */

import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "zx";

$.verbose = false;

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
    await sleep(50);
    return poll();
  }
  return poll();
}

async function readPidFileNumber(filePath: string): Promise<number | null> {
  try {
    const raw = (await readFile(filePath, "utf-8")).trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function killIfRunning(pid: number | null): void {
  if (!pid || !isProcessRunning(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore cleanup races
  }
}

console.log("=== Daemon Stop Owner Signal Regression ===\n");

if (process.platform === "win32") {
  console.log("Skipping separate process-group regression on Windows");
  process.exit(0);
}

const thothHome = await mkdtemp(join(tmpdir(), "thoth-stop-tree-kill-"));
const childPidPath = join(thothHome, "descendant.pid");
let ownerProcess: ChildProcess | null = null;
let descendantPid: number | null = null;

try {
  await mkdir(thothHome, { recursive: true });

  console.log("Test 1: start daemon-owner fixture with a detached descendant");
  ownerProcess = spawn(
    process.execPath,
    [
      "-e",
      `
        const { spawn } = require("node:child_process");
        process.on("SIGTERM", () => {});
        const child = spawn(process.execPath, [
          "-e",
          ${JSON.stringify(`
            const fs = require("node:fs");
            process.on("SIGTERM", () => {});
            fs.writeFileSync(${JSON.stringify(childPidPath)}, String(process.pid));
            setInterval(() => {}, 1000);
          `)}
        ], { detached: true, stdio: "ignore" });
        child.unref();
        setInterval(() => {}, 1000);
      `,
    ],
    {
      stdio: "ignore",
    },
  );

  assert(ownerProcess.pid, "owner pid should exist");
  await writeFile(
    join(thothHome, "thoth.pid"),
    JSON.stringify({
      pid: ownerProcess.pid,
      listen: "127.0.0.1:1",
      startedAt: new Date().toISOString(),
    }),
  );

  await waitFor(
    async () => {
      descendantPid = await readPidFileNumber(childPidPath);
      return (
        isProcessRunning(ownerProcess?.pid ?? -1) &&
        descendantPid !== null &&
        isProcessRunning(descendantPid)
      );
    },
    5000,
    "owner descendant did not become running in time",
  );
  console.log(`✓ owner ${ownerProcess.pid} started descendant ${descendantPid}\n`);

  console.log("Test 2: forced daemon stop kills only the recorded owner");
  const stopResult =
    await $`THOTH_HOME=${thothHome} THOTH_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.THOTH_LOCAL_SPEECH_AUTO_DOWNLOAD} THOTH_DICTATION_ENABLED=${testEnv.THOTH_DICTATION_ENABLED} THOTH_VOICE_MODE_ENABLED=${testEnv.THOTH_VOICE_MODE_ENABLED} npx thoth daemon stop --home ${thothHome} --json --timeout 1 --force --kill-timeout 2`.nothrow();
  assert.strictEqual(stopResult.exitCode, 0, `stop should succeed: ${stopResult.stderr}`);
  const parsed = JSON.parse(stopResult.stdout) as {
    action?: unknown;
    forced?: unknown;
    usedLifecycleRpc?: unknown;
    reason?: unknown;
    message?: unknown;
  };
  assert.deepStrictEqual(
    {
      action: parsed.action,
      forced: parsed.forced,
      usedLifecycleRpc: parsed.usedLifecycleRpc,
      reason: parsed.reason,
      message: parsed.message,
    },
    {
      action: "stopped",
      forced: true,
      usedLifecycleRpc: false,
      reason: "owner_pid_sigkill",
      message: "Daemon owner process was force-stopped",
    },
    `stop should report forced owner cleanup: ${stopResult.stdout}`,
  );

  const ownerPid = ownerProcess.pid;
  await waitFor(
    () => !isProcessRunning(ownerPid ?? -1),
    5000,
    `owner (${ownerPid}) survived forced stop`,
  );
  assert(
    isProcessRunning(descendantPid ?? -1),
    "CLI stop must not discover and kill a process outside supervisor ownership",
  );
  console.log("✓ forced stop killed the owner without scanning descendants\n");
} finally {
  killIfRunning(ownerProcess?.pid ?? null);
  killIfRunning(descendantPid);
  await rm(thothHome, { recursive: true, force: true });
}

console.log("=== Daemon stop owner signal regression test passed ===");
