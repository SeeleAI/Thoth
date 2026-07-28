import type pino from "pino";
import type {
  ListWorkspaceScriptsRequest,
  SessionOutboundMessage,
  StartWorkspaceScriptRequest,
  StopWorkspaceScriptRequest,
  WorkspaceScriptErrorCode,
  WorkspaceScriptPayload,
  WorkspaceDescriptorPayload,
} from "../../messages.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { ServiceProxySubsystem } from "../../service-proxy.js";
import type { WorkspaceScriptRuntimeStore } from "../../workspace-script-runtime-store.js";
import type { ScriptHealthState } from "../../script-health-monitor.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import type {
  SpawnWorkspaceScriptOptions,
  WorktreeScriptResult,
} from "../../worktree-bootstrap.js";
import {
  buildWorkspaceScriptPayloads,
  readThothConfigForProjection,
} from "../../script-status-projection.js";
import { deriveProjectSlug } from "../../workspace-git-metadata.js";
import type { WorkspaceServicePortRegistry } from "../../workspace-service-port-registry.js";

type WorkspaceScriptsPayload = WorkspaceDescriptorPayload["scripts"];

interface WorkspaceScriptGitMetadata {
  projectSlug: string;
  currentBranch: string | null;
}

/**
 * The service-proxy-backed scripts a workspace exposes: build the scripts payload
 * snapshot, emit a script_status_update to clients, and start a script.
 *
 * The workspace descriptor builder, the script-status emission path, and the
 * start-script RPC all funnel through one assembly of buildWorkspaceScriptPayloads'
 * inputs and one "scripts available on this daemon?" guard, instead of duplicating
 * that assembly and guard across the session.
 */
export interface WorkspaceScriptsService {
  buildSnapshot(workspaceId: string, workspaceDirectory: string): WorkspaceScriptsPayload;
  emitStatusUpdate(workspaceId: string, workspaceDirectory: string): void;
  listWorkspace(workspaceId: string): Promise<WorkspaceScriptListResult>;
  startWorkspace(workspaceId: string, scriptName: string): Promise<WorkspaceScriptMutationResult>;
  stopWorkspace(workspaceId: string, scriptName: string): Promise<WorkspaceScriptMutationResult>;
  list(request: ListWorkspaceScriptsRequest): Promise<void>;
  start(request: StartWorkspaceScriptRequest): Promise<void>;
  stop(request: StopWorkspaceScriptRequest): Promise<void>;
}

export interface WorkspaceScriptListResult {
  workspaceId: string;
  scripts: WorkspaceScriptPayload[];
  error: string | null;
  errorCode: WorkspaceScriptErrorCode | null;
}

export interface WorkspaceScriptMutationResult {
  workspaceId: string;
  scriptName: string;
  terminalId: string | null;
  script: WorkspaceScriptPayload | null;
  error: string | null;
  errorCode: WorkspaceScriptErrorCode | null;
}

class WorkspaceScriptOperationError extends Error {
  constructor(
    readonly code: WorkspaceScriptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceScriptOperationError";
  }
}

function toWorkspaceScriptError(
  error: unknown,
  fallback: WorkspaceScriptErrorCode,
): { message: string; code: WorkspaceScriptErrorCode } {
  if (error instanceof WorkspaceScriptOperationError) {
    return { message: error.message, code: error.code };
  }
  return {
    message: error instanceof Error ? error.message : "Workspace script operation failed",
    code: fallback,
  };
}

type WorkspaceScriptsGitSource = Pick<
  WorkspaceGitService,
  "peekSnapshot" | "getWorkspaceGitMetadata"
>;

