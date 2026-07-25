/**
 * Test Daemon Helper
 *
 * Provides utilities for launching real Thoth daemons in E2E tests.
 * Each test gets an isolated daemon on an available local port with its own THOTH_HOME.
 *
 * CRITICAL RULES (from design doc):
 * 1. Port: Use an available ephemeral local port - NEVER use 6767 (production)
 * 2. Protocol: WebSocket ONLY - daemon has no HTTP endpoints
 * 3. Temp dirs: Create temp directories for THOTH_HOME and agent --cwd
 * 4. Model: Always use claude provider with haiku model for fast, cheap tests
 * 5. Cleanup: Kill daemon and remove temp dirs after each test
 */

import { mkdtemp, rm } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ChildProcess, spawn } from "child_process";
import { getAvailablePort } from "./network.ts";
import { connectToDaemon } from "../../src/utils/client.ts";

export interface TestDaemonContext {
  /** Available local port for test daemon (never 6767) */
  port: number;
  /** WebSocket URL for connecting to daemon */
  wsUrl: string;
  /** Temp directory for THOTH_HOME */
  thothHome: string;
  /** Temp directory for agent working directory */
  workDir: string;
  /** Running daemon process */
  process: ChildProcess | null;
  /** Whether the daemon is ready to accept connections */
  isReady: boolean;
  /** Stop the daemon and clean up resources */
  stop: () => Promise<void>;
}

const TEST_DAEMON_ENV_DEFAULTS: Record<string, string> = {
  THOTH_RELAY_ENABLED: "false",
};
const TEST_DAEMON_HOST = "127.0.0.1";

const DEFAULT_OUTPUT_CAPTURE_LIMIT = 256 * 1024;
const TEST_OUTPUT_CAPTURE_LIMIT = Number.parseInt(
  process.env.THOTH_TEST_OUTPUT_CAPTURE_BYTES ?? `${DEFAULT_OUTPUT_CAPTURE_LIMIT}`,
  10,
);

interface OutputCapture {
  value: string;
  truncated: boolean;
}

function createOutputCapture(): OutputCapture {
  return { value: "", truncated: false };
}

function appendOutputCapture(target: OutputCapture, chunk: Buffer): void {
  const next = target.value + chunk.toString();
  if (next.length <= TEST_OUTPUT_CAPTURE_LIMIT) {
    target.value = next;
    return;
  }
  target.truncated = true;
  target.value = next.slice(next.length - TEST_OUTPUT_CAPTURE_LIMIT);
}

function formatOutputCapture(target: OutputCapture): string {
  if (!target.truncated) {
    return target.value;
  }
  return `[truncated; showing last ${TEST_OUTPUT_CAPTURE_LIMIT} chars]\n${target.value}`;
}

function readNodeErrnoCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

function signalProcessTree(pid: number, signal: NodeJS.Signals): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (error) {
      const code = readNodeErrnoCode(error);
      if (code === "ESRCH") {
        return false;
      }
    }
  }

  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    const code = readNodeErrnoCode(error);
    if (code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function terminateProcessTree(processRef: ChildProcess, timeoutMs: number): Promise<void> {
  const pid = processRef.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  if (processRef.exitCode !== null || processRef.signalCode !== null) {
    return;
  }

  signalProcessTree(pid, "SIGTERM");

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    const onExit = () => {
      clearTimeout(timeoutId);
      done();
    };
    const timeoutId = setTimeout(() => {
      signalProcessTree(pid, "SIGKILL");
      processRef.removeListener("exit", onExit);
      done();
    }, timeoutMs);
    processRef.once("exit", onExit);
  });
}

/**
 * Generate a random port for test daemon
 * Uses range 20000-30000 to avoid conflicts
 * NEVER uses 6767 (user's running daemon)
 */
export function getRandomPort(): number {
  return 20000 + Math.floor(Math.random() * 10000);
}

/**
 * Create isolated temp directories for testing
 */
export async function createTempDirs(): Promise<{ thothHome: string; workDir: string }> {
  const thothHome = await mkdtemp(join(tmpdir(), "thoth-e2e-home-"));
  const workDir = await mkdtemp(join(tmpdir(), "thoth-e2e-work-"));

  return { thothHome, workDir };
}

/**
 * Wait for daemon to be ready by running `thoth agent ls`
 * This connects via WebSocket and ensures the daemon is responsive
 */
