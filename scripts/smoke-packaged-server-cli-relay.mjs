#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { PackagedServerCliHarness } from "./acceptance/packaged-server-cli-harness.mjs";
import { ThothApiJourney } from "./acceptance/thoth-api-journey.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const JOURNEY_TIMEOUT_MS = 90_000;

function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback;
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const suffix = lastError ? `: ${lastError.message ?? String(lastError)}` : "";
  throw new Error(`Timed out waiting for ${label}${suffix}`);
}

async function findTask(client, workspaceId, excludedTaskIds, expectedStatus = null) {
  return await waitFor(
    async () => {
      const result = await client.listTasks(workspaceId);
      if (result.error) throw new Error(result.error);
      const candidate = result.tasks.find(
        (task) =>
          !excludedTaskIds.has(task.id) &&
          (expectedStatus === null || task.status === expectedStatus),
      );
      return candidate ?? null;
    },
    30_000,
    `new Task${expectedStatus ? ` in ${expectedStatus}` : ""}`,
  );
}

function inspectAuthority(thothHome, workspaceId, taskId) {
  invariant(
    !existsSync(path.join(thothHome, "provider-sessions")),
    "Packaged server daemon recreated the removed provider-sessions tree",
  );
  const authorityPath = path.join(thothHome, "workspaces", workspaceId, "authority.sqlite");
  invariant(existsSync(authorityPath), `Workspace authority database not found: ${authorityPath}`);
  const database = new DatabaseSync(authorityPath, { readOnly: true });
  try {
    const attachments = database
      .prepare(
        `SELECT e.execution_id, e.phase_kind, a.bundle_id, a.bundle_digest, a.status
           FROM execution_attempts e
           LEFT JOIN runtime_attachments a ON a.execution_id = e.execution_id
          WHERE e.task_id = ? AND e.phase_kind IN ('planexec', 'review')
          ORDER BY e.started_at ASC`,
      )
      .all(taskId);
    invariant(
      attachments.length === 6,
      `Expected six Loop attempts, received ${attachments.length}`,
    );
    invariant(
      attachments.every(
        (entry) =>
          entry.bundle_id === "thoth.loop" &&
          entry.status === "attached" &&
          typeof entry.bundle_digest === "string",
      ),
      "A Relay Loop execution started without a durable thoth.loop attachment receipt",
    );
    return { loopAttachmentCount: attachments.length };
  } finally {
    database.close();
  }
}

const tgzPath = option(
  "--tgz",
  path.join(root, ".dev/release-artifacts/thoth-server-cli-0.0.0-mvp-beta.tgz"),
);
const outputDir = option("--output-dir", path.join(root, ".dev/server-cli-relay-smoke"));
const harness = new PackagedServerCliHarness({ root, tgzPath });
let client = null;
let report = null;
let failure = null;
let latestStopDetail = null;

