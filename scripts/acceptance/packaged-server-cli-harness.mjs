import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { DaemonClient } from "../../packages/client/dist/daemon-client.js";
import {
  buildRelayWebSocketProtocols,
  buildRelayWebSocketUrl,
} from "../../packages/protocol/dist/daemon-endpoints.js";
import { parseConnectionOfferFromUrl } from "../../packages/protocol/dist/connection-offer.js";
import { WebSocket } from "ws";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve) => server.close(resolve));
  invariant(typeof port === "number", "Failed to reserve an isolated daemon port");
  return port;
}

async function waitFor(read, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null && value !== undefined && value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const suffix = lastError ? `: ${lastError.message ?? String(lastError)}` : "";
  throw new Error(`Timed out waiting for ${label}${suffix}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 120_000,
  });
  if (result.status !== 0) {
    const stdout = result.stdout?.trim() ?? "";
    const stderr = result.stderr?.trim() ?? "";
    throw new Error(
      `${path.basename(command)} ${args.slice(0, 2).join(" ")} failed (${result.status}): ${stderr || stdout}`,
    );
  }
  return result;
}

function createNodeWebSocket(target, config) {
  return new WebSocket(target, config?.protocols, {
    headers: config?.headers,
  });
}

export class PackagedServerCliHarness {
  constructor({
    root,
    tgzPath,
    relayEndpoint = "relay.test.thoth.seeles.ai:443",
    relayUseTls = true,
  }) {
    this.root = root;
    this.tgzPath = path.resolve(tgzPath);
    this.relayEndpoint = relayEndpoint;
    this.relayUseTls = relayUseTls;
    this.runRoot = mkdtempSync(path.join(os.tmpdir(), "thoth-server-cli-relay-"));
    this.home = path.join(this.runRoot, "home");
    this.thothHome = path.join(this.runRoot, "thoth-home");
    this.prefix = path.join(this.runRoot, "cli-prefix");
    this.workspacePath = path.join(this.runRoot, "workspace");
    this.fakeBin = path.join(this.runRoot, "bin");
    this.capturePath = path.join(this.runRoot, "scripted-codex.jsonl");
    this.statePath = path.join(this.runRoot, "scripted-codex-state.json");
    this.cliPath = path.join(this.prefix, "bin", "thoth");
    this.port = null;
    this.listen = null;
    this.pairingSecrets = [];
    this.installed = false;
    this.running = false;
  }

  get env() {
    return {
      ...process.env,
      HOME: this.home,
      XDG_CONFIG_HOME: path.join(this.runRoot, "xdg-config"),
      XDG_CACHE_HOME: path.join(this.runRoot, "xdg-cache"),
      THOTH_HOME: this.thothHome,
      ...(this.listen ? { THOTH_LISTEN: this.listen } : {}),
      THOTH_RELAY_ENABLED: "true",
      THOTH_RELAY_ENDPOINT: this.relayEndpoint,
      THOTH_RELAY_PUBLIC_ENDPOINT: this.relayEndpoint,
      THOTH_RELAY_USE_TLS: this.relayUseTls ? "true" : "false",
      THOTH_RELAY_PUBLIC_USE_TLS: this.relayUseTls ? "true" : "false",
      THOTH_FAKE_CODEX_CAPTURE: this.capturePath,
      THOTH_FAKE_CODEX_STATE: this.statePath,
      PATH: `${this.fakeBin}${path.delimiter}${this.prefix}/bin${path.delimiter}${process.env.PATH ?? ""}`,
    };
  }

  install() {
    invariant(existsSync(this.tgzPath), `Server CLI tgz not found: ${this.tgzPath}`);
    for (const directory of [
      this.home,
      this.thothHome,
      this.workspacePath,
      this.fakeBin,
      path.join(this.runRoot, "xdg-config"),
      path.join(this.runRoot, "xdg-cache"),
    ]) {
      mkdirSync(directory, { recursive: true });
    }
    writeFileSync(this.statePath, JSON.stringify({ checkpoint: 0, review: 0 }));
    const fakeCodexPath = path.join(this.fakeBin, "codex");
    copyFileSync(
      path.join(this.root, "scripts/fixtures/scripted-codex-app-server.mjs"),
      fakeCodexPath,
    );
    chmodSync(fakeCodexPath, 0o755);
    run(
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        this.prefix,
        "--no-audit",
        "--no-fund",
        "--prefer-offline",
        "--fetch-retries=1",
        "--fetch-timeout=30000",
        this.tgzPath,
      ],
      { cwd: this.runRoot, env: this.env, timeoutMs: 240_000 },
    );
    invariant(existsSync(this.cliPath), `Installed CLI entrypoint not found: ${this.cliPath}`);
    const version = run(this.cliPath, ["--version"], {
      cwd: this.runRoot,
      env: this.env,
    }).stdout.trim();
    invariant(version.includes("0.0.0-mvp-beta"), `Unexpected server CLI version: ${version}`);
    this.installed = true;
  }

  async start() {
    invariant(this.installed, "Install the packaged server CLI before starting it");
    if (this.port === null) this.port = await reservePort();
    this.listen = `127.0.0.1:${this.port}`;
    const daemonLogOffset = this.readDaemonLog().length;
    run(
      this.cliPath,
      [
        "daemon",
        "start",
        "--home",
        this.thothHome,
        "--listen",
        this.listen,
        "--relay-use-tls",
        "--no-web-ui",
      ],
      { cwd: this.runRoot, env: this.env },
    );
    this.running = true;
    await waitFor(
      async () => {
        const client = await this.connectDirect().catch(() => null);
        if (!client) return null;
        try {
          await client.getDaemonStatus({ timeout: 2_000 });
          return true;
        } finally {
          await client.close().catch(() => undefined);
        }
      },
      30_000,
      "packaged server daemon startup",
    );
    await waitFor(
      async () => {
        const relayLifecycle = Array.from(
          this.readDaemonLog()
            .slice(daemonLogOffset)
            .matchAll(/relay_control_(connected|disconnected)/gu),
        ).map((match) => match[1]);
        return relayLifecycle.at(-1) === "connected" ? true : null;
      },
      90_000,
      "hosted Relay control registration",
    );
  }

  async connectDirect() {
    invariant(this.listen, "Packaged server daemon has no listen address");
    const client = new DaemonClient({
      url: `ws://${this.listen}/ws`,
      clientId: `server-cli-local-${Date.now().toString(36)}`,
      clientType: "cli",
      reconnect: { enabled: false },
    });
    await client.connect();
    return client;
  }

  async connectRelay() {
    let lastError = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const direct = await this.connectDirect();
      let pairing;
      try {
        pairing = await direct.getDaemonPairingOffer({ timeout: 15_000 });
      } finally {
        await direct.close().catch(() => undefined);
      }
      invariant(pairing.relayEnabled && pairing.url, "Daemon did not return a Relay pairing offer");
      const offer = parseConnectionOfferFromUrl(pairing.url);
      invariant(
        offer.relay.endpoint === this.relayEndpoint,
        `Pairing offer used ${offer.relay.endpoint} instead of ${this.relayEndpoint}`,
      );
      invariant(
        offer.relay.useTls === this.relayUseTls,
        "Pairing offer TLS mode did not match the hosted Relay contract",
      );
      const relayUrl = buildRelayWebSocketUrl({
        endpoint: offer.relay.endpoint,
        serverId: offer.serverId,
        role: "client",
        useTls: offer.relay.useTls,
      });
      invariant(
        !relayUrl.includes(offer.pairingToken),
        "Pairing token must be carried by WebSocket subprotocol, not the Relay URL",
      );
      this.pairingSecrets.push(offer.pairingToken, pairing.url);
      const client = new DaemonClient({
        url: relayUrl,
        clientId: `server-cli-relay-${Date.now().toString(36)}-${attempt}`,
        clientType: "cli",
        appVersion: "0.0.0-mvp-beta",
        connectTimeoutMs: 30_000,
        protocols: buildRelayWebSocketProtocols(offer.pairingToken),
        e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
        webSocketFactory: createNodeWebSocket,
        reconnect: { enabled: false },
      });
      try {
        await client.connect();
        await client.getDaemonStatus({ timeout: 10_000 });
        return client;
      } catch (error) {
        lastError = error;
        await client.close().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
    throw new Error(
      `Hosted Relay connection failed after five pairing attempts: ${lastError?.message ?? String(lastError)}`,
    );
  }

  readState() {
    return JSON.parse(readFileSync(this.statePath, "utf8"));
  }

  patchState(patch) {
    writeFileSync(this.statePath, JSON.stringify({ ...this.readState(), ...patch }));
  }

  readCapture() {
    if (!existsSync(this.capturePath)) return [];
    return readFileSync(this.capturePath, "utf8")
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  readDaemonLog() {
    const logPath = path.join(this.thothHome, "daemon.log");
    return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  }

  assertPairingSecretsAbsent(values = []) {
    const searchable = [this.readDaemonLog(), JSON.stringify(this.readCapture()), ...values].join(
      "\n",
    );
    invariant(!searchable.includes("#offer="), "Pairing offer URL leaked into logs or evidence");
    for (const secret of this.pairingSecrets) {
      invariant(
        !searchable.includes(secret),
        "Relay pairing credential leaked into logs or evidence",
      );
    }
  }

  redact(value) {
    let redacted = value;
    for (const secret of this.pairingSecrets) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
    return redacted;
  }

  async stop() {
    if (!this.running) return;
    const result = spawnSync(
      this.cliPath,
      ["daemon", "stop", "--home", this.thothHome, "--force", "--json"],
      {
        cwd: this.runRoot,
        env: this.env,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    if (result.status !== 0) {
      const pidPath = path.join(this.thothHome, "thoth.pid");
      if (existsSync(pidPath)) {
        const pid = JSON.parse(readFileSync(pidPath, "utf8")).pid;
        if (Number.isInteger(pid)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // The daemon may have exited between reading the pid file and signaling it.
          }
        }
      }
      throw new Error(`Failed to stop packaged daemon: ${result.stderr || result.stdout}`);
    }
    this.running = false;
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  cleanup() {
    rmSync(this.runRoot, { recursive: true, force: true });
  }
}
