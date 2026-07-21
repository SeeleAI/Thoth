import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runCreateCommand } from "./create.js";
import { runLsCommand } from "./ls.js";
import { runInspectCommand } from "./inspect.js";
import { runDeleteCommand } from "./delete.js";
import { runPostCommand } from "./post.js";
import { runReadCommand } from "./read.js";
import { runWaitCommand } from "./wait.js";

function addChatCommandOptions(command: Command): Command {
  return addJsonAndDaemonHostOptions(
    command.option(
      "--workspace <workspace-id>",
      "Workspace authority scope",
      process.env.THOTH_WORKSPACE_ID,
    ),
  );
}

export function createChatCommand(): Command {
  const chat = new Command("chat").description("Manage chat rooms for agent coordination");

  addChatCommandOptions(
    chat
      .command("create")
      .description("Create a chat room")
      .argument("<name>", "Room name (must be unique)")
      .option("--purpose <text>", "Room purpose/description"),
  ).action(withOutput(runCreateCommand));

  addChatCommandOptions(chat.command("ls").description("List chat rooms")).action(
    withOutput(runLsCommand),
  );

  addChatCommandOptions(
    chat
      .command("inspect")
      .description("Inspect a chat room")
      .argument("<name-or-id>", "Room name or ID"),
  ).action(withOutput(runInspectCommand));

  addChatCommandOptions(
    chat
      .command("delete")
      .description("Delete a chat room")
      .argument("<name-or-id>", "Room name or ID"),
  ).action(withOutput(runDeleteCommand));

  addChatCommandOptions(
    chat
      .command("post")
      .description("Post a chat message")
      .argument("<name-or-id>", "Room name or ID")
      .argument("<message>", "Message body")
      .option("--reply-to <msg-id>", "Reply to a specific message ID"),
  ).action(withOutput(runPostCommand));

  addChatCommandOptions(
    chat
      .command("read")
      .description("Read chat messages")
      .argument("<name-or-id>", "Room name or ID")
      .option("--limit <n>", "Maximum number of messages to return")
      .option("--since <duration-or-timestamp>", "Filter by relative duration or ISO timestamp")
      .option("--agent <agent-id>", "Filter by author agent ID"),
  ).action(withOutput(runReadCommand));

  addChatCommandOptions(
    chat
      .command("wait")
      .description("Wait for new chat messages")
      .argument("<name-or-id>", "Room name or ID")
      .option("--timeout <duration>", "Maximum wait time"),
  ).action(withOutput(runWaitCommand));

  return chat;
}
