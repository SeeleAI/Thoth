import { fileURLToPath, pathToFileURL } from "url";
import { existsSync } from "node:fs";
import path from "node:path";
import pino from "pino";
import {
  acquirePidLock,
  PidLockError,
  releasePidLock,
  updatePidLock,
} from "../src/server/pid-lock.js";
import { resolveThothHome } from "../src/server/thoth-home.js";
import { loadPersistedConfig } from "../src/server/persisted-config.js";
import { runSupervisor } from "./supervisor.js";
import { resolveSupervisorLogFile } from "./supervisor-log-config.js";

process.title = "Thoth Supervisor";

interface DaemonRunnerConfig {
  devMode: boolean;
  workerArgs: string[];
}

function parseConfig(argv: string[]): DaemonRunnerConfig {
  let devMode = false;
  const workerArgs: string[] = [];

  for (const arg of argv) {
    if (arg === "--dev") {
      devMode = true;
      continue;
    }
    workerArgs.push(arg);
  }

  return { devMode, workerArgs };
}

function resolveWorkerEntry(): string {
  const candidates = [
    fileURLToPath(new URL("../server/server/daemon-worker.js", import.meta.url)),
    fileURLToPath(new URL("../dist/server/server/daemon-worker.js", import.meta.url)),
    fileURLToPath(new URL("../src/server/daemon-worker.ts", import.meta.url)),
    fileURLToPath(new URL("../../src/server/daemon-worker.ts", import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function resolveDevWorkerEntry(): string {
  const candidate = fileURLToPath(new URL("../src/server/daemon-worker.ts", import.meta.url));
  if (!existsSync(candidate)) {
    throw new Error(`Dev worker entry not found: ${candidate}`);
  }
  return candidate;
}

function resolveWorkerExecArgv(workerEntry: string, devMode: boolean): string[] {
  const execArgv = workerEntry.endsWith(".ts") ? ["--import", "tsx"] : [];
  if (!devMode) {
    return execArgv;
  }
  const devArgs = [
    "--heapsnapshot-near-heap-limit=3",
    "--max-old-space-size=3072",
    "--report-on-fatalerror",
    "--report-directory=/tmp/thoth-reports",
  ];
  const inspectArg = process.env.THOTH_NODE_INSPECT ?? "--inspect";
  if (inspectArg !== "0" && inspectArg !== "false" && inspectArg !== "off") {
    devArgs.push(inspectArg);
  }
  return [...devArgs, ...execArgv];
}

function resolvePackagedNodeEntrypointRunnerPath(currentScriptPath: string): string | null {
  const packageMarker = `${path.sep}node_modules${path.sep}@thoth${path.sep}daemon${path.sep}`;
  const markerIndex = currentScriptPath.lastIndexOf(packageMarker);
  if (markerIndex === -1) {
    return null;
  }

  const appRoot = currentScriptPath.slice(0, markerIndex);
  const runnerPath = path.join(appRoot, "dist", "daemon", "node-entrypoint-runner.js");
  return existsSync(runnerPath) ? runnerPath : null;
}

async function prepareStorageLayout(thothHome: string): Promise<void> {
  const candidates = [
    fileURLToPath(new URL("../server/server/storage-layout-migration.js", import.meta.url)),
    fileURLToPath(new URL("../src/server/storage-layout-migration.ts", import.meta.url)),
    fileURLToPath(new URL("../dist/server/server/storage-layout-migration.js", import.meta.url)),
  ];
  const entrypoint = candidates.find((candidate) => existsSync(candidate));
  if (!entrypoint) {
    throw new Error(`Storage layout migration module not found: ${candidates.join(", ")}`);
  }
  const migration = (await import(pathToFileURL(entrypoint).href)) as {
    ensureThothStorageLayout: (home: string, logger: ReturnType<typeof pino>) => Promise<unknown>;
  };
  await migration.ensureThothStorageLayout(thothHome, pino({ level: "silent" }));
}

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const workerEntry = config.devMode ? resolveDevWorkerEntry() : resolveWorkerEntry();
  const workerExecArgv = resolveWorkerExecArgv(workerEntry, config.devMode);
  const workerEnv: NodeJS.ProcessEnv = { ...process.env };
  const packagedNodeEntrypointRunner =
    process.env.ELECTRON_RUN_AS_NODE === "1"
      ? resolvePackagedNodeEntrypointRunnerPath(fileURLToPath(import.meta.url))
      : null;

  const thothHome = resolveThothHome(workerEnv);
  await prepareStorageLayout(thothHome);
  const persistedConfig = loadPersistedConfig(thothHome);
  const supervisorLogFile = resolveSupervisorLogFile(thothHome, persistedConfig, workerEnv);

  try {
    await acquirePidLock(thothHome, null, {
      ownerPid: process.pid,
    });
  } catch (error) {
    if (error instanceof PidLockError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
      return;
    }
    throw error;
  }

  let lockReleased = false;
  const releaseLock = async (): Promise<void> => {
    if (lockReleased) {
      return;
    }
    lockReleased = true;
    await releasePidLock(thothHome, {
      ownerPid: process.pid,
    });
  };

  runSupervisor({
    name: "DaemonRunner",
    startupMessage: "Starting daemon worker (IPC restart and crash restart enabled)",
    resolveWorkerEntry: () => workerEntry,
    workerArgs: config.workerArgs,
    workerEnv,
    workerExecArgv,
    resolveWorkerSpawnSpec: packagedNodeEntrypointRunner
      ? (resolvedWorkerEntry) => ({
          command: process.execPath,
          args: [
            packagedNodeEntrypointRunner,
            "node-script",
            resolvedWorkerEntry,
            ...config.workerArgs,
          ],
          env: {
            ...workerEnv,
            ELECTRON_RUN_AS_NODE: "1",
          },
        })
      : undefined,
    restartOnCrash: true,
    logFile: supervisorLogFile,
    onWorkerReady: async ({ listen }) => {
      await updatePidLock(thothHome, { listen }, { ownerPid: process.pid });
    },
    onSupervisorExit: releaseLock,
  });
}

void main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
