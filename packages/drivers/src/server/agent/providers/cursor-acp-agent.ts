import type { Logger } from "pino";

import { GenericACPHarnessAdapter } from "./generic-acp-agent.js";

interface CursorACPHarnessAdapterOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
}

const CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS = 10_000;

export class CursorACPHarnessAdapter extends GenericACPHarnessAdapter {
  constructor(options: CursorACPHarnessAdapterOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      providerParams: options.providerParams,
      // cursor-agent publishes slash commands asynchronously via available_commands_update.
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS,
    });
  }
}
