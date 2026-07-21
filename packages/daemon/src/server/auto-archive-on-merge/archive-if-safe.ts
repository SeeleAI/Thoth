import type { Logger } from "pino";

import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentRegistry } from "../agent/agent-storage.js";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import {
  archiveByScope,
  type ActiveWorkspaceRef,
  killTerminalsForWorkspace,
  resolveWorkspaceIdAtPath,
} from "../workspace-archive-service.js";
import type {
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitServiceImpl,
} from "../workspace-git-service.js";
import type { GitHubService } from "../../services/github-service.js";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import { isThothOwnedWorktreeCwd } from "../../utils/worktree.js";

export interface AutoArchiveArchiveOptions {
  thothHome: string;
  thothWorktreesBaseRoot?: string;
  daemonConfigStore: DaemonConfigStore;
  workspaceGitService: WorkspaceGitServiceImpl;
  github: GitHubService;
  agentManager: AgentManager;
  agentStorage: AgentRegistry;
  terminalManager: TerminalManager;
  findWorkspaceIdForCwd: (cwd: string) => Promise<string | null>;
  listActiveWorkspaces: () => Promise<ActiveWorkspaceRef[]>;
  archiveWorkspaceRecord: (workspaceId: string) => Promise<void>;
  markWorkspaceArchiving: (workspaceIds: Iterable<string>, archivingAt: string) => void;
  clearWorkspaceArchiving: (workspaceIds: Iterable<string>) => void;
  emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds: Iterable<string>) => Promise<void>;
}

export interface ArchiveIfSafeDependencies {
  archiveByScope: typeof archiveByScope;
  resolveWorkspaceIdAtPath: typeof resolveWorkspaceIdAtPath;
  isThothOwnedWorktreeCwd: typeof isThothOwnedWorktreeCwd;
  killTerminalsForWorkspace: typeof killTerminalsForWorkspace;
}

const defaultDependencies: ArchiveIfSafeDependencies = {
  archiveByScope,
  resolveWorkspaceIdAtPath,
  isThothOwnedWorktreeCwd,
  killTerminalsForWorkspace,
};

export async function archiveIfSafe(input: {
  cwd: string;
  pullRequest: WorkspaceGitRuntimeSnapshot["github"]["pullRequest"];
  inFlight: Set<string>;
  options: AutoArchiveArchiveOptions;
  log: Logger;
  deps?: ArchiveIfSafeDependencies;
}): Promise<void> {
  const { cwd, pullRequest, inFlight, options, log } = input;
  const deps = input.deps ?? defaultDependencies;

  if (!pullRequest?.isMerged) {
    return;
  }
  if (options.daemonConfigStore.get().autoArchiveAfterMerge !== true) {
    return;
  }
  if (inFlight.has(cwd)) {
    return;
  }

  inFlight.add(cwd);
  try {
    let snapshot: Awaited<ReturnType<typeof options.workspaceGitService.getSnapshot>> | null;
    try {
      snapshot = await options.workspaceGitService.getSnapshot(cwd, {
        reason: "auto-archive-on-merge",
      });
    } catch (error) {
      log.warn({ err: error, cwd }, "Failed to read snapshot for auto-archive; skipping");
      return;
    }
    if (!snapshot) {
      return;
    }

    if (snapshot.git.isDirty === true) {
      return;
    }
    if (typeof snapshot.git.aheadOfOrigin === "number" && snapshot.git.aheadOfOrigin > 0) {
      return;
    }

    const ownership = await deps.isThothOwnedWorktreeCwd(cwd, {
      thothHome: options.thothHome,
      worktreesRoot: options.thothWorktreesBaseRoot,
    });
    if (!ownership.allowed) {
      return;
    }

    try {
      const workspaceId = await deps.resolveWorkspaceIdAtPath(
        {
          findWorkspaceIdForCwd: options.findWorkspaceIdForCwd,
          listActiveWorkspaces: options.listActiveWorkspaces,
        },
        cwd,
      );
      if (!workspaceId) {
        log.warn({ cwd }, "Auto-archive could not resolve a workspace for cwd; skipping");
        return;
      }

      await deps.archiveByScope(
        {
          thothHome: options.thothHome,
          thothWorktreesBaseRoot: options.thothWorktreesBaseRoot,
          github: options.github,
          workspaceGitService: options.workspaceGitService,
          agentManager: options.agentManager,
          agentStorage: options.agentStorage,
          findWorkspaceIdForCwd: options.findWorkspaceIdForCwd,
          listActiveWorkspaces: options.listActiveWorkspaces,
          archiveWorkspaceRecord: options.archiveWorkspaceRecord,
          emitWorkspaceUpdatesForWorkspaceIds: options.emitWorkspaceUpdatesForWorkspaceIds,
          markWorkspaceArchiving: options.markWorkspaceArchiving,
          clearWorkspaceArchiving: options.clearWorkspaceArchiving,
          killTerminalsForWorkspace: (workspaceIdToKill) =>
            deps.killTerminalsForWorkspace(
              {
                terminalManager: options.terminalManager,
                sessionLogger: log,
              },
              workspaceIdToKill,
            ),
          sessionLogger: log,
        },
        {
          scope: { kind: "workspace", workspaceId },
          repoRoot: ownership.repoRoot ?? null,
          thothWorktreesBaseRoot: options.thothWorktreesBaseRoot,
          requestId: "auto-archive-on-merge",
        },
      );
      log.info({ cwd }, "Auto-archived worktree after PR merge");
    } catch (error) {
      log.warn({ err: error, cwd }, "Auto-archive after merge failed");
    }
  } finally {
    inFlight.delete(cwd);
  }
}
