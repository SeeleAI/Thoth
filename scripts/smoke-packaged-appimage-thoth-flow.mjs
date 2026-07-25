import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { DaemonClient } from "../packages/client/dist/daemon-client.js";
import { ThothApiJourney } from "./acceptance/thoth-api-journey.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const realCodex = args.includes("--real-codex");

function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback;
}

const appImagePath = option(
  "--appimage",
  path.join(root, "packages/desktop/release/Thoth-x86_64.AppImage"),
);
const outputDir = option("--output-dir", path.join(root, ".dev/packaged-appimage-thoth-flow"));
const quickPromptPath = option("--quick-prompt-file", null);
const loopPromptPath = option("--loop-prompt-file", null);
const releaseFixtureRoot = path.join(
  root,
  "packages/daemon/src/test-fixtures/refactor-release-05775486",
);
const releaseFixtureManifest = JSON.parse(
  readFileSync(path.join(releaseFixtureRoot, "manifest.json"), "utf8"),
);

function assert(condition, message) {
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
  assert(typeof port === "number", "Failed to reserve an isolated daemon port");
  return port;
}

async function waitFor(read, timeoutMs = 30_000, label = "condition") {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null && value !== undefined && value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message ?? String(lastError)}` : ""}`,
  );
}

async function configureRealCodexFixture(client, fixturePrompt) {
  if (!realCodex) return;
  const configured = await client.patchDaemonConfig({
    appendSystemPrompt: [
      "You are participating in an automated Thoth transport verification.",
      "Follow the matching literal fixture actions below only when their required runtime tool is available.",
      "Do not inspect or alter the workspace, and do not substitute your own tool arguments.",
      "In a PlanExec or Review session, the named phase submission tool is already present in the current tool catalog. Call it directly; do not search for it and do not report a tool-availability blocker.",
      fixturePrompt,
    ].join("\n\n"),
  });
  assert(!configured.error, `Failed to configure real Codex fixture: ${configured.error}`);
}

function parseCapture(capturePath) {
  if (!existsSync(capturePath)) return [];
  return readFileSync(capturePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function directorySize(rootPath) {
  if (!existsSync(rootPath)) return 0;
  let total = 0;
  const pending = [rootPath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile()) total += readFileSync(entryPath).byteLength;
    }
  }
  return total;
}

function seedReleaseStorage(thothHome) {
  const workspaceId = releaseFixtureManifest.workspaceId;
  assert(typeof workspaceId === "string" && workspaceId.length > 0, "Invalid Release fixture");
  const workspaceRoot = path.join(thothHome, "workspaces", workspaceId);
  mkdirSync(workspaceRoot, { recursive: true });
  copyFileSync(
    path.join(releaseFixtureRoot, "catalog.sqlite"),
    path.join(thothHome, "catalog.sqlite"),
  );
  copyFileSync(
    path.join(releaseFixtureRoot, "authority.sqlite"),
    path.join(workspaceRoot, "authority.sqlite"),
  );
  writeFileSync(
    path.join(thothHome, "storage-layout.json"),
    `${JSON.stringify({ version: 1, migrationState: "complete" })}\n`,
  );

  const fixture = new DatabaseSync(path.join(releaseFixtureRoot, "authority.sqlite"), {
    readOnly: true,
  });
  const timeline = fixture
    .prepare(
      `SELECT agent_id, seq, item_json
       FROM agent_timeline_rows
       ORDER BY agent_id, seq
       LIMIT 1`,
    )
    .get();
  fixture.close();
  assert(
    typeof timeline?.agent_id === "string" &&
      typeof timeline?.seq === "number" &&
      typeof timeline?.item_json === "string",
    "Release fixture has no Timeline probe",
  );
  return {
    workspaceId,
    agentId: timeline.agent_id,
    seq: timeline.seq,
    itemJson: timeline.item_json,
  };
}

