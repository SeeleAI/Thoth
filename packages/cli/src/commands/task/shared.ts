import path from "node:path";
import type { Command } from "commander";
import type { DaemonClient } from "@thoth/client/internal/daemon-client";
import type { CommandError, CommandOptions } from "../../output/index.js";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";

export interface TaskAuthorityOptions extends CommandOptions {
  host?: string;
  workspace?: string;
}

export function addTaskAuthorityOptions(command: Command): Command {
  return command.option(
    "--workspace <workspace-id>",
    "Workspace authority ID (defaults to THOTH_WORKSPACE_ID or the current directory)",
  );
}

function isSameOrDescendantPath(candidate: string, root: string | null | undefined): boolean {
  if (!root) {
    return false;
  }
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveTaskWorkspaceId(
  client: DaemonClient,
  options: Pick<TaskAuthorityOptions, "workspace">,
  cwd = process.cwd(),
): Promise<string> {
  const explicit = options.workspace?.trim() || process.env.THOTH_WORKSPACE_ID?.trim();
  if (explicit) {
    return explicit;
  }

  const payload = await client.fetchWorkspaces({ page: { limit: 100 } });
  const match = payload.entries
    .filter((workspace) => {
      const directory = workspace.workspaceDirectory ?? workspace.projectRootPath;
      return (
        isSameOrDescendantPath(cwd, directory) ||
        isSameOrDescendantPath(cwd, workspace.projectRootPath)
      );
    })
    .sort((left, right) => {
      const leftRoot = left.workspaceDirectory ?? left.projectRootPath;
      const rightRoot = right.workspaceDirectory ?? right.projectRootPath;
      return path.resolve(rightRoot).length - path.resolve(leftRoot).length;
    })[0];
  if (!match) {
    throw {
      code: "TASK_WORKSPACE_NOT_FOUND",
      message: `No registered Workspace owns ${cwd}`,
      details: "Pass --workspace <id> or set THOTH_WORKSPACE_ID.",
    } satisfies CommandError;
  }
  return match.id;
}

export async function connectTaskAuthority(
  options: TaskAuthorityOptions,
): Promise<{ client: DaemonClient; workspaceId: string }> {
  const host = getDaemonHost({ host: options.host });
  let client: DaemonClient;
  try {
    client = await connectToDaemon({ host: options.host });
  } catch (error) {
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${error instanceof Error ? error.message : String(error)}`,
      details: "Start the daemon with: thoth daemon start",
    } satisfies CommandError;
  }
  try {
    return { client, workspaceId: await resolveTaskWorkspaceId(client, options) };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

export function rethrowTaskCommandError(code: string, error: unknown): never {
  if (error && typeof error === "object" && "code" in error) {
    throw error;
  }
  throw {
    code,
    message: error instanceof Error ? error.message : String(error),
  } satisfies CommandError;
}
