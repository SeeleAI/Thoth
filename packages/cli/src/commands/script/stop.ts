import type { Command } from "commander";
import type { SingleResult } from "../../output/index.js";
import {
  connectWorkspaceScriptClient,
  responseError,
  workspaceScriptCommandError,
  type WorkspaceScriptCommandOptions,
} from "./shared.js";
import { workspaceScriptSchema, type WorkspaceScriptRow } from "./schema.js";

export async function runStopCommand(
  scriptName: string,
  options: WorkspaceScriptCommandOptions,
  _command: Command,
): Promise<SingleResult<WorkspaceScriptRow>> {
  const { client, workspaceId } = await connectWorkspaceScriptClient(options);
  try {
    const payload = await client.stopWorkspaceScript({ workspaceId, scriptName });
    if (payload.error || !payload.script) {
      throw responseError({
        fallbackCode: "WORKSPACE_SCRIPT_STOP_FAILED",
        errorCode: payload.errorCode,
        message: payload.error ?? `Script '${scriptName}' did not return status metadata`,
      });
    }
    return { type: "single", data: payload.script, schema: workspaceScriptSchema };
  } catch (error) {
    throw workspaceScriptCommandError(
      "WORKSPACE_SCRIPT_STOP_FAILED",
      "stop Workspace script",
      error,
    );
  } finally {
    await client.close().catch(() => {});
  }
}
