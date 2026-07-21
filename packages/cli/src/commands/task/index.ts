import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { addTaskListOptions, runTaskListCommand } from "./list.js";
import { addTaskGetOptions, runTaskGetCommand } from "./get.js";
import {
  addTaskControlOptions,
  runTaskPauseCommand,
  runTaskResumeCommand,
  runTaskStopCommand,
  type TaskControlCommand,
} from "./command.js";
import { addTaskTimelineOptions, runTaskTimelineCommand } from "./timeline.js";

export function createTaskCommand(): Command {
  const task = new Command("task").description("Inspect and control Workspace Tasks");

  addJsonAndDaemonHostOptions(addTaskListOptions(task.command("list"))).action(
    withOutput(runTaskListCommand),
  );
  addJsonAndDaemonHostOptions(addTaskGetOptions(task.command("get"))).action(
    withOutput(runTaskGetCommand),
  );
  const controlCommands: ReadonlyArray<readonly [TaskControlCommand, typeof runTaskPauseCommand]> =
    [
      ["pause", runTaskPauseCommand],
      ["resume", runTaskResumeCommand],
      ["stop", runTaskStopCommand],
    ];
  for (const [action, handler] of controlCommands) {
    addJsonAndDaemonHostOptions(addTaskControlOptions(task.command(action), action)).action(
      withOutput(handler),
    );
  }
  addJsonAndDaemonHostOptions(addTaskTimelineOptions(task.command("timeline"))).action(
    withOutput(runTaskTimelineCommand),
  );

  return task;
}
