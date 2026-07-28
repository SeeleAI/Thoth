import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, describe, expect, test } from "vitest";
import type {
  ListWorkspaceScriptsRequest,
  SessionOutboundMessage,
  StartWorkspaceScriptRequest,
  StopWorkspaceScriptRequest,
} from "../../messages.js";
import { createServiceProxySubsystem, type ServiceProxySubsystem } from "../../service-proxy.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "../../workspace-registry.js";
import type { WorkspaceGitMetadata } from "../../workspace-git-metadata.js";
import { WorkspaceScriptRuntimeStore } from "../../workspace-script-runtime-store.js";
import type { WorkspaceServicePortRegistry } from "../../workspace-service-port-registry.js";
import type {
  SpawnWorkspaceScriptOptions,
  WorktreeScriptResult,
} from "../../worktree-bootstrap.js";
import { createWorkspaceScriptsService } from "./workspace-scripts-service.js";

const logger = pino({ level: "silent" });
const tempDirs: string[] = [];

const gitMetadata: WorkspaceGitMetadata = {
  projectKind: "git",
  projectDisplayName: "repo",
  workspaceDisplayName: "repo",
  gitRemote: null,
  isWorktree: false,
  projectSlug: "thoth",
  repoRoot: "/tmp/repo",
  currentBranch: "feature/scripts",
  remoteUrl: null,
};

function fakeWorkspaceRegistry(
  record: PersistedWorkspaceRecord | null,
): Pick<WorkspaceRegistry, "get"> {
  return {
    async get() {
      return record;
    },
  };
}

function fakeGitService(metadata: WorkspaceGitMetadata = gitMetadata) {
  return {
    peekSnapshot() {
      return null;
    },
    async getWorkspaceGitMetadata() {
      return metadata;
    },
  };
}

function createWorkspaceDirectory(scripts: Record<string, Record<string, unknown>> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "workspace-scripts-service-"));
  tempDirs.push(directory);
  writeFileSync(join(directory, "thoth.json"), JSON.stringify({ scripts }));
  return directory;
}

interface BuildOptions {
  serviceProxy?: ServiceProxySubsystem | null;
  scriptRuntimeStore?: WorkspaceScriptRuntimeStore | null;
  terminalManager?: TerminalManager | null;
  workspace?: PersistedWorkspaceRecord | null;
  scripts?: Record<string, Record<string, unknown>>;
  spawnThrows?: string;
  terminalPresent?: boolean;
}

function buildService(options: BuildOptions = {}) {
  const emitted: SessionOutboundMessage[] = [];
  const spawnCalls: SpawnWorkspaceScriptOptions[] = [];
  const killCalls: string[] = [];
  const releaseCalls: Array<{ workspaceId: string; scriptName: string }> = [];
  const directory = createWorkspaceDirectory(
    options.scripts ?? { app: { command: "npm run app", type: "script" } },
  );
  const workspace =
    options.workspace === undefined
      ? ({ workspaceId: "ws-1", cwd: directory } as PersistedWorkspaceRecord)
      : options.workspace;
  const serviceProxy =
    options.serviceProxy === undefined
      ? createServiceProxySubsystem({ logger })
      : options.serviceProxy;
  const scriptRuntimeStore =
    options.scriptRuntimeStore === undefined
      ? new WorkspaceScriptRuntimeStore()
      : options.scriptRuntimeStore;
  const terminalManager =
    options.terminalManager === undefined
      ? ({
          getTerminal(terminalId: string) {
            if (options.terminalPresent === false) return undefined;
            return {
              async killAndWait() {
                killCalls.push(terminalId);
              },
            };
          },
        } as unknown as TerminalManager)
      : options.terminalManager;
  const servicePortRegistry = {
    async releaseForWorkspaceScript(input: { workspaceId: string; scriptName: string }) {
      releaseCalls.push(input);
    },
  } as WorkspaceServicePortRegistry;

  const service = createWorkspaceScriptsService({
    serviceProxy,
    scriptRuntimeStore,
    servicePortRegistry,
    terminalManager,
    workspaceRegistry: fakeWorkspaceRegistry(workspace),
    workspaceGitService: fakeGitService(),
    getDaemonTcpPort: () => 6688,
    getDaemonTcpHost: () => "127.0.0.1",
    serviceProxyPublicBaseUrl: null,
    resolveScriptHealth: null,
    logger,
    emit: (message) => emitted.push(message),
    async spawnWorkspaceScript(spawnOptions): Promise<WorktreeScriptResult> {
      spawnCalls.push(spawnOptions);
      if (options.spawnThrows) {
        throw new Error(options.spawnThrows);
      }
      scriptRuntimeStore?.set({
        workspaceId: spawnOptions.workspaceId,
        scriptName: spawnOptions.scriptName,
        type: "script",
        lifecycle: "running",
        terminalId: "terminal-1",
        exitCode: null,
      });
      spawnOptions.onLifecycleChanged?.();
      return {
        scriptName: spawnOptions.scriptName,
        hostname: null,
        port: null,
        terminalId: "terminal-1",
      };
    },
  });

  return {
    service,
    emitted,
    spawnCalls,
    killCalls,
    releaseCalls,
    directory,
    serviceProxy,
    scriptRuntimeStore,
  };
}

