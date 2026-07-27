import { lstat, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Logger } from "pino";
import { resolveForgeRepository, type ForgeId, type ForgeRepository } from "@thoth/protocol/forge";
import { parseGitRemoteLocation } from "@thoth/protocol/git-remote";

import { runGitCommand } from "../../utils/run-git-command.js";
import type { WorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "../workspace-registry.js";

export type WorkspaceCloneErrorCode =
  | "invalid_remote"
  | "unsupported_forge"
  | "destination_exists"
  | "duplicate_workspace"
  | "authentication_failed"
  | "clone_failed";

export class WorkspaceForgeError extends Error {
  constructor(
    readonly code: WorkspaceCloneErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkspaceForgeError";
  }
}

export interface WorkspaceForgeCloneInput {
  remoteUrl: string;
  destinationPath: string;
  forgeHint?: ForgeId;
  title?: string | null;
}

export interface WorkspaceForgeCloneResult {
  repository: ForgeRepository;
  workspace: PersistedWorkspaceRecord;
}

interface WorkspaceForgeServiceDependencies {
  workspaceRegistry: WorkspaceRegistry;
  workspaceProvisioning: WorkspaceProvisioningService;
  logger: Pick<Logger, "trace" | "warn">;
  runGit?: typeof runGitCommand;
}

/**
 * Infrastructure adapter for remote Forge repositories entering Workspace
 * authority. It owns Git transport and error normalization only; the canonical
 * Workspace/Project records are still created by WorkspaceProvisioningService.
 */
export class WorkspaceForgeService {
  private readonly runGit: typeof runGitCommand;

  constructor(private readonly dependencies: WorkspaceForgeServiceDependencies) {
    this.runGit = dependencies.runGit ?? runGitCommand;
  }

  resolveRepository(remoteUrl: string, forgeHint?: ForgeId): ForgeRepository {
    if (!parseGitRemoteLocation(remoteUrl)) {
      throw new WorkspaceForgeError("invalid_remote", `Invalid Git remote: ${remoteUrl}`);
    }
    const repository = resolveForgeRepository(remoteUrl, forgeHint);
    if (!repository) {
      throw new WorkspaceForgeError(
        "unsupported_forge",
        "The Git remote host is not a supported Forge; provide an explicit Forge hint for a self-hosted service",
      );
    }
    return repository;
  }

  async cloneWorkspace(input: WorkspaceForgeCloneInput): Promise<WorkspaceForgeCloneResult> {
    const repository = this.resolveRepository(input.remoteUrl, input.forgeHint);
    const destinationPath = resolve(input.destinationPath);
    const parentPath = dirname(destinationPath);

    if (await pathExists(destinationPath)) {
      throw new WorkspaceForgeError(
        "destination_exists",
        `Clone destination already exists: ${destinationPath}`,
      );
    }

    const duplicate = (await this.dependencies.workspaceRegistry.list()).find(
      (workspace) => resolve(workspace.cwd) === destinationPath,
    );
    if (duplicate) {
      throw new WorkspaceForgeError(
        "duplicate_workspace",
        `Workspace ${duplicate.workspaceId} already owns clone destination ${destinationPath}`,
      );
    }

    await mkdir(parentPath, { recursive: true });
    let cloneCompleted = false;
    try {
      await this.runGit(["clone", "--", repository.remoteUrl, destinationPath], {
        cwd: parentPath,
        envOverlay: { GIT_TERMINAL_PROMPT: "0" },
        logger: this.dependencies.logger,
      });
      cloneCompleted = true;
      const workspace = await this.dependencies.workspaceProvisioning.createWorkspaceForDirectory(
        destinationPath,
        input.title ?? null,
      );
      return { repository, workspace };
    } catch (error) {
      await removeOperationOwnedDestination(destinationPath, this.dependencies.logger);
      if (error instanceof WorkspaceForgeError) {
        throw error;
      }
      if (!cloneCompleted) {
        throw mapGitCloneError(error);
      }
      throw new WorkspaceForgeError(
        "clone_failed",
        `Repository cloned but Workspace registration failed: ${getErrorMessage(error)}`,
        { cause: error },
      );
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function removeOperationOwnedDestination(
  destinationPath: string,
  logger: Pick<Logger, "warn">,
): Promise<void> {
  try {
    await rm(destinationPath, { recursive: true, force: true });
  } catch (error) {
    logger.warn(
      { err: error, destinationPath },
      "Failed to remove an incomplete Forge clone destination",
    );
  }
}

function mapGitCloneError(error: unknown): WorkspaceForgeError {
  const message = getErrorMessage(error);
  if (isAuthenticationFailure(message)) {
    return new WorkspaceForgeError("authentication_failed", message, { cause: error });
  }
  return new WorkspaceForgeError("clone_failed", message, { cause: error });
}

function isAuthenticationFailure(message: string): boolean {
  return /(?:authentication failed|permission denied|could not read username|access denied|invalid credentials|publickey)/iu.test(
    message,
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
