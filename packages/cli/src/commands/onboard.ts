import { cancel, intro, log, note, outro, spinner } from "@clack/prompts";
import { Command, Option } from "commander";
import path from "node:path";
import { generateLocalPairingOffer, loadConfig, type CliConfigOverrides } from "@thoth/daemon";
import { DEFAULT_APP_BASE_URL } from "@thoth/protocol/daemon-endpoints";
import {
  resolveLocalThothHome,
  resolveLocalDaemonState,
  resolveTcpHostFromListen,
  startLocalDaemonDetached,
  tailDaemonLog,
  type DaemonStartOptions,
} from "./daemon/local-daemon.js";
import { tryConnectToDaemon } from "../utils/client.js";

interface OnboardOptions extends DaemonStartOptions {
  timeout?: string;
}

type RawOnboardOptions = OnboardOptions & {
  allowedHosts?: string;
};

const DEFAULT_READY_TIMEOUT_MS = 10 * 60 * 1000;
const READY_PROBE_TIMEOUT_MS = 1200;

const plainNoteFormat = (line: string): string => line;

function renderNote(message: string, title: string): void {
  note(message, title, { format: plainNoteFormat });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseTimeoutMs(raw: string | undefined): number {
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_READY_TIMEOUT_MS;
  }

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Invalid timeout value: ${raw}`);
  }

  return Math.ceil(seconds * 1000);
}

function toCliOverrides(options: OnboardOptions): CliConfigOverrides {
  const cliOverrides: CliConfigOverrides = {};

  if (options.listen) {
    cliOverrides.listen = options.listen;
  } else if (options.port) {
    cliOverrides.listen = `127.0.0.1:${options.port}`;
  }

  if (options.relay === false) {
    cliOverrides.relayEnabled = false;
  }

  if (options.hostnames) {
    const raw = options.hostnames.trim();
    cliOverrides.hostnames =
      raw.toLowerCase() === "true"
        ? true
        : raw
            .split(",")
            .map((host) => host.trim())
            .filter(Boolean);
  }

  if (options.mcp === false) {
    cliOverrides.mcpEnabled = false;
  }

  return cliOverrides;
}

type ProbeResult = { kind: "ready"; listen: string; host: string | null } | { kind: "pending" };

async function probeDaemonReady(home: string, timeoutMs: number): Promise<ProbeResult> {
  const state = resolveLocalDaemonState({ home });
  const host = resolveTcpHostFromListen(state.listen);
  const deadline = Date.now() + timeoutMs;
  const remainingTimeoutMs = () => Math.max(1, deadline - Date.now());

  if (state.running && host) {
    const client = await tryConnectToDaemon({
      host,
      timeout: Math.min(remainingTimeoutMs(), READY_PROBE_TIMEOUT_MS),
    });
    if (client) {
      try {
        await client.fetchAgents({
          timeout: Math.min(remainingTimeoutMs(), READY_PROBE_TIMEOUT_MS),
        });
        return { kind: "ready", listen: state.listen, host };
      } catch {
        // Daemon process is alive but not API-ready yet.
      } finally {
        await client.close().catch(() => {});
      }
    }
  } else if (state.running && !host) {
    return { kind: "ready", listen: state.listen, host: null };
  }

  return { kind: "pending" };
}

interface ProgressState {
  lastStatus: string;
  lastPrintedAt: number;
}

function announceProgress(
  state: ProgressState,
  onStatus: ((message: string) => void) | undefined,
): ProgressState {
  const statusMessage = "Waiting for daemon to become ready...";

  if (statusMessage !== state.lastStatus) {
    onStatus?.(statusMessage);
    return { lastStatus: statusMessage, lastPrintedAt: Date.now() };
  }
  if (!onStatus && Date.now() - state.lastPrintedAt >= 3000) {
    console.log(statusMessage);
    return { lastStatus: state.lastStatus, lastPrintedAt: Date.now() };
  }
  return state;
}

async function waitForDaemonReady(args: {
  home: string;
  timeoutMs: number;
  onStatus?: (message: string) => void;
}): Promise<{ listen: string; host: string | null }> {
  const deadline = Date.now() + args.timeoutMs;
  const createTimeoutError = () => {
    const recentLogs = tailDaemonLog(args.home, 60);
    return new Error(
      [
        `Timed out after ${Math.ceil(args.timeoutMs / 1000)}s waiting for daemon readiness.`,
        recentLogs ? `Recent daemon logs:\n${recentLogs}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  };

  async function poll(state: ProgressState): Promise<{ listen: string; host: string | null }> {
    if (Date.now() >= deadline) {
      throw createTimeoutError();
    }
    const probe = await probeDaemonReady(args.home, Math.max(1, deadline - Date.now()));
    if (probe.kind === "ready") {
      return { listen: probe.listen, host: probe.host };
    }
    const nextState = announceProgress(state, args.onStatus);
    if (Date.now() >= deadline) {
      throw createTimeoutError();
    }
    await sleep(200);
    return poll(nextState);
  }

  return poll({ lastStatus: "", lastPrintedAt: 0 });
}