const listRequest: ListWorkspaceScriptsRequest = {
  type: "workspace.script.list.request",
  workspaceId: "ws-1",
  requestId: "req-list",
};

const startRequest: StartWorkspaceScriptRequest = {
  type: "workspace.script.start.request",
  workspaceId: "ws-1",
  scriptName: "app",
  requestId: "req-start",
};

const stopRequest: StopWorkspaceScriptRequest = {
  type: "workspace.script.stop.request",
  workspaceId: "ws-1",
  scriptName: "app",
  requestId: "req-stop",
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("workspace script snapshots", () => {
  test("returns no scripts when the service proxy is unavailable", () => {
    const { service } = buildService({ serviceProxy: null });
    expect(service.buildSnapshot("ws-1", "/tmp/repo")).toEqual([]);
  });

  test("returns no scripts when the runtime store is unavailable", () => {
    const { service } = buildService({ scriptRuntimeStore: null });
    expect(service.buildSnapshot("ws-1", "/tmp/repo")).toEqual([]);
  });

  test("emits one script_status_update carrying the canonical snapshot", () => {
    const { service, emitted, directory } = buildService();
    service.emitStatusUpdate("ws-1", directory);
    expect(emitted).toEqual([
      {
        type: "script_status_update",
        payload: {
          workspaceId: "ws-1",
          scripts: [expect.objectContaining({ scriptName: "app", command: "npm run app" })],
        },
      },
    ]);
  });
});

describe("list", () => {
  test("lists configured scripts through the Workspace-scoped semantic operation", async () => {
    const { service, emitted } = buildService({
      scripts: {
        app: { command: "npm run app", type: "script" },
        web: { command: "npm run web", type: "service", port: 3000 },
      },
    });
    await service.list(listRequest);
    expect(emitted).toEqual([
      {
        type: "workspace.script.list.response",
        payload: {
          requestId: "req-list",
          workspaceId: "ws-1",
          scripts: [
            expect.objectContaining({ scriptName: "app", command: "npm run app", type: "script" }),
            expect.objectContaining({ scriptName: "web", command: "npm run web", type: "service" }),
          ],
          error: null,
          errorCode: null,
        },
      },
    ]);
  });

  test("returns a typed Workspace error", async () => {
    const { service, emitted } = buildService({ workspace: null });
    await service.list(listRequest);
    expect(emitted).toEqual([
      {
        type: "workspace.script.list.response",
        payload: {
          requestId: "req-list",
          workspaceId: "ws-1",
          scripts: [],
          error: "Workspace not found: ws-1",
          errorCode: "workspace_not_found",
        },
      },
    ]);
  });
});

describe("start", () => {
  test("reports a typed unavailable error", async () => {
    const { service, emitted, spawnCalls } = buildService({ terminalManager: null });
    await service.start(startRequest);
    expect(spawnCalls).toEqual([]);
    expect(emitted).toEqual([
      {
        type: "workspace.script.start.response",
        payload: {
          requestId: "req-start",
          workspaceId: "ws-1",
          scriptName: "app",
          terminalId: null,
          error: "Workspace scripts are not available on this daemon",
          errorCode: "unavailable",
          script: null,
        },
      },
    ]);
  });

  test("reports typed Workspace and script lookup errors", async () => {
    const missingWorkspace = buildService({ workspace: null });
    await missingWorkspace.service.start(startRequest);
    expect(missingWorkspace.emitted.at(-1)).toMatchObject({
      type: "workspace.script.start.response",
      payload: { errorCode: "workspace_not_found" },
    });

    const missingScript = buildService({ scripts: {} });
    await missingScript.service.start(startRequest);
    expect(missingScript.emitted.at(-1)).toMatchObject({
      type: "workspace.script.start.response",
      payload: { errorCode: "script_not_found" },
    });
  });

  test("spawns the configured script and returns its projection", async () => {
    const { service, emitted, spawnCalls } = buildService();
    await service.start(startRequest);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      workspaceId: "ws-1",
      projectSlug: "thoth",
      branchName: "feature/scripts",
      scriptName: "app",
      daemonPort: 6688,
      daemonListenHost: "127.0.0.1",
    });
    expect(emitted.at(-1)).toEqual({
      type: "workspace.script.start.response",
      payload: {
        requestId: "req-start",
        workspaceId: "ws-1",
        scriptName: "app",
        terminalId: "terminal-1",
        error: null,
        errorCode: null,
        script: expect.objectContaining({
          scriptName: "app",
          command: "npm run app",
          lifecycle: "running",
          terminalId: "terminal-1",
        }),
      },
    });
  });

  test("rejects an already-running script and reports spawn failures", async () => {
    const alreadyRunning = buildService();
    alreadyRunning.scriptRuntimeStore?.set({
      workspaceId: "ws-1",
      scriptName: "app",
      type: "script",
      lifecycle: "running",
      terminalId: "terminal-existing",
      exitCode: null,
    });
    await alreadyRunning.service.start(startRequest);
    expect(alreadyRunning.spawnCalls).toEqual([]);
    expect(alreadyRunning.emitted.at(-1)).toMatchObject({
      payload: { errorCode: "already_running" },
    });

    const failed = buildService({ spawnThrows: "boom" });
    await failed.service.start(startRequest);
    expect(failed.emitted.at(-1)).toEqual({
      type: "workspace.script.start.response",
      payload: {
        requestId: "req-start",
        workspaceId: "ws-1",
        scriptName: "app",
        terminalId: null,
        error: "boom",
        errorCode: "start_failed",
        script: null,
      },
    });
  });
});