function inspectStorageMigration(thothHome, probe) {
  const marker = JSON.parse(readFileSync(path.join(thothHome, "storage-layout.json"), "utf8"));
  assert(marker.version === 2, "Packaged Release storage did not activate layout v2");
  assert(marker.schemaVersion === 2, "Packaged Release storage did not activate schema v2");
  assert(marker.migrated === true, "Packaged Release storage was not marked as migrated");
  assert(
    marker.workspaceCount === 1,
    "Packaged Release storage migrated an unexpected Workspace count",
  );
  const catalog = new DatabaseSync(path.join(thothHome, "catalog.sqlite"), { readOnly: true });
  const locator = catalog
    .prepare("SELECT workspace_id FROM catalog_agent_locator WHERE agent_id = ?")
    .get(probe.agentId);
  const agents = catalog.prepare("SELECT COUNT(*) AS count FROM catalog_agent_locator").get().count;
  catalog.close();
  assert(
    locator?.workspace_id === probe.workspaceId,
    "Release Agent is missing from the migrated global locator",
  );
  const authorityPath = path.join(thothHome, "workspaces", probe.workspaceId, "authority.sqlite");
  const authority = new DatabaseSync(authorityPath, { readOnly: true });
  const timeline = authority
    .prepare("SELECT item_json FROM agent_timeline_rows WHERE agent_id = ? AND seq = ?")
    .get(probe.agentId, probe.seq);
  const timelineRows = authority
    .prepare("SELECT COUNT(*) AS count FROM agent_timeline_rows")
    .get().count;
  authority.close();
  assert(
    timeline?.item_json === probe.itemJson,
    "Release Agent Timeline probe changed during packaged migration",
  );
  assert(
    existsSync(`${path.join(thothHome, "catalog.sqlite")}.release-05775486.bak`) &&
      existsSync(`${authorityPath}.release-05775486.bak`),
    "Packaged migration did not preserve the manual Release recovery backups",
  );
  return {
    workspaceId: probe.workspaceId,
    agents,
    timelineRows,
  };
}