function printNextSteps(pairingUrl: string | null, thothHome: string, richUi: boolean): void {
  const daemonLogPath = path.join(thothHome, "daemon.log");
  const nextStepsLines = [
    pairingUrl
      ? "1. Open Thoth and scan the QR code above, or paste the pairing link."
      : "1. Open Thoth and connect to your daemon.",
    `2. Web app: ${DEFAULT_APP_BASE_URL}`,
    "3. Desktop app: https://github.com/thoth/thoth/releases/latest",
    "4. Docs: https://thoth.sh/docs",
    '5. Example: thoth run --output-schema schema.json "extract fields"',
  ];
  const quickReferenceLines = [
    "1. thoth --help",
    "2. thoth ls",
    '3. thoth run "your prompt"',
    "4. thoth status",
    `5. Daemon logs: ${daemonLogPath}`,
  ];

  if (!richUi) {
    console.log("");
    console.log("Next steps:");
    for (const line of nextStepsLines) {
      console.log(line);
    }
    console.log("");
    console.log("CLI quick reference:");
    for (const line of quickReferenceLines) {
      console.log(line);
    }
    return;
  }

  renderNote(nextStepsLines.join("\n"), "Next steps");
  renderNote(quickReferenceLines.join("\n"), "CLI quick reference");
}

export function onboardCommand(): Command {
  return new Command("onboard")
    .description("Run first-time setup, start daemon, and print pairing instructions")
    .option("--listen <listen>", "Listen target (host:port, port, or unix socket path)")
    .option("--port <port>", "Port to listen on (default: 6688)")
    .option("--home <path>", "Thoth home directory (default: ~/.thoth)")
    .option("--no-relay", "Disable relay connection")
    .option("--no-mcp", "Disable the Agent MCP HTTP endpoint")
    .option(
      "--hostnames <hosts>",
      'Daemon hostnames (comma-separated, e.g. "myhost,.example.com" or "true" for any)',
    )
    .addOption(new Option("--allowed-hosts <hosts>").hideHelp())
    .option("--timeout <seconds>", "Max time to wait for daemon readiness (default: 600)")
    .action(async (options: RawOnboardOptions) => {
      await runOnboard({
        ...options,
        hostnames: options.hostnames ?? options.allowedHosts,
      });
    });
}

async function ensureDaemonStarted(options: OnboardOptions, richUi: boolean): Promise<void> {
  const stateBeforeStart = resolveLocalDaemonState({ home: options.home });
  if (stateBeforeStart.running) {
    log.message(`Daemon already running (PID ${stateBeforeStart.pidInfo?.pid ?? "unknown"}).`);
    return;
  }

  const startSpinner = richUi ? spinner() : null;
  try {
    if (startSpinner) {
      startSpinner.start("Starting daemon...");
    } else {
      log.message("Starting daemon...");
    }
    const startup = await startLocalDaemonDetached(options);
    if (startSpinner) {
      startSpinner.stop(`Daemon started (PID ${startup.pid ?? "unknown"})`);
    } else {
      log.message(`Daemon started (PID ${startup.pid ?? "unknown"})`);
    }
    log.message(`Logs: ${startup.logPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (startSpinner) {
      startSpinner.error(message);
    } else {
      log.error(message);
    }
    process.exit(1);
  }
}

async function waitForDaemonReadyWithUi(args: {
  home: string;
  timeoutMs: number;
  richUi: boolean;
}): Promise<{ listen: string; host: string | null }> {
  const readySpinner = args.richUi ? spinner() : null;
  try {
    if (readySpinner) {
      readySpinner.start("Waiting for daemon to become ready...");
    } else {
      log.message("Waiting for daemon to become ready...");
    }
    const readyState = await waitForDaemonReady({
      home: args.home,
      timeoutMs: args.timeoutMs,
      onStatus: readySpinner ? (message) => readySpinner.message(message) : undefined,
    });
    if (readySpinner) {
      readySpinner.stop(`Daemon ready on ${readyState.listen}`);
    } else {
      log.message(`Daemon ready on ${readyState.listen}`);
    }
    return readyState;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (readySpinner) {
      readySpinner.error(message);
    } else {
      log.error(message);
    }
    return process.exit(1);
  }
}

export async function runOnboard(options: OnboardOptions): Promise<void> {
  const richUi = process.stdin.isTTY && process.stdout.isTTY;
  if (richUi) {
    intro("Welcome to Thoth");
  }

  if (options.listen && options.port) {
    cancel("Cannot use --listen and --port together");
    process.exit(1);
  }

  let timeoutMs = DEFAULT_READY_TIMEOUT_MS;
  try {
    timeoutMs = parseTimeoutMs(options.timeout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cancel(message);
    process.exit(1);
  }

  const thothHome = resolveLocalThothHome(options.home);
  if (richUi) {
    renderNote(thothHome, "Thoth home");
  }

  const config = loadConfig(thothHome, { cli: toCliOverrides(options) });

  await ensureDaemonStarted(options, richUi);
  await waitForDaemonReadyWithUi({
    home: options.home ?? thothHome,
    timeoutMs,
    richUi,
  });

  if (config.relayEnabled === false) {
    log.warn("Relay is disabled; pairing offer is unavailable for this daemon.");
    printNextSteps(null, thothHome, richUi);
    if (richUi) {
      outro("Thoth daemon is running.");
    }
    return;
  }

  const pairing = await generateLocalPairingOffer({
    thothHome,
    relayEnabled: config.relayEnabled,
    relayEndpoint: config.relayEndpoint,
    relayPublicEndpoint: config.relayPublicEndpoint,
    relayUseTls: config.relayUseTls,
    relayPublicUseTls: config.relayPublicUseTls,
    appBaseUrl: config.appBaseUrl,
    includeQr: true,
  });

  if (!pairing.url) {
    log.warn("Relay pairing URL is unavailable for this daemon configuration.");
    printNextSteps(null, thothHome, richUi);
    if (richUi) {
      outro("Thoth daemon is running.");
    }
    return;
  }

  renderNote(
    pairing.qr ?? "QR is unavailable in this terminal. Use the pairing link below.",
    "Scan to pair",
  );
  renderNote(pairing.url, "Pairing link");
  printNextSteps(pairing.url, thothHome, richUi);
  if (richUi) {
    outro("Thoth is ready!");
  }
}