async function probeDaemonReady(port: number): Promise<boolean> {
  try {
    const { exitCode } = await runThothCli(
      {
        port,
        wsUrl: `ws://${TEST_DAEMON_HOST}:${port}`,
        thothHome: "",
        workDir: "",
        process: null,
        isReady: false,
        stop: async () => {},
      },
      ["agent", "ls"],
    );
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function waitForDaemonReady(port: number, timeout = 30000): Promise<void> {
  const deadline = Date.now() + timeout;

  async function poll(): Promise<void> {
    if (await probeDaemonReady(port)) return;
    if (Date.now() >= deadline) {
      throw new Error(`Daemon failed to become ready on port ${port} within ${timeout}ms`);
    }
    await sleep(100);
    return poll();
  }

  return poll();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start a test daemon programmatically using the server's bootstrap API
 *
 * This starts the daemon in a separate process using the CLI's daemon start command
 * with isolated THOTH_HOME and THOTH_LISTEN environment variables.
 */
export async function startTestDaemon(options?: {
  port?: number;
  thothHome?: string;
  workDir?: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<TestDaemonContext> {
  const port = options?.port ?? (await getAvailablePort());
  const { thothHome, workDir } =
    options?.thothHome && options?.workDir
      ? { thothHome: options.thothHome, workDir: options.workDir }
      : await createTempDirs();
  const timeout = options?.timeout ?? 30000;

  const wsUrl = `ws://${TEST_DAEMON_HOST}:${port}`;

  // The suite builds the complete CLI stack before running tests. Exercise that
  // exact compiled entry instead of recompiling source through nested npx calls.
  const cliDir = join(import.meta.dirname, "..", "..");
  const cliEntryPath = join(cliDir, "dist", "index.js");

  const daemonProcess = spawn(process.execPath, [cliEntryPath, "daemon", "start", "--foreground"], {
    env: {
      ...process.env,
      ...TEST_DAEMON_ENV_DEFAULTS,
      THOTH_HOME: thothHome,
      THOTH_LISTEN: `${TEST_DAEMON_HOST}:${port}`,
      // Force no TTY to prevent QR code output
      CI: "true",
      ...options?.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  const stdout = createOutputCapture();
  const stderr = createOutputCapture();

  daemonProcess.stdout?.on("data", (data) => {
    appendOutputCapture(stdout, data);
  });

  daemonProcess.stderr?.on("data", (data) => {
    appendOutputCapture(stderr, data);
  });

  const cleanup = async () => {
    if (daemonProcess) {
      await terminateProcessTree(daemonProcess, 5000);
    }

    // Clean up temp directories
    try {
      if (existsSync(thothHome)) {
        await rm(thothHome, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }

    try {
      if (existsSync(workDir)) {
        await rm(workDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  };

  // Handle process errors
  daemonProcess.on("error", (err) => {
    console.error("Daemon process error:", err);
  });

  daemonProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Daemon process exited with code ${code}`);
      const stderrText = formatOutputCapture(stderr);
      if (stderrText) {
        console.error("Daemon stderr:", stderrText);
      }
    }
  });

  const ctx: TestDaemonContext = {
    port,
    wsUrl,
    thothHome,
    workDir,
    process: daemonProcess,
    isReady: false,
    stop: cleanup,
  };

  // Wait for daemon to be ready
  try {
    await waitForDaemonReady(port, timeout);
    ctx.isReady = true;
  } catch (err) {
    // Daemon failed to start - clean up and rethrow
    await cleanup();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to start test daemon: ${message}\nStdout: ${formatOutputCapture(stdout)}\nStderr: ${formatOutputCapture(stderr)}`,
      { cause: err },
    );
  }

  return ctx;
}

/**
 * Run a thoth CLI command against a test daemon
 *
 * This is a helper that sets the correct environment variables
 * to point at the test daemon.
 */
export async function runThothCli(
  ctx: TestDaemonContext,
  args: string[],
  options?: {
    timeout?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const timeout = options?.timeout ?? 60000;
  const cwd = options?.cwd ?? ctx.workDir;

  const cliDir = join(import.meta.dirname, "..", "..");
  const cliEntryPath = join(cliDir, "dist", "index.js");

  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [cliEntryPath, ...args], {
      env: {
        ...process.env,
        ...TEST_DAEMON_ENV_DEFAULTS,
        THOTH_HOST: `${TEST_DAEMON_HOST}:${ctx.port}`,
        THOTH_HOME: ctx.thothHome,
        ...options?.env,
      },
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    const stdout = createOutputCapture();
    const stderr = createOutputCapture();

    proc.stdout?.on("data", (data) => {
      appendOutputCapture(stdout, data);
    });

    proc.stderr?.on("data", (data) => {
      appendOutputCapture(stderr, data);
    });

    const timeoutId = setTimeout(() => {
      if (proc.pid) {
        signalProcessTree(proc.pid, "SIGKILL");
      }
      reject(new Error(`CLI command timed out after ${timeout}ms: thoth ${args.join(" ")}`));
    }, timeout);

    proc.on("exit", (code) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: code ?? 1,
        stdout: formatOutputCapture(stdout),
        stderr: formatOutputCapture(stderr),
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Create a test context that includes a started daemon
 * and a helper to run CLI commands against it.
 *
 * This is the main entry point for E2E tests.
 */
export async function createE2ETestContext(options?: {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<
  TestDaemonContext & {
    /** Run a thoth CLI command against this daemon */
    thoth: (
      args: string[],
      opts?: { timeout?: number; cwd?: string; env?: NodeJS.ProcessEnv },
    ) => Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>;
    createWorkspace: () => Promise<string>;
  }
> {
  const ctx = await startTestDaemon({ timeout: options?.timeout, env: options?.env });

  const thoth = (
    args: string[],
    opts?: { timeout?: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ) => runThothCli(ctx, args, opts);

  const createWorkspace = async (): Promise<string> => {
    const previousHome = process.env.THOTH_HOME;
    process.env.THOTH_HOME = ctx.thothHome;
    let client: Awaited<ReturnType<typeof connectToDaemon>> | undefined;
    try {
      client = await connectToDaemon({ host: `${TEST_DAEMON_HOST}:${ctx.port}` });
      const result = await client.createWorkspace({
        source: { kind: "directory", path: ctx.workDir },
        title: "CLI Test Workspace",
      });
      if (!result.workspace || result.error) {
        throw new Error(result.error ?? "Workspace creation returned no workspace");
      }
      return result.workspace.id;
    } finally {
      await client?.close();
      if (previousHome === undefined) delete process.env.THOTH_HOME;
      else process.env.THOTH_HOME = previousHome;
    }
  };

  return {
    ...ctx,
    thoth,
    createWorkspace,
  };
}