function inspectRuntimeAuthority(thothHome, workspaceId, taskId) {
  assert(
    !existsSync(path.join(thothHome, "provider-sessions")),
    "Packaged daemon recreated the removed provider-sessions tree",
  );
  const bundleRoot = path.join(thothHome, "runtime-bundles", "sha256");
  const bundleDirectories = readdirSync(bundleRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert(
    bundleDirectories.length === 2,
    `Expected exactly two deduplicated RuntimeBundles, received ${bundleDirectories.length}`,
  );
  const bundles = bundleDirectories.map((digest) => {
    const bundle = JSON.parse(readFileSync(path.join(bundleRoot, digest, "bundle.json"), "utf8"));
    assert(
      bundle.digest === `sha256:${digest}`,
      `RuntimeBundle directory digest mismatch: ${digest}`,
    );
    assert(
      !JSON.stringify(bundle).includes("provider-sessions"),
      `RuntimeBundle ${bundle.id} contains a removed session-home path`,
    );
    return bundle;
  });
  assert(
    JSON.stringify(bundles.map((bundle) => bundle.id).sort()) ===
      JSON.stringify(["thoth.clarify", "thoth.loop"]),
    `Unexpected RuntimeBundle ids: ${bundles.map((bundle) => bundle.id).join(", ")}`,
  );

  const authorityPath = path.join(thothHome, "workspaces", workspaceId, "authority.sqlite");
  assert(existsSync(authorityPath), `Workspace authority database not found: ${authorityPath}`);
  const database = new DatabaseSync(authorityPath, { readOnly: true });
  try {
    const attachments = database
      .prepare(
        `SELECT e.execution_id, e.phase_kind, e.status AS execution_status,
                a.bundle_id, a.bundle_digest, a.status AS attachment_status
           FROM execution_attempts e
           LEFT JOIN runtime_attachments a ON a.execution_id = e.execution_id
          WHERE e.task_id = ? AND e.phase_kind IN ('planexec', 'review')
          ORDER BY e.started_at ASC`,
      )
      .all(taskId);
    assert(
      attachments.length === 6,
      `Expected six packaged PlanExec/Review attempts, received ${attachments.length}`,
    );
    assert(
      attachments.every(
        (entry) =>
          entry.bundle_id === "thoth.loop" &&
          entry.attachment_status === "attached" &&
          typeof entry.bundle_digest === "string",
      ),
      "A packaged Loop execution started without a durable thoth.loop attachment receipt",
    );
    return {
      bundles: bundles.map((bundle) => ({ id: bundle.id, digest: bundle.digest })),
      loopAttachmentCount: attachments.length,
    };
  } finally {
    database.close();
  }
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Packaged desktop smoke process did not exit"));
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function assertRemovedProductPathIsAbsent(appImage, runRoot) {
  const inspectRoot = path.join(runRoot, "appimage-inspection");
  mkdirSync(inspectRoot, { recursive: true });
  const extracted = spawnSync(appImage, ["--appimage-extract"], {
    cwd: inspectRoot,
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1" },
    stdio: "ignore",
  });
  assert(extracted.status === 0, "Failed to extract AppImage for product-path inspection");
  const asarPath = path.join(inspectRoot, "squashfs-root", "resources", "app.asar");
  assert(existsSync(asarPath), `Packaged app.asar not found: ${asarPath}`);
  const appDistPath = path.join(inspectRoot, "squashfs-root", "resources", "app-dist");
  assert(existsSync(appDistPath), `Packaged app-dist not found: ${appDistPath}`);
  const productFiles = [asarPath];
  const pendingDirectories = [appDistPath];
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
      } else {
        productFiles.push(entryPath);
      }
    }
  }
  const productBuffers = productFiles.map((file) => readFileSync(file));
  for (const term of [
    "workspace_secretary.send",
    "workspace_secretary.cancel",
    "workspace_secretary.snapshot",
    "WorkspaceSecretarySession",
    "ThothCleanUiModel",
    "prepareForegroundAgentForThoth",
    "emitMirroredAgentStream",
    "workspace_secretary_runtime_context",
    "arcade-inventory/brand/app-icon-source.png",
    "arcade-inventory/brand/avatar-light.png",
    "arcade-inventory/brand/brand-mark.png",
    "arcade-inventory/brand/thoth-seal.png",
    "M291.495 91.399",
  ]) {
    assert(
      productBuffers.every((contents) => !contents.includes(Buffer.from(term))),
      `Removed product path or brand remains in packaged resources: ${term}`,
    );
  }
}

