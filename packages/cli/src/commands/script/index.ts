import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runLsCommand } from "./ls.js";
import { runStartCommand } from "./start.js";
import { runStopCommand } from "./stop.js";

function addWorkspaceOptions(command: Command): Command {
  return addJsonAndDaemonHostOptions(
    command.option(
      "--workspace <workspace-id>",
      "Workspace authority scope",
      process.env.THOTH_WORKSPACE_ID,
    ),
  );
}

export function createScriptCommand(): Command {
  const command = new Command("script").description("Manage configured Workspace scripts");

  addWorkspaceOptions(
    command.command("ls").description("List configured Workspace scripts"),
  ).action(withOutput(runLsCommand));
  addWorkspaceOptions(
    command
      .command("start")
      .description("Start a configured Workspace script")
      .argument("<name>", "Configured script name"),
  ).action(withOutput(runStartCommand));
  addWorkspaceOptions(
    command
      .command("stop")
      .description("Stop a running Workspace script")
      .argument("<name>", "Configured script name"),
  ).action(withOutput(runStopCommand));

  return command;
}