export function createWorkspaceScriptsService(deps: {
  serviceProxy: ServiceProxySubsystem | null;
  scriptRuntimeStore: WorkspaceScriptRuntimeStore | null;
  servicePortRegistry: WorkspaceServicePortRegistry;
  terminalManager: TerminalManager | null;
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  workspaceGitService: WorkspaceScriptsGitSource;
  getDaemonTcpPort: (() => number | null) | null;
  getDaemonTcpHost: (() => string | null) | null;
  serviceProxyPublicBaseUrl: string | null;
  resolveScriptHealth: ((hostname: string) => ScriptHealthState | null) | null;
  logger: pino.Logger;
  emit: (message: SessionOutboundMessage) => void;
  spawnWorkspaceScript: (options: SpawnWorkspaceScriptOptions) => Promise<WorktreeScriptResult>;
}): WorkspaceScriptsService {
  const {
    serviceProxy,
    scriptRuntimeStore,
    servicePortRegistry,
    terminalManager,
    workspaceRegistry,
    workspaceGitService,
    getDaemonTcpPort,
    getDaemonTcpHost,
    serviceProxyPublicBaseUrl,
    resolveScriptHealth,
    logger,
    emit,
    spawnWorkspaceScript,
  } = deps;

  function resolveGitMetadata(workspaceDirectory: string): WorkspaceScriptGitMetadata | undefined {
    const snapshot = workspaceGitService.peekSnapshot(workspaceDirectory);
    if (!snapshot) {
      return undefined;
    }
    return {
      projectSlug: deriveProjectSlug(
        workspaceDirectory,
        snapshot.git.isGit ? snapshot.git.remoteUrl : null,
      ),
      currentBranch: snapshot.git.currentBranch,
    };
  }

  function buildSnapshot(workspaceId: string, workspaceDirectory: string): WorkspaceScriptsPayload {
    if (!serviceProxy || !scriptRuntimeStore) {
      return [];
    }
    return buildWorkspaceScriptPayloads({
      workspaceId,
      workspaceDirectory,
      thothConfig: readThothConfigForProjection(workspaceDirectory, logger),
      serviceProxy,
      runtimeStore: scriptRuntimeStore,
      daemonPort: getDaemonTcpPort?.() ?? null,
      serviceProxyPublicBaseUrl,
      gitMetadata: resolveGitMetadata(workspaceDirectory),
      resolveHealth: resolveScriptHealth ?? undefined,
    });
  }

  function emitStatusUpdate(workspaceId: string, workspaceDirectory: string): void {
    emit({
      type: "script_status_update",
      payload: {
        workspaceId,
        scripts: buildSnapshot(workspaceId, workspaceDirectory),
      },
    });
  }

  async function requireWorkspace(workspaceId: string) {
    const workspace = await workspaceRegistry.get(workspaceId);
    if (!workspace) {
      throw new WorkspaceScriptOperationError(
        "workspace_not_found",
        `Workspace not found: ${workspaceId}`,
      );
    }
    return workspace;
  }

  async function listWorkspace(workspaceId: string): Promise<WorkspaceScriptListResult> {
    try {
      if (!serviceProxy || !scriptRuntimeStore) {
        throw new WorkspaceScriptOperationError(
          "unavailable",
          "Workspace scripts are not available on this daemon",
        );
      }
      const workspace = await requireWorkspace(workspaceId);
      return {
        workspaceId,
        scripts: buildSnapshot(workspace.workspaceId, workspace.cwd),
        error: null,
        errorCode: null,
      };
    } catch (error) {
      const result = toWorkspaceScriptError(error, "unavailable");
      return {
        workspaceId,
        scripts: [],
        error: result.message,
        errorCode: result.code,
      };
    }
  }

  async function list(request: ListWorkspaceScriptsRequest): Promise<void> {
    const result = await listWorkspace(request.workspaceId);
    emit({
      type: "workspace.script.list.response",
      payload: { requestId: request.requestId, ...result },
    });
  }

  async function startWorkspace(
    workspaceId: string,
    scriptName: string,
  ): Promise<WorkspaceScriptMutationResult> {
    try {
      if (!terminalManager || !serviceProxy || !scriptRuntimeStore) {
        throw new WorkspaceScriptOperationError(
          "unavailable",
          "Workspace scripts are not available on this daemon",
        );
      }

      const operation = await scriptRuntimeStore.runExclusiveOperation(
        { workspaceId, scriptName },
        async () => {
          const workspace = await requireWorkspace(workspaceId);
          const current = buildSnapshot(workspace.workspaceId, workspace.cwd).find(
            (script) => script.scriptName === scriptName,
          );
          if (!current) {
            throw new WorkspaceScriptOperationError(
              "script_not_found",
              `Script '${scriptName}' is not configured in thoth.json`,
            );
          }
          if (current.lifecycle === "running") {
            throw new WorkspaceScriptOperationError(
              "already_running",
              `Script '${scriptName}' is already running`,
            );
          }
          const gitMetadata = await workspaceGitService.getWorkspaceGitMetadata(workspace.cwd);

          const serviceResult = await spawnWorkspaceScript({
            repoRoot: workspace.cwd,
            workspaceId: workspace.workspaceId,
            projectSlug: gitMetadata.projectSlug,
            branchName: gitMetadata.currentBranch,
            scriptName,
            daemonPort: getDaemonTcpPort?.() ?? null,
            daemonListenHost: getDaemonTcpHost?.() ?? null,
            serviceProxyPublicBaseUrl,
            serviceProxy,
            runtimeStore: scriptRuntimeStore,
            servicePortRegistry,
            terminalManager,
            logger,
            onLifecycleChanged: () => {
              emitStatusUpdate(workspace.workspaceId, workspace.cwd);
            },
          });

          emitStatusUpdate(workspace.workspaceId, workspace.cwd);
          const script = buildSnapshot(workspace.workspaceId, workspace.cwd).find(
            (entry) => entry.scriptName === scriptName,
          );
          return {
            workspaceId,
            scriptName,
            terminalId: serviceResult.terminalId,
            error: null,
            errorCode: null,
            script: script ?? null,
          } satisfies WorkspaceScriptMutationResult;
        },
      );
      if (!operation.acquired) {
        throw new WorkspaceScriptOperationError(
          "stale_generation",
          `Script '${scriptName}' already has an in-flight lifecycle operation`,
        );
      }
      return operation.value;
    } catch (error) {
      const result = toWorkspaceScriptError(error, "start_failed");
      logger.error(
        {
          err: error,
          workspaceId,
          scriptName,
        },
        "Failed to start workspace script",
      );
      return {
        workspaceId,
        scriptName,
        terminalId: null,
        error: result.message,
        errorCode: result.code,
        script: null,
      };
    }
  }

  async function start(request: StartWorkspaceScriptRequest): Promise<void> {
    const result = await startWorkspace(request.workspaceId, request.scriptName);
    emit({
      type: "workspace.script.start.response",
      payload: { requestId: request.requestId, ...result },
    });
  }

  async function stopWorkspace(
    workspaceId: string,
    scriptName: string,
  ): Promise<WorkspaceScriptMutationResult> {
    try {
      if (!terminalManager || !serviceProxy || !scriptRuntimeStore) {
        throw new WorkspaceScriptOperationError(
          "unavailable",
          "Workspace scripts are not available on this daemon",
        );
      }
      const operation = await scriptRuntimeStore.runExclusiveOperation(
        { workspaceId, scriptName },
        async () => {
          const workspace = await requireWorkspace(workspaceId);
          const runtime = scriptRuntimeStore.get({ workspaceId, scriptName });
          if (!runtime || runtime.lifecycle !== "running") {
            throw new WorkspaceScriptOperationError(
              "not_running",
              `Script '${scriptName}' is not running`,
            );
          }

          const terminal = terminalManager.getTerminal(runtime.terminalId);
          if (terminal) await terminal.killAndWait();
          const current = scriptRuntimeStore.get({ workspaceId, scriptName });
          if (current?.lifecycle === "running" && current.terminalId === runtime.terminalId) {
            serviceProxy.removeWorkspaceService({ workspaceId, scriptName });
            await servicePortRegistry.releaseForWorkspaceScript({ workspaceId, scriptName });
            scriptRuntimeStore.set({ ...current, lifecycle: "stopped", exitCode: null });
          }

          emitStatusUpdate(workspace.workspaceId, workspace.cwd);
          const script = buildSnapshot(workspace.workspaceId, workspace.cwd).find(
            (entry) => entry.scriptName === scriptName,
          );
          return {
            workspaceId,
            scriptName,
            terminalId: script?.terminalId ?? runtime.terminalId,
            error: null,
            errorCode: null,
            script: script ?? null,
          } satisfies WorkspaceScriptMutationResult;
        },
      );
      if (!operation.acquired) {
        throw new WorkspaceScriptOperationError(
          "stale_generation",
          `Script '${scriptName}' already has an in-flight lifecycle operation`,
        );
      }
      return operation.value;
    } catch (error) {
      const result = toWorkspaceScriptError(error, "stop_failed");
      logger.error({ err: error, workspaceId, scriptName }, "Failed to stop Workspace script");
      return {
        workspaceId,
        scriptName,
        terminalId: null,
        error: result.message,
        errorCode: result.code,
        script: null,
      };
    }
  }

  async function stop(request: StopWorkspaceScriptRequest): Promise<void> {
    const result = await stopWorkspace(request.workspaceId, request.scriptName);
    const { terminalId: _terminalId, ...payload } = result;
    emit({
      type: "workspace.script.stop.response",
      payload: { requestId: request.requestId, ...payload },
    });
  }

  return {
    buildSnapshot,
    emitStatusUpdate,
    listWorkspace,
    startWorkspace,
    stopWorkspace,
    list,
    start,
    stop,
  };
}