async function main() {
  assert(existsSync(appImagePath), `AppImage not found: ${appImagePath}`);
  if (realCodex) {
    assert(
      quickPromptPath && existsSync(quickPromptPath),
      "Real Codex Quick prompt file is required",
    );
    assert(loopPromptPath && existsSync(loopPromptPath), "Real Codex Loop prompt file is required");
    assert(
      process.env.CODEX_HOME && existsSync(path.join(process.env.CODEX_HOME, "auth.json")),
      "Real Codex mode requires CODEX_HOME with auth.json",
    );
  }
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "thoth-packaged-flow-"));
  assertRemovedProductPathIsAbsent(appImagePath, runRoot);
  const home = path.join(runRoot, "home");
  const thothHome = path.join(runRoot, "thoth-home");
  const xdgConfigHome = path.join(runRoot, "xdg-config");
  const xdgCacheHome = path.join(runRoot, "xdg-cache");
  const fakeBin = path.join(runRoot, "bin");
  const capturePath = path.join(runRoot, "scripted-codex.jsonl");
  const statePath = path.join(runRoot, "scripted-codex-state.json");
  const desktopStdoutPath = path.join(runRoot, "desktop.stdout.log");
  const desktopStderrPath = path.join(runRoot, "desktop.stderr.log");
  const quickWorkspace = path.join(runRoot, "quick-workspace");
  for (const directory of [home, thothHome, xdgConfigHome, xdgCacheHome, fakeBin, quickWorkspace]) {
    mkdirSync(directory, { recursive: true });
  }
  let releaseMigrationProbe = null;
  if (!realCodex) {
    releaseMigrationProbe = seedReleaseStorage(thothHome);
    writeFileSync(statePath, JSON.stringify({ planExec: 0, review: 0 }));
    const fakeCodexPath = path.join(fakeBin, "codex");
    copyFileSync(path.join(root, "scripts/fixtures/scripted-codex-app-server.mjs"), fakeCodexPath);
    chmodSync(fakeCodexPath, 0o755);
  }

  const port = await reservePort();
  const listen = `127.0.0.1:${port}`;
  const command = process.env.DISPLAY ? appImagePath : "xvfb-run";
  const commandArgs = process.env.DISPLAY ? ["--no-sandbox"] : ["-a", appImagePath, "--no-sandbox"];
  const child = spawn(command, commandArgs, {
    cwd: runRoot,
    env: {
      ...process.env,
      APPIMAGE_EXTRACT_AND_RUN: "1",
      ELECTRON_DISABLE_SANDBOX: "1",
      HOME: home,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_CACHE_HOME: xdgCacheHome,
      THOTH_HOME: thothHome,
      THOTH_LISTEN: listen,
      THOTH_RELAY_ENABLED: "false",
      THOTH_DESKTOP_SMOKE: "1",
      THOTH_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      ...(realCodex
        ? { CODEX_HOME: process.env.CODEX_HOME }
        : {
            THOTH_FAKE_CODEX_CAPTURE: capturePath,
            THOTH_FAKE_CODEX_STATE: statePath,
          }),
      PATH: realCodex
        ? (process.env.PATH ?? "")
        : `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    writeFileSync(desktopStdoutPath, stdout);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    writeFileSync(desktopStderrPath, stderr);
  });

  let client = null;
  let report = null;
  let failure = null;
  try {
    await waitFor(
      async () => (stdout.includes("desktop-daemon-smoke-started") ? true : null),
      60_000,
      "packaged desktop-managed daemon startup",
    );
    client = new DaemonClient({
      url: `ws://${listen}/ws`,
      clientId: "packaged-appimage-thoth-flow",
      clientType: "cli",
      reconnect: { enabled: false },
    });
    await client.connect();

    const quickWorkspaceResult = await client.createWorkspace({
      source: { kind: "directory", path: quickWorkspace },
    });
    assert(
      !quickWorkspaceResult.error && quickWorkspaceResult.workspace,
      `Failed to register packaged Quick workspace: ${quickWorkspaceResult.error}`,
    );
    const quickWorkspaceId = quickWorkspaceResult.workspace.id;

    const quickPrompt = realCodex
      ? readFileSync(quickPromptPath, "utf8")
      : "PACKAGED_QUICK_CLARIFY";
    const loopPrompt = realCodex ? readFileSync(loopPromptPath, "utf8") : "PACKAGED_LOOP_RETRY";
    await configureRealCodexFixture(client, `${quickPrompt}\n\n${loopPrompt}`);
    const journey = new ThothApiJourney({
      client,
      timeoutMs: realCodex ? 600_000 : 120_000,
      commandPrefix: "packaged-card",
    });
    const core = await journey.runCore({
      workspaceId: quickWorkspaceId,
      agentConfig: {
        provider: "codex",
        model: "gpt-5.4",
        modeId: realCodex ? "full-access" : "auto",
        ...(realCodex ? { thinkingOptionId: "low" } : {}),
      },
      prompts: {
        rawFirst: realCodex
          ? "This is a transport test. Reply with exactly PACKAGED_RAW_FIRST and nothing else."
          : "PACKAGED_RAW_FIRST",
        quick: quickPrompt,
        rawLast: realCodex
          ? "This is a transport test. Reply with exactly PACKAGED_RAW_LAST and nothing else."
          : "PACKAGED_RAW_LAST",
        loop: loopPrompt,
      },
    });
    writeFileSync(
      path.join(runRoot, "background-task-detail.json"),
      JSON.stringify(core.task, null, 2),
    );

    let stopTask = null;
    if (!realCodex) {
      const fixtureState = JSON.parse(readFileSync(statePath, "utf8"));
      writeFileSync(statePath, JSON.stringify({ ...fixtureState, holdPlanExec: true }));
      await client.sendAgentMessage(core.agent.id, "PACKAGED_LOOP_STOP", {
        thoth: {
          enabled: true,
          executionMode: "loop",
          clarifyStrength: "light",
          loopStrength: "light",
        },
      });
      await journey.approveCardChain(core.agent.id, "loop");
      await journey.waitForLifecycle(core.agent.id, "background_handoff");
      stopTask = await waitFor(
        async () => {
          const listed = await client.listTasks(quickWorkspaceId);
          const task = listed.tasks.find(
            (candidate) =>
              candidate.id !== core.task.id && candidate.title === "Packaged Stop lifecycle flow",
          );
          if (!task) return null;
          const detail = await client.getTask({ taskId: task.id, workspaceId: quickWorkspaceId });
          return detail.executions.some((execution) =>
            ["starting", "running", "awaiting_provider"].includes(execution.status),
          )
            ? task
            : null;
        },
        30_000,
        "held packaged PlanExec",
      );
      const stopped = await client.commandTask({
        workspaceId: quickWorkspaceId,
        taskId: stopTask.id,
        command: "stop",
        expectedRevision: stopTask.revision,
        commandId: "packaged-stop-command",
      });
      assert(!stopped.error && !stopped.conflict, `Packaged Stop failed: ${stopped.error}`);
      const stoppedDetail = await waitFor(
        async () => {
          const detail = await client.getTask({
            taskId: stopTask.id,
            workspaceId: quickWorkspaceId,
          });
          if (detail.task?.status !== "stopped") return null;
          return detail;
        },
        30_000,
        "packaged Stop settlement",
      );
      assert(
        stoppedDetail.executions.every(
          (execution) => !["starting", "running", "awaiting_provider"].includes(execution.status),
        ),
        "Stopped packaged Task retained a running execution spinner state",
      );
      writeFileSync(
        path.join(runRoot, "stopped-task-detail.json"),
        JSON.stringify(stoppedDetail, null, 2),
      );
    }

    const visibleSessionIds = [core.sessionId];
    if (!realCodex) {
      for (let ordinal = 2; ordinal <= 6; ordinal += 1) {
        const agent = await client.createAgent({
          provider: "codex",
          model: "gpt-5.4",
          modeId: "auto",
          workspaceId: quickWorkspaceId,
          initialPrompt: `PACKAGED_STORAGE_SESSION_${ordinal}`,
          thoth: { enabled: false },
        });
        await journey.waitForAgentIdle(agent.id);
        const sessionId = await journey.sessionId(agent.id);
        assert(sessionId, `Packaged storage session ${ordinal} has no provider thread`);
        visibleSessionIds.push(sessionId);
      }
      assert(
        new Set(visibleSessionIds).size === 6,
        "Six visible packaged sessions did not receive independent provider threads",
      );
    }

    const capture = realCodex ? [] : parseCapture(capturePath);
    const toolCalls = capture.filter((entry) => entry.kind === "tool_call");
    const threadStarts = capture.filter((entry) => entry.kind === "thread_start");
    const turnErrors = capture.filter((entry) => entry.kind === "turn_error");
    let visibleTurnCount = realCodex ? 10 : 13;
    if (!realCodex) {
      assert(
        turnErrors.length === 0,
        `Scripted provider turn errors: ${JSON.stringify(turnErrors)}`,
      );
      assert(
        threadStarts.some(
          (entry) =>
            Array.isArray(entry.dynamicToolNames) &&
            entry.dynamicToolNames.includes("thoth_submit_clarify_card"),
        ),
        "Packaged foreground thread did not receive Clarify dynamic tools",
      );
      assert(
        toolCalls.filter((entry) => entry.tool === "thoth_loop_submit_planexec_result").length ===
          3,
        "Expected three packaged PlanExec attempts",
      );
      assert(
        toolCalls.filter((entry) => entry.tool === "thoth_loop_submit_review_verdict").length === 3,
        "Expected three packaged Review verdicts",
      );
      const quickThreadStart = threadStarts.find((entry) => entry.cwd === quickWorkspace);
      assert(quickThreadStart, "Packaged Quick foreground thread was not captured");
      visibleTurnCount = capture.filter(
        (entry) => entry.kind === "turn_start" && entry.threadId === quickThreadStart.threadId,
      ).length;
      assert(
        visibleTurnCount === 13,
        `Expected thirteen hot-switch, @Task and Stop-probe turns, received ${visibleTurnCount}`,
      );
    }

    const runtimeAuthority = inspectRuntimeAuthority(thothHome, quickWorkspaceId, core.task.id);
    const daemonLogPath = path.join(thothHome, "daemon.log");
    const daemonLog = readFileSync(daemonLogPath, "utf8");
    assert(
      /dynamicToolCount["':=\s]+[1-9][0-9]*/u.test(daemonLog),
      "Packaged daemon log never reported a non-zero dynamicToolCount",
    );
    const durableBytes = directorySize(thothHome);
    assert(
      durableBytes < 25 * 1024 * 1024,
      `Packaged durable Thoth state exceeded 25MB: ${durableBytes} bytes`,
    );
    const migration = realCodex ? null : inspectStorageMigration(thothHome, releaseMigrationProbe);

    report = {
      ok: true,
      provider: realCodex ? "real-codex" : "scripted-codex",
      appImagePath,
      listen,
      hotAgentId: core.agent.id,
      hotSwitchTurnCount: visibleTurnCount,
      hotSessionId: core.sessionId,
      loopAgentId: core.agent.id,
      backgroundTaskId: core.task.id,
      usedFailedReviews: core.task.budget.usedFailedReviews,
      stoppedTaskId: stopTask?.id ?? null,
      visibleSessionCount: visibleSessionIds.length,
      durableBytes,
      migration,
      ...(realCodex
        ? {}
        : {
            planExecCalls: toolCalls.filter(
              (entry) => entry.tool === "thoth_loop_submit_planexec_result",
            ).length,
            reviewCalls: toolCalls.filter(
              (entry) => entry.tool === "thoth_loop_submit_review_verdict",
            ).length,
            dynamicToolThreadCount: threadStarts.filter(
              (entry) => Array.isArray(entry.dynamicToolNames) && entry.dynamicToolNames.length > 0,
            ).length,
          }),
      runtimeBundles: runtimeAuthority.bundles,
      loopAttachmentCount: runtimeAuthority.loopAttachmentCount,
    };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await client?.close().catch(() => undefined);
    if (child.exitCode === null) {
      child.stdin.write("thoth-smoke-stop\n");
      await waitForProcessExit(child, 30_000).catch(() => undefined);
    }
    rmSync(outputDir, { recursive: true, force: true });
    mkdirSync(outputDir, { recursive: true });
    for (const filePath of [
      capturePath,
      statePath,
      desktopStdoutPath,
      desktopStderrPath,
      path.join(thothHome, "daemon.log"),
      path.join(runRoot, "background-task-detail.json"),
      path.join(runRoot, "stopped-task-detail.json"),
    ]) {
      if (existsSync(filePath)) cpSync(filePath, path.join(outputDir, path.basename(filePath)));
    }
    if (failure) {
      writeFileSync(
        path.join(outputDir, "failure.json"),
        `${JSON.stringify(
          {
            message: failure instanceof Error ? failure.message : String(failure),
            stack: failure instanceof Error ? failure.stack : null,
          },
          null,
          2,
        )}\n`,
      );
      if (existsSync(thothHome)) {
        cpSync(thothHome, path.join(outputDir, "thoth-home"), { recursive: true });
      }
    }
    if (report) writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    rmSync(runRoot, { recursive: true, force: true });
  }

  process.stdout.write(`${JSON.stringify(report)}\n`);
}

await main();