try {
  harness.install();
  await harness.start();

  const direct = await harness.connectDirect();
  const workspaceResult = await direct.createWorkspace({
    source: { kind: "directory", path: harness.workspacePath },
  });
  await direct.close();
  invariant(
    !workspaceResult.error && workspaceResult.workspace,
    `Failed to register packaged server workspace: ${workspaceResult.error}`,
  );
  const workspaceId = workspaceResult.workspace.id;

  client = await harness.connectRelay();
  let journey = new ThothApiJourney({
    client,
    timeoutMs: JOURNEY_TIMEOUT_MS,
    commandPrefix: "server-cli-relay",
  });
  const core = await journey.runCore({
    workspaceId,
    agentConfig: { provider: "codex", model: "gpt-5.4", modeId: "auto" },
    prompts: {
      rawFirst: "PACKAGED_RAW_FIRST",
      quick: "PACKAGED_QUICK_CLARIFY",
      rawLast: "PACKAGED_RAW_LAST",
      loop: "PACKAGED_LOOP_RETRY",
    },
  });
  writeFileSync(
    path.join(harness.runRoot, "relay-background-task.json"),
    JSON.stringify(core.task, null, 2),
  );

  await client.close();
  client = await harness.connectRelay();
  journey = new ThothApiJourney({
    client,
    timeoutMs: JOURNEY_TIMEOUT_MS,
    commandPrefix: "server-cli-client-restart",
  });
  const restoredAgent = await client.fetchAgent({ agentId: core.agent.id });
  invariant(
    restoredAgent?.agent.id === core.agent.id,
    "Relay client restart lost the visible Agent",
  );
  invariant(
    await journey.sessionId(core.agent.id),
    "Relay client restart lost the provider thread identity",
  );

  await client.sendAgentMessage(core.agent.id, "PACKAGED_QUICK_AFTER_RESTART", {
    thoth: { enabled: true, executionMode: "quick", clarifyStrength: "light" },
  });
  const pendingBeforeRestart = await journey.waitForLifecycle(core.agent.id, "awaiting_card");
  invariant(pendingBeforeRestart.pendingCard, "Restart probe did not reach an open Card");
  const pendingCardId = pendingBeforeRestart.pendingCard.card.id;
  await client.close();
  client = null;

  await harness.restart();
  client = await harness.connectRelay();
  journey = new ThothApiJourney({
    client,
    timeoutMs: JOURNEY_TIMEOUT_MS,
    commandPrefix: "server-cli-daemon-restart",
  });
  const pendingAfterRestart = await client.getAgentThothState(core.agent.id);
  invariant(!pendingAfterRestart.error, `Restart state failed: ${pendingAfterRestart.error}`);
  invariant(
    pendingAfterRestart.state.pendingCard?.card.id === pendingCardId,
    "Daemon restart did not restore the exact open Card",
  );
  await journey.approveCardChain(core.agent.id, "quick");
  await journey.waitForLifecycle(core.agent.id, "done");
  await journey.waitForAgentIdle(core.agent.id);
  invariant(
    (await journey.sessionId(core.agent.id)) === core.sessionId,
    "Daemon restart replaced the visible provider thread lineage",
  );

  const existingTasks = await client.listTasks(workspaceId);
  invariant(!existingTasks.error, `Task listing failed: ${existingTasks.error}`);
  const excludedTaskIds = new Set(existingTasks.tasks.map((task) => task.id));
  harness.patchState({ holdPlanExec: true });
  await client.sendAgentMessage(core.agent.id, "PACKAGED_LOOP_PAUSE", {
    thoth: {
      enabled: true,
      executionMode: "loop",
      clarifyStrength: "light",
      loopStrength: "light",
    },
  });
  await journey.approveCardChain(core.agent.id, "loop");
  await journey.waitForLifecycle(core.agent.id, "background_handoff");
  const pauseTask = await findTask(client, workspaceId, excludedTaskIds);
  excludedTaskIds.add(pauseTask.id);
  await waitFor(
    async () =>
      harness.readCapture().some((entry) => entry.kind === "planexec_hold" && entry.threadId) ||
      null,
    30_000,
    "held Relay PlanExec",
  );
  const pauseProjection = await client.getTask({ taskId: pauseTask.id, workspaceId });
  invariant(pauseProjection.task, "Pause Task projection is missing");
  const pauseResult = await client.commandTask({
    workspaceId,
    taskId: pauseTask.id,
    command: "pause",
    expectedRevision: pauseProjection.task.revision,
    commandId: "server-cli-pause",
  });
  invariant(!pauseResult.error && !pauseResult.conflict, `Pause failed: ${pauseResult.error}`);
  harness.patchState({ holdPlanExec: false });
  const paused = await waitFor(
    async () => {
      const detail = await client.getTask({ taskId: pauseTask.id, workspaceId });
      return detail.task?.status === "paused" ? detail.task : null;
    },
    30_000,
    "paused Task boundary",
  );
  invariant(paused.id === pauseTask.id, "A different Task satisfied the pause boundary");
  const resumeResult = await client.commandTask({
    workspaceId,
    taskId: pauseTask.id,
    command: "resume",
    expectedRevision: paused.revision,
    commandId: "server-cli-resume",
  });
  invariant(!resumeResult.error && !resumeResult.conflict, `Resume failed: ${resumeResult.error}`);
  const resumedTask = await waitFor(
    async () => {
      const detail = await client.getTask({ taskId: pauseTask.id, workspaceId });
      return detail.task?.status === "completed" ? detail.task : null;
    },
    60_000,
    "resumed Relay Task completion",
  );

  harness.patchState({ holdPlanExec: true });
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
  const stopTask = await findTask(client, workspaceId, excludedTaskIds);
  const stopDetail = await waitFor(
    async () => {
      const detail = await client.getTask({ taskId: stopTask.id, workspaceId });
      return detail.executions.some((execution) =>
        ["created", "starting", "running", "awaiting_provider"].includes(execution.status),
      )
        ? detail
        : null;
    },
    30_000,
    "active Relay Stop execution",
  );
  const stopResult = await client.commandTask({
    workspaceId,
    taskId: stopTask.id,
    command: "stop",
    expectedRevision: stopDetail.task.revision,
    commandId: "server-cli-stop",
  });
  invariant(!stopResult.error && !stopResult.conflict, `Stop failed: ${stopResult.error}`);
  const stopped = await waitFor(
    async () => {
      const detail = await client.getTask({ taskId: stopTask.id, workspaceId });
      latestStopDetail = detail;
      if (detail.task?.status !== "stopped") return null;
      return detail.executions.every(
        (execution) =>
          !["created", "starting", "running", "awaiting_provider"].includes(execution.status),
      )
        ? detail
        : null;
    },
    30_000,
    "stopped Relay Task without running spinner",
  );
  harness.patchState({ holdPlanExec: false });

  const authority = inspectAuthority(harness.thothHome, workspaceId, core.task.id);
  const capture = harness.readCapture();
  const toolCalls = capture.filter((entry) => entry.kind === "tool_call");
  const turnErrors = capture.filter((entry) => entry.kind === "turn_error");
  invariant(turnErrors.length === 0, `Provider fixture errors: ${JSON.stringify(turnErrors)}`);
  invariant(
    toolCalls.some((entry) => entry.tool === "thoth_submit_clarify_card"),
    "Relay daemon never received a Clarify runtime-tool call",
  );
  invariant(
    toolCalls.filter((entry) => entry.tool === "thoth_loop_submit_planexec_result").length >= 5,
    "Relay daemon did not complete the core and resumed PlanExec phases",
  );
  invariant(
    toolCalls.filter((entry) => entry.tool === "thoth_loop_submit_review_verdict").length >= 5,
    "Relay daemon did not complete the core and resumed Review phases",
  );

  report = {
    ok: true,
    transport: "hosted-relay-v3-e2ee",
    relayEndpoint: harness.relayEndpoint,
    workspaceId,
    agentId: core.agent.id,
    providerThreadId: core.sessionId,
    backgroundTaskId: core.task.id,
    usedFailedReviews: core.task.budget.usedFailedReviews,
    restartedCardId: pendingCardId,
    pausedTaskId: pauseTask.id,
    resumedTaskStatus: resumedTask.status,
    stoppedTaskId: stopTask.id,
    stoppedExecutionCount: stopped.executions.length,
    loopAttachmentCount: authority.loopAttachmentCount,
    planExecCalls: toolCalls.filter((entry) => entry.tool === "thoth_loop_submit_planexec_result")
      .length,
    reviewCalls: toolCalls.filter((entry) => entry.tool === "thoth_loop_submit_review_verdict")
      .length,
  };
  harness.assertPairingSecretsAbsent([JSON.stringify(report)]);
} catch (error) {
  failure = error;
  throw error;
} finally {
  await client?.close().catch(() => undefined);
  await harness.stop().catch(() => undefined);
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  for (const filePath of [
    harness.capturePath,
    harness.statePath,
    path.join(harness.thothHome, "daemon.log"),
    path.join(harness.runRoot, "relay-background-task.json"),
  ]) {
    if (existsSync(filePath)) cpSync(filePath, path.join(outputDir, path.basename(filePath)));
  }
  const workspaceAuthorityPath = path.join(harness.thothHome, "workspaces");
  if (failure && existsSync(workspaceAuthorityPath)) {
    cpSync(workspaceAuthorityPath, path.join(outputDir, "workspaces"), { recursive: true });
  }
  if (latestStopDetail) {
    writeFileSync(
      path.join(outputDir, "last-stop-task-detail.json"),
      `${JSON.stringify(latestStopDetail, null, 2)}\n`,
    );
  }
  if (failure) {
    writeFileSync(
      path.join(outputDir, "failure.json"),
      `${JSON.stringify(
        {
          message: harness.redact(failure instanceof Error ? failure.message : String(failure)),
          stack: harness.redact(failure instanceof Error ? (failure.stack ?? "") : "") || null,
        },
        null,
        2,
      )}\n`,
    );
  }
  if (report) {
    writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  harness.cleanup();
}

process.stdout.write(`${JSON.stringify(report)}\n`);
