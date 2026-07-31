import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runCreateCommand } from "./create.js";
import { runLsCommand } from "./ls.js";
import { runInspectCommand } from "./inspect.js";
import { runLogsCommand } from "./logs.js";
import { runPauseCommand } from "./pause.js";
import { runResumeCommand } from "./resume.js";
import { runDeleteCommand } from "./delete.js";
import { runRunOnceCommand } from "./run-once.js";
import { runUpdateCommand } from "./update.js";

function addScheduleCommandOptions(command: Command): Command {
  return addJsonAndDaemonHostOptions(
    command.option(
      "--workspace <workspace-id>",
      "Workspace authority scope",
      process.env.THOTH_WORKSPACE_ID,
    ),
  );
}

export function createScheduleCommand(): Command {
  const schedule = new Command("schedule").description("Manage recurring schedules");

  addScheduleCommandOptions(
    schedule
      .command("create")
      .description("Create a schedule")
      .argument("<prompt>", "Prompt to run on the schedule")
      .option("--every <duration>", "Fixed interval cadence (for example: 5m, 1h)")
      .option("--cron <expr>", "Cron cadence expression")
      .option("--timezone <iana>", "IANA time zone for cron cadence (default: UTC)")
      .option("--name <name>", "Optional schedule name")
      .requiredOption(
        "--intent-contract <id>",
        "Confirmed Intent Contract template for every scheduled Task",
      )
      .option("--target <self|new-agent|agent-id>", "Run target")
      .option(
        "--provider <provider>",
        "Agent provider, or provider/model (e.g. codex or codex/gpt-5.4)",
      )
      .option(
        "--mode <mode>",
        "Provider-specific mode (e.g. claude bypassPermissions, opencode build)",
      )
      .option("--worktree", "Run each new-agent trigger in an independent Thoth worktree Workspace")
      .option("--run-now", "Fire one immediate run on creation (only with --cron)")
      .option("--no-run-now", "Wait the full interval before the first run (only with --every)")
      .option("--max-runs <n>", "Maximum number of runs")
      .option("--expires-in <duration>", "Time to live for the schedule"),
  ).action(withOutput(runCreateCommand));

  addScheduleCommandOptions(schedule.command("ls").description("List schedules")).action(
    withOutput(runLsCommand),
  );

  addScheduleCommandOptions(
    schedule.command("inspect").description("Inspect a schedule").argument("<id>", "Schedule ID"),
  ).action(withOutput(runInspectCommand));

  addScheduleCommandOptions(
    schedule
      .command("logs")
      .description("Show recent schedule run logs")
      .argument("<id>", "Schedule ID"),
  ).action(withOutput(runLogsCommand));

  addScheduleCommandOptions(
    schedule.command("pause").description("Pause a schedule").argument("<id>", "Schedule ID"),
  ).action(withOutput(runPauseCommand));

  addScheduleCommandOptions(
    schedule
      .command("resume")
      .description("Resume a paused schedule")
      .argument("<id>", "Schedule ID"),
  ).action(withOutput(runResumeCommand));

  addScheduleCommandOptions(
    schedule.command("delete").description("Delete a schedule").argument("<id>", "Schedule ID"),
  ).action(withOutput(runDeleteCommand));

  addScheduleCommandOptions(
    schedule
      .command("run-once")
      .description("Manually trigger a single run of a schedule without affecting cadence")
      .argument("<id>", "Schedule ID"),
  ).action(withOutput(runRunOnceCommand));

  addScheduleCommandOptions(
    schedule
      .command("update")
      .description("Update an existing schedule in place")
      .argument("<id>", "Schedule ID")
      .option("--every <duration>", "Switch to fixed interval cadence (for example: 5m, 1h)")
      .option("--cron <expr>", "Switch to cron cadence expression")
      .option("--timezone <iana>", "IANA time zone for cron cadence (requires --cron)")
      .option("--name <name>", "Rename the schedule (empty string clears the name)")
      .option("--prompt <text>", "Replace the schedule prompt")
      .option(
        "--intent-contract <id>",
        "Newly confirmed Intent Contract required for a substantive update",
      )
      .option(
        "--provider <provider>",
        "New agent provider, or provider/model (only for new-agent target)",
      )
      .option("--model <model>", "New agent model (only for new-agent target)")
      .option("--mode <mode>", "New agent provider mode (only for new-agent target)")
      .option("--worktree", "Run future triggers in independent worktree Workspaces")
      .option("--same-workspace", "Run future triggers in the owning Workspace")
      .option("--max-runs <n>", "Set or change maximum number of runs")
      .option("--no-max-runs", "Clear the max-runs limit")
      .option("--expires-in <duration>", "Set or change time to live for the schedule")
      .option("--no-expires-in", "Clear the expiration"),
  ).action(withOutput(runUpdateCommand));

  return schedule;
}
