import type { DaemonClient } from "@thoth/client/internal/daemon-client";
import type { CommandError, CommandOptions } from "../../output/index.js";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";

export interface WorkspaceScriptCommandOptions extends CommandOptions {
  host?: string;
  workspace?: string;
}

export function requireWorkspaceScriptWorkspaceId(options: WorkspaceScriptCommandOptions): string {
  const workspaceId = options.workspace?.trim() || process.env.THOTH_WORKSPACE_ID?.trim();
  if (!workspaceId) {
    throw {
      code: "WORKSPACE_REQUIRED",
      message: "Workspace script commands require --workspace <workspace-id>",
    } satisfies CommandError;
  }
  return workspaceId;
}

export async function connectWorkspaceScriptClient(
  options: WorkspaceScriptCommandOptions,
): Promise<{ client: DaemonClient; workspaceId: string }> {
  const workspaceId = requireWorkspaceScriptWorkspaceId(options);
  const host = getDaemonHost({ host: options.host });
  try {
    return { client: await connectToDaemon({ host: options.host }), workspaceId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
      details: "Start the daemon with: thoth daemon start",
    } satisfies CommandError;
  }
}

export function workspaceScriptCommandError(
  fallbackCode: string,
  action: string,
  error: unknown,
): CommandError {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return error as CommandError;
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: fallbackCode, message: `Failed to ${action}: ${message}` };
}

export function responseError(input: {
  fallbackCode: string;
  errorCode: string | null;
  message: string | null;
}): CommandError {
  return {
    code: input.errorCode?.toUpperCase() ?? input.fallbackCode,
    message: input.message ?? "Workspace script operation did not return a result",
  };
}
