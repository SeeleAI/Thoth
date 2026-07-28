import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import {
  connectWorkspaceScriptClient,
  responseError,
  workspaceScriptCommandError,
  type WorkspaceScriptCommandOptions,
} from "./shared.js";
import { workspaceScriptSchema, type WorkspaceScriptRow } from "./schema.js";

export async function runLsCommand(
  options: WorkspaceScriptCommandOptions,
  _command: Command,
): Promise<ListResult<WorkspaceScriptRow>> {
  const { client, workspaceId } = await connectWorkspaceScriptClient(options);
  try {
    const payload = await client.listWorkspaceScripts({ workspaceId });
    if (payload.error) {
      throw responseError({
        fallbackCode: "WORKSPACE_SCRIPT_LIST_FAILED",
        errorCode: payload.errorCode,
        message: payload.error,
      });
    }
    return { type: "list", data: payload.scripts, schema: workspaceScriptSchema };
  } catch (error) {
    throw workspaceScriptCommandError(
      "WORKSPACE_SCRIPT_LIST_FAILED",
      "list Workspace scripts",
      error,
    );
  } finally {
    await client.close().catch(() => {});
  }
}