describe("stop", () => {
  test("kills the terminal and releases the route, lease, and durable runtime", async () => {
    const built = buildService();
    built.scriptRuntimeStore?.set({
      workspaceId: "ws-1",
      scriptName: "app",
      type: "script",
      lifecycle: "running",
      terminalId: "terminal-1",
      exitCode: null,
    });
    await built.service.stop(stopRequest);

    expect(built.killCalls).toEqual(["terminal-1"]);
    expect(built.releaseCalls).toEqual([{ workspaceId: "ws-1", scriptName: "app" }]);
    expect(built.scriptRuntimeStore?.get({ workspaceId: "ws-1", scriptName: "app" })).toMatchObject(
      {
        lifecycle: "stopped",
      },
    );
    expect(built.emitted.at(-1)).toMatchObject({
      type: "workspace.script.stop.response",
      payload: {
        error: null,
        errorCode: null,
        script: { lifecycle: "stopped" },
      },
    });
  });

  test("cleans up a missing terminal receipt without guessing a live process", async () => {
    const built = buildService({ terminalPresent: false });
    built.scriptRuntimeStore?.set({
      workspaceId: "ws-1",
      scriptName: "app",
      type: "script",
      lifecycle: "running",
      terminalId: "terminal-missing",
      exitCode: null,
    });
    await built.service.stop(stopRequest);
    expect(built.killCalls).toEqual([]);
    expect(built.releaseCalls).toEqual([{ workspaceId: "ws-1", scriptName: "app" }]);
    expect(built.scriptRuntimeStore?.isRunning({ workspaceId: "ws-1", scriptName: "app" })).toBe(
      false,
    );
  });

  test("returns typed not-running and missing Workspace errors", async () => {
    const stopped = buildService();
    await stopped.service.stop(stopRequest);
    expect(stopped.emitted.at(-1)).toMatchObject({ payload: { errorCode: "not_running" } });

    const missingWorkspace = buildService({ workspace: null });
    await missingWorkspace.service.stop(stopRequest);
    expect(missingWorkspace.emitted.at(-1)).toMatchObject({
      payload: { errorCode: "workspace_not_found" },
    });
  });
});
