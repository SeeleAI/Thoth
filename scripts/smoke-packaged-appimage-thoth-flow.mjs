import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { createServer } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { DaemonClient } from "../packages/client/dist/daemon-client.js";
import { ThothApiJourney } from "./acceptance/thoth-api-journey.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const realCodex = args.includes("--real-codex");
const REQUIRED_DESKTOP_BRIDGE_KEYS = [
  "platform",
  "invoke",
  "getPendingOpenProject",
  "events",
  "window",
  "dialog",
  "notification",
  "opener",
  "editor",
  "webUtils",
  "menu",
  "browser",
];
const PACKAGED_SCRIPT_NAME = "packaged-web-service";
const LARGE_FILE_NAME = "packaged-large-file.bin";
const LARGE_FILE_SIZE = 1024 * 1024 + 73;

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

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert(
    result.status === 0,
    `Git fixture command failed (${args.join(" ")}): ${result.stderr || result.stdout}`,
  );
}

function seedProductSurfaceWorkspace(workspace) {
  const baseline = ["# Packaged product surface", "", "PACKAGED_BASELINE", ""].join("\n");
  const committed = `${baseline}PACKAGED_COMMITTED_BASE\n`;
  writeFileSync(path.join(workspace, "README.md"), baseline);
  writeFileSync(
    path.join(workspace, "thoth.json"),
    `${JSON.stringify(
      {
        scripts: {
          [PACKAGED_SCRIPT_NAME]: {
            type: "service",
            command:
              "node -e \"const http = require('http'); const server = http.createServer((_request, response) => response.end('PACKAGED_SCRIPT_OK')); server.listen(process.env.PORT || 3000)\"",
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  runGit(workspace, ["init", "-b", "main"]);
  runGit(workspace, ["config", "user.name", "Thoth Packaged Smoke"]);
  runGit(workspace, ["config", "user.email", "packaged-smoke@thoth.local"]);
  runGit(workspace, ["add", "README.md", "thoth.json"]);
  runGit(workspace, ["commit", "-m", "seed packaged product surface baseline"]);
  runGit(workspace, ["checkout", "-b", "packaged-feature"]);
  writeFileSync(path.join(workspace, "README.md"), committed);
  runGit(workspace, ["add", "README.md"]);
  runGit(workspace, ["commit", "-m", "add packaged committed change"]);
  writeFileSync(path.join(workspace, "README.md"), `${committed}PACKAGED_UNCOMMITTED_CHANGE\n`);
}

function seedLargeFile(workspace) {
  const bytes = Buffer.allocUnsafe(LARGE_FILE_SIZE);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (index * 31 + 17) % 256;
  }
  writeFileSync(path.join(workspace, LARGE_FILE_NAME), bytes);
  return {
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function verifyLargeFileTransfer(client, workspace, expected) {
  const received = await client.readFile(workspace, LARGE_FILE_NAME, "packaged-large-file-read");
  assert(received.size === expected.size, "Packaged large-file advertised size changed");
  assert(received.bytes.byteLength === expected.size, "Packaged large-file bytes were truncated");
  const sha256 = createHash("sha256").update(received.bytes).digest("hex");
  assert(sha256 === expected.sha256, "Packaged large-file SHA-256 mismatch");
  return {
    path: LARGE_FILE_NAME,
    size: received.size,
    sha256,
    revision: received.revision ?? null,
    expectedChunkCount: Math.ceil(received.size / (256 * 1024)),
  };
}

async function startBrowserFixture() {
  const server = createServer((request, response) => {
    const complete = request.url === "/complete";
    const marker = complete ? "PACKAGED_BROWSER_COMPLETE" : "PACKAGED_BROWSER_START";
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(
      `<!doctype html><html><head><title>${marker}</title></head><body><main><h1>${marker}</h1><p>Host-wide persistent profile packaged acceptance.</p></main></body></html>`,
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object", "Browser fixture did not bind a TCP port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function visibleTestId(page, testId, timeout = 30_000) {
  const locator = page.getByTestId(testId).filter({ visible: true }).first();
  await locator.waitFor({ state: "visible", timeout });
  return locator;
}

async function ensureDiffFileExpanded(page, fileIndex = 0) {
  const body = page.getByTestId(`diff-file-${fileIndex}-body`).filter({ visible: true }).first();
  if (!(await body.isVisible())) {
    await (await visibleTestId(page, `diff-file-${fileIndex}`)).click();
  }
  await body.waitFor({ state: "visible", timeout: 30_000 });
  return body;
}

async function inspectFilesAndChangesSurface(page, input) {
  const workspaceRoute = `thoth://app/h/${encodeURIComponent(input.serverId)}/workspace/${encodeURIComponent(input.workspaceId)}`;
  await page.goto(workspaceRoute);
  await page.setViewportSize({ width: 1400, height: 900 });
  await (await visibleTestId(page, "workspace-explorer-toggle")).click();

  await (await visibleTestId(page, "explorer-tab-changes")).click();
  await visibleTestId(page, "changes-header");
  await page.getByText("README.md", { exact: true }).filter({ visible: true }).first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
  const uncommittedBody = await ensureDiffFileExpanded(page);
  assert(
    (await uncommittedBody.textContent())?.includes("PACKAGED_UNCOMMITTED_CHANGE"),
    "Packaged Changes did not render the uncommitted README diff",
  );

  await (await visibleTestId(page, "changes-diff-status")).click();
  await (await visibleTestId(page, "changes-diff-mode-committed")).click();
  await page.getByText("README.md", { exact: true }).filter({ visible: true }).first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
  const committedBody = await ensureDiffFileExpanded(page);
  assert(
    (await committedBody.textContent())?.includes("PACKAGED_COMMITTED_BASE"),
    "Packaged Changes did not render the committed README diff",
  );

  await (await visibleTestId(page, "explorer-tab-files")).click();
  await visibleTestId(page, "files-pane-header");
  const readme = page.getByText("README.md", { exact: true }).filter({ visible: true }).first();
  await readme.waitFor({ state: "visible", timeout: 30_000 });
  await readme.click();
  const filePane = await visibleTestId(page, "workspace-file-pane");
  await waitFor(
    async () =>
      (await filePane.textContent())?.includes("PACKAGED_UNCOMMITTED_CHANGE") ? true : null,
    30_000,
    "packaged Files read-only README content",
  );

  return {
    workspaceRoute,
    files: { readOnlyFile: "README.md", marker: "PACKAGED_UNCOMMITTED_CHANGE" },
    changes: {
      uncommittedMarker: "PACKAGED_UNCOMMITTED_CHANGE",
      committedMarker: "PACKAGED_COMMITTED_BASE",
    },
  };
}

async function runWorkspaceScriptsSurfaceAcceptance({ client, page, serverId, workspaceId }) {
  const workspaceRoute = `thoth://app/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}`;
  await page.goto(workspaceRoute);
  const tasksSurface = page
    .getByTestId("workspace-background-tasks-surface")
    .filter({ visible: true })
    .first();
  await tasksSurface.waitFor({ state: "visible", timeout: 30_000 });
  await (await visibleTestId(page, "workspace-background-tasks-close")).click();
  await tasksSurface.waitFor({ state: "hidden", timeout: 30_000 });
  await (await visibleTestId(page, "workspace-scripts-button")).click();
  await visibleTestId(page, "workspace-scripts-menu");
  await (await visibleTestId(page, `workspace-scripts-start-${PACKAGED_SCRIPT_NAME}`)).click();
  const item = await visibleTestId(page, `workspace-scripts-item-${PACKAGED_SCRIPT_NAME}`);
  await item.waitFor({ state: "visible", timeout: 30_000 });
  const running = await waitFor(
    async () => {
      const listed = await client.listWorkspaceScripts({ workspaceId });
      const script = listed.scripts.find((entry) => entry.scriptName === PACKAGED_SCRIPT_NAME);
      return script?.lifecycle === "running" && script.port ? script : null;
    },
    30_000,
    "packaged Workspace script running projection",
  );
  assert(
    (await item.textContent())?.includes(`localhost:${running.port}`),
    "Packaged Workspace scripts UI omitted the service port",
  );
  await (await visibleTestId(page, `workspace-scripts-stop-${PACKAGED_SCRIPT_NAME}`)).click();
  const stopped = await waitFor(
    async () => {
      const listed = await client.listWorkspaceScripts({ workspaceId });
      const script = listed.scripts.find((entry) => entry.scriptName === PACKAGED_SCRIPT_NAME);
      return script?.lifecycle === "stopped" ? script : null;
    },
    30_000,
    "packaged Workspace script stopped projection",
  );
  await visibleTestId(page, `workspace-scripts-start-${PACKAGED_SCRIPT_NAME}`);
  return {
    scriptName: PACKAGED_SCRIPT_NAME,
    command: running.command,
    runningPort: running.port,
    runningTerminalId: running.terminalId,
    finalLifecycle: stopped.lifecycle,
    route: workspaceRoute,
  };
}

async function runScheduleSurfaceAcceptance({ client, page, serverId, workspaceId }) {
  const taskTemplates = await client.listTasks(workspaceId);
  const template = taskTemplates.tasks.find((task) => task.intentContract?.status === "confirmed");
  assert(template, "Packaged Schedule has no confirmed Intent Contract template");
  const route = `thoth://app/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}/tasks`;
  await page.goto(route);
  await visibleTestId(page, "tasks-surface");
  await (await visibleTestId(page, "schedules-tab")).click();
  await visibleTestId(page, "schedules-panel");
  await (await visibleTestId(page, "schedule-create-open")).click();
  await (await visibleTestId(page, "schedule-name")).fill("Packaged Schedule");
  await (await visibleTestId(page, "schedule-prompt")).fill("PACKAGED_SCHEDULE_RUN");
  await (await visibleTestId(page, "schedule-provider")).fill("codex");
  await (await visibleTestId(page, "schedule-model")).fill("gpt-5.4");
  await (await visibleTestId(page, "schedule-mode")).fill("full-access");
  await (await visibleTestId(page, "schedule-max-runs")).fill("2");
  await (
    await visibleTestId(page, `schedule-intent-contract-${template.intentContract.id}`)
  ).click();
  await (await visibleTestId(page, "schedule-create-submit")).click();
  await visibleTestId(page, "schedule-detail");

  const created = await waitFor(
    async () => {
      const listed = await client.scheduleList({ workspaceId });
      return listed.schedules.find((schedule) => schedule.name === "Packaged Schedule") ?? null;
    },
    30_000,
    "packaged Schedule created through UI",
  );
  const initialRun = await waitFor(
    async () => {
      const inspected = await client.scheduleInspect({ workspaceId, id: created.id });
      return inspected.schedule?.runs.findLast((entry) => entry.status === "succeeded") ?? null;
    },
    60_000,
    "packaged Schedule run-on-create through UI",
  );
  await (await visibleTestId(page, "schedule-edit-open")).click();
  await (await visibleTestId(page, "schedule-name")).fill("Packaged Schedule Updated");
  await (await visibleTestId(page, "schedule-edit-submit")).click();
  await waitFor(
    async () => {
      const inspected = await client.scheduleInspect({ workspaceId, id: created.id });
      return inspected.schedule?.name === "Packaged Schedule Updated" ? inspected.schedule : null;
    },
    30_000,
    "packaged Schedule edited through UI",
  );
  await (await visibleTestId(page, "schedule-pause")).click();
  await waitFor(
    async () => {
      const inspected = await client.scheduleInspect({ workspaceId, id: created.id });
      return inspected.schedule?.status === "paused" ? inspected.schedule : null;
    },
    30_000,
    "packaged Schedule paused through UI",
  );
  await (await visibleTestId(page, "schedule-resume")).click();
  await waitFor(
    async () => {
      const inspected = await client.scheduleInspect({ workspaceId, id: created.id });
      return inspected.schedule?.status === "active" ? inspected.schedule : null;
    },
    30_000,
    "packaged Schedule resumed through UI",
  );
  await (await visibleTestId(page, "schedule-run-now")).click();
  const fired = await waitFor(
    async () => {
      const inspected = await client.scheduleInspect({ workspaceId, id: created.id });
      const successful = inspected.schedule?.runs.findLast(
        (entry) => entry.status === "succeeded" && entry.id !== initialRun.id,
      );
      return successful ? { schedule: inspected.schedule, run: successful } : null;
    },
    60_000,
    "packaged Schedule run triggered through UI",
  );
  const run = fired.run;
  assert(run?.status === "succeeded", "Packaged Schedule did not reach succeeded");
  assert(typeof run.taskId === "string", "Packaged Schedule did not create a real Task");
  assert(run.executionId === null, "Schedule trigger fabricated an Execution identity");

  const task = await waitFor(
    async () => {
      const detail = await client.getTask({ workspaceId, taskId: run.taskId });
      if (detail.error) throw new Error(detail.error);
      for (const execution of detail.executions) {
        const approval = execution.pendingApproval;
        if (!approval) continue;
        const resolved = await client.resolveExecutionApproval({
          workspaceId,
          taskId: run.taskId,
          executionId: execution.id,
          approvalId: approval.id,
          decision: approval.kind === "implement" ? "implement" : "allow",
          expectedRevision: approval.revision,
          commandId: `packaged-schedule-approval-${approval.id}`,
        });
        if (resolved.error && !resolved.conflict) throw new Error(resolved.error);
      }
      return detail.task?.status === "completed" ? detail : null;
    },
    60_000,
    "packaged Schedule background Task completion",
  );
  assert(task.task?.mode === "loop", "Packaged Schedule did not register a Loop Task");
  assert(
    task.task?.origin?.type === "schedule" && task.task.origin.scheduleId === created.id,
    "Packaged Schedule Task lost its durable origin",
  );
  assert(
    task.executions.length >= 2 &&
      task.executions.every((execution) => execution.attachment?.bundleId === "thoth.loop"),
    "Packaged Schedule Task bypassed the Loop RuntimeBundle",
  );
  const timelinePages = await Promise.all(
    task.executions.map((execution) =>
      client.getExecutionTimeline({
        workspaceId,
        taskId: run.taskId,
        executionId: execution.id,
        limit: 100,
      }),
    ),
  );
  const timelineTypes = timelinePages.flatMap((timeline) =>
    timeline.entries.map((entry) => entry.item?.type).filter(Boolean),
  );
  assert(
    timelinePages.every((timeline) => !timeline.error && timeline.entries.length > 0),
    `Packaged Schedule execution Timeline is incomplete: ${JSON.stringify(timelineTypes)}`,
  );

  await visibleTestId(page, `schedule-run-${run.id}`);
  await (await visibleTestId(page, `schedule-open-task-${run.id}`)).click();
  await visibleTestId(page, `background-task-row-${run.taskId}`);
  await (await visibleTestId(page, "background-task-open-schedule")).click();
  const scheduleDetail = await visibleTestId(page, "schedule-detail");
  assert(
    (await scheduleDetail.textContent())?.includes("Packaged Schedule Updated"),
    "Packaged Task-to-Schedule reverse navigation lost the Schedule",
  );
  return {
    scheduleId: created.id,
    taskId: run.taskId,
    executionId: task.executions[0]?.id ?? null,
    status: run.status,
    timelineTypes,
    route,
    createdThroughUi: true,
    runOnCreateThroughUi: true,
    editedThroughUi: true,
    pauseResumeThroughUi: true,
    runNowThroughUi: true,
    bidirectionalNavigation: true,
  };
}

async function runNativePlanQuestionSurfaceAcceptance({
  client,
  page,
  serverId,
  workspaceId,
  agentId,
  expectedSessionId,
}) {
  const before = await client.fetchAgent({ agentId });
  const beforeSessionId =
    before?.agent.persistence?.sessionId ?? before?.agent.runtimeInfo?.sessionId ?? null;
  assert(
    beforeSessionId === expectedSessionId,
    "Packaged Plan UI started on the wrong Provider thread",
  );

  const route = `thoth://app/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}?open=${encodeURIComponent(`agent:${agentId}`)}`;
  await page.goto(route);
  await page.setViewportSize({ width: 1400, height: 900 });
  await (await visibleTestId(page, "agent-provider-config", 60_000)).click();
  await visibleTestId(page, "agent-provider-config-sheet", 30_000);
  const planStatus = await visibleTestId(page, "provider-plan-feature-status", 120_000);
  await waitFor(
    async () => ((await planStatus.textContent())?.trim() === "Off" ? true : null),
    120_000,
    "packaged native Plan capability",
  );
  await (await visibleTestId(page, "provider-plan-feature", 30_000)).click();
  await waitFor(
    async () => ((await planStatus.textContent())?.trim() === "On" ? true : null),
    30_000,
    "packaged native Plan activation",
  );
  await page.keyboard.press("Escape");
  await page
    .getByTestId("agent-provider-config-sheet")
    .waitFor({ state: "hidden", timeout: 30_000 });

  const composer = page
    .getByRole("textbox", { name: "Message agent..." })
    .filter({ visible: true })
    .first();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.fill(
    [
      "PACKAGED_NATIVE_PLAN_UI",
      "Use native Plan mode for this turn.",
      "Before completing the Plan, ask which target to report: Local or CI.",
      "After I approve Implement, reply exactly PACKAGED_NATIVE_PLAN_IMPLEMENTED.",
      "Do not modify files during the Plan turn.",
    ].join("\n"),
  );
  await composer.press("Enter");

  const questionCard = await visibleTestId(page, "question-form-card", 120_000);
  assert(
    (await page.getByTestId("permission-plan-card").filter({ visible: true }).count()) === 0,
    "Packaged UI exposed Implement while a Provider question was pending",
  );
  await questionCard.getByRole("button", { name: "Local", exact: true }).click();
  await (await visibleTestId(page, "question-form-primary-action", 30_000)).click();
  await questionCard.waitFor({ state: "hidden", timeout: 30_000 });

  const planCard = await visibleTestId(page, "permission-plan-card", 120_000);
  const planText = (await planCard.textContent()) ?? "";
  assert(planText.includes("Local"), "Packaged completed Plan omitted the structured Local answer");
  assert(!planText.includes("Clarify card"), "Packaged native Plan inherited Clarify instructions");
  await planCard.getByTestId("permission-request-accept").click();
  const implemented = page
    .getByTestId("assistant-message")
    .filter({ hasText: "PACKAGED_NATIVE_PLAN_IMPLEMENTED", visible: true })
    .first();
  await implemented.waitFor({ state: "visible", timeout: 120_000 });
  await waitFor(
    async () => {
      const snapshot = await client.fetchAgent({ agentId });
      return snapshot?.agent.status === "idle" ? snapshot : null;
    },
    120_000,
    "packaged native Plan implementation settlement",
  );
  const after = await client.fetchAgent({ agentId });
  const afterSessionId =
    after?.agent.persistence?.sessionId ?? after?.agent.runtimeInfo?.sessionId ?? null;
  assert(
    afterSessionId === expectedSessionId,
    "Packaged Implement minted a replacement Provider thread",
  );
  assert(
    (after?.agent.pendingProviderQuestions ?? []).length === 0,
    "Packaged Provider question remained pending after structured submission",
  );
  return {
    route,
    providerThreadId: expectedSessionId,
    sameThread: true,
    activatedThroughProviderFeatures: true,
    questionAnsweredThroughUi: true,
    questionId: "target",
    answerValues: ["Local"],
    implementOpenedOnlyAfterCompletedPlan: true,
    implementationMarker: "PACKAGED_NATIVE_PLAN_IMPLEMENTED",
  };
}

async function openDecisionTreeSurface({
  page,
  serverId,
  workspaceId,
  agentId,
  viewportWidth = 1400,
  expectedPresentation = null,
}) {
  const route = `thoth://app/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}?open=${encodeURIComponent(`agent:${agentId}`)}`;
  await page.goto(route);
  await page.setViewportSize({ width: viewportWidth, height: 900 });
  const presentation = await waitFor(
    async () => {
      if (
        await page.getByTestId("decision-tree-fullscreen").filter({ visible: true }).isVisible()
      ) {
        return expectedPresentation && !["overlay", "overlay-open"].includes(expectedPresentation)
          ? null
          : "overlay-open";
      }
      if (await page.getByTestId("decision-tree-sidebar").filter({ visible: true }).isVisible()) {
        return expectedPresentation && expectedPresentation !== "docked" ? null : "docked";
      }
      if (await page.getByTestId("decision-tree-open").filter({ visible: true }).isVisible()) {
        return expectedPresentation && expectedPresentation !== "overlay" ? null : "overlay";
      }
      return null;
    },
    60_000,
    expectedPresentation
      ? `packaged Decision Tree ${expectedPresentation} presentation`
      : "packaged Decision Tree presentation",
  );
  if (presentation === "overlay") {
    await page.getByTestId("decision-tree-open").filter({ visible: true }).click();
    await visibleTestId(page, "decision-tree-fullscreen", 30_000);
  }
  await visibleTestId(page, "decision-tree-canvas", 30_000);
  await visibleTestId(page, "decision-tree-node-packaged-scope", 30_000);
  await visibleTestId(page, "decision-tree-node-packaged-evidence", 30_000);
  const edgeCount = await waitFor(
    async () => {
      const count = await page.locator('[data-testid^="decision-tree-edge-"]').count();
      return count >= 2 ? count : null;
    },
    30_000,
    "packaged Decision Tree hierarchy edges",
  );
  return { route, edgeCount, presentation, viewportWidth };
}

async function closeDecisionTreeOverlay(page, surface) {
  if (!surface.presentation.startsWith("overlay")) return;
  await page.getByRole("button", { name: "Close decision tree" }).click();
  await page.getByTestId("decision-tree-fullscreen").waitFor({ state: "hidden", timeout: 30_000 });
}

async function inspectDecisionTreeActivitySurface({
  page,
  serverId,
  workspaceId,
  agentId,
  screenshotPath,
}) {
  const surface = await openDecisionTreeSurface({
    page,
    serverId,
    workspaceId,
    agentId,
    viewportWidth: 900,
    expectedPresentation: "overlay",
  });
  await visibleTestId(page, "decision-tree-node-activity-packaged-scope", 30_000);
  assert(
    (await page.getByTestId("decision-tree-active-card").filter({ visible: true }).count()) === 0,
    "Packaged Decision Tree opened a Card before the active investigation completed",
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await closeDecisionTreeOverlay(page, surface);
  return {
    ...surface,
    nodeIds: ["packaged-scope", "packaged-evidence"],
    activityNodeId: "packaged-scope",
    screenshotPath,
  };
}

async function inspectDecisionTreeCardSurface({
  page,
  serverId,
  workspaceId,
  agentId,
  screenshotPath,
}) {
  const surface = await openDecisionTreeSurface({
    page,
    serverId,
    workspaceId,
    agentId,
    viewportWidth: 900,
    expectedPresentation: "overlay-open",
  });
  await visibleTestId(page, "decision-tree-active-card", 30_000);
  assert(
    (await page
      .getByTestId("decision-tree-node-activity-packaged-scope")
      .filter({ visible: true })
      .count()) === 0,
    "Packaged Decision Tree retained an active spinner while the Human Card owned the decision",
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await closeDecisionTreeOverlay(page, surface);
  return {
    ...surface,
    nodeIds: ["packaged-scope", "packaged-evidence"],
    cardInInspector: true,
    screenshotPath,
  };
}

async function inspectFrozenDecisionTreeGeometry({
  page,
  serverId,
  workspaceId,
  agentId,
  screenshotPath,
  narrowScreenshotPath,
}) {
  const surface = await openDecisionTreeSurface({
    page,
    serverId,
    workspaceId,
    agentId,
    viewportWidth: 2200,
    expectedPresentation: "docked",
  });
  assert(surface.presentation === "docked", "Wide Agent pane did not dock the Decision Tree");
  const sidebar = await visibleTestId(page, "decision-tree-sidebar", 30_000);
  const canvas = await visibleTestId(page, "decision-tree-canvas", 30_000);
  const chat = await visibleTestId(page, "agent-chat-scroll", 30_000);
  const taskLeaf = await visibleTestId(page, "decision-tree-task-leaf", 30_000);
  const scopeNode = await visibleTestId(page, "decision-tree-node-packaged-scope", 30_000);
  const [sidebarBox, canvasBox, chatBox, taskBox, scopeBox] = await Promise.all([
    sidebar.boundingBox(),
    canvas.boundingBox(),
    chat.boundingBox(),
    taskLeaf.boundingBox(),
    scopeNode.boundingBox(),
  ]);
  assert(
    sidebarBox && canvasBox && chatBox && taskBox && scopeBox,
    "Decision Tree geometry is missing",
  );
  assert(
    chatBox.x + chatBox.width <= sidebarBox.x + 1,
    "Decision Tree sidebar overlaps the Agent conversation",
  );
  assert(chatBox.width >= 420, `Agent conversation is too narrow: ${chatBox.width}`);
  assert(
    taskBox.x >= canvasBox.x - 1 &&
      taskBox.y >= canvasBox.y - 1 &&
      taskBox.x + taskBox.width <= canvasBox.x + canvasBox.width + 1 &&
      taskBox.y + taskBox.height <= canvasBox.y + canvasBox.height + 1,
    "Frozen Task leaf is clipped outside the fitted Decision Tree canvas",
  );
  assert(
    scopeBox.y - canvasBox.y < 180,
    `Small frozen Decision Tree is vertically centered instead of top-aligned: ${scopeBox.y - canvasBox.y}`,
  );
  const overflowingNodes = await page
    .locator(
      '[data-testid^="decision-tree-node-"]:not([data-testid^="decision-tree-node-activity-"])',
    )
    .evaluateAll((nodes) =>
      nodes.flatMap((node) => {
        const card = node.parentElement;
        if (!card) return [node.getAttribute("data-testid") ?? "unknown"];
        return card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1
          ? [node.getAttribute("data-testid") ?? "unknown"]
          : [];
      }),
    );
  assert(
    overflowingNodes.length === 0,
    `Decision Tree node content overflowed: ${overflowingNodes.join(", ")}`,
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.setViewportSize({ width: 900, height: 900 });
  await visibleTestId(page, "decision-tree-open", 30_000);
  assert(
    (await page.getByTestId("decision-tree-sidebar").filter({ visible: true }).count()) === 0,
    "Constrained Agent pane kept the docked Decision Tree over the conversation",
  );
  await page.screenshot({ path: narrowScreenshotPath, fullPage: true });
  await page.setViewportSize({ width: 2200, height: 900 });
  await visibleTestId(page, "decision-tree-sidebar", 30_000);
  return {
    ...surface,
    conversationWidth: chatBox.width,
    taskLeafInsideCanvas: true,
    nodeContentOverflowCount: overflowingNodes.length,
    topInset: scopeBox.y - canvasBox.y,
    screenshotPath,
    constrainedUsesOverlay: true,
    narrowScreenshotPath,
  };
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

async function connectToPackagedRenderer({ child, cdpPort }) {
  const browser = await waitFor(
    async () => {
      assert(child.exitCode === null, `Packaged desktop exited early with code ${child.exitCode}`);
      try {
        return await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      } catch {
        return null;
      }
    },
    60_000,
    "packaged desktop CDP endpoint",
  );
  const page = await waitFor(
    async () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith("thoth://app/")) ?? null,
    60_000,
    "packaged thoth://app/ renderer",
  );
  await page.waitForFunction(
    () => {
      const root = document.querySelector("#root");
      return root instanceof HTMLElement && root.childElementCount > 0;
    },
    undefined,
    { timeout: 60_000 },
  );
  const bridgeKeys = await page.evaluate(() =>
    typeof window.thothDesktop === "object" && window.thothDesktop !== null
      ? Object.keys(window.thothDesktop)
      : [],
  );
  const missingBridgeKeys = REQUIRED_DESKTOP_BRIDGE_KEYS.filter((key) => !bridgeKeys.includes(key));
  assert(
    missingBridgeKeys.length === 0,
    `Packaged renderer is missing desktop preload bridge keys: ${missingBridgeKeys.join(", ")}`,
  );
  return { browser, page, bridgeKeys };
}

async function waitForRendererStartedDaemon({ page, listen, thothHome }) {
  return await waitFor(
    async () => {
      const status = await page.evaluate(() => window.thothDesktop.invoke("desktop_daemon_status"));
      return status?.status === "running" &&
        status.desktopManaged === true &&
        status.listen === listen &&
        path.resolve(status.home) === path.resolve(thothHome)
        ? status
        : null;
    },
    60_000,
    "renderer-started packaged desktop daemon",
  );
}

async function configureRealCodexFixture(client, fixturePrompt) {
  if (!realCodex) return;
  const configured = await client.patchDaemonConfig({
    appendSystemPrompt: [
      "You are participating in an automated Thoth transport verification.",
      "Follow the matching literal fixture actions below only when their required runtime tool is available.",
      "Do not inspect or alter the workspace, and do not substitute your own tool arguments.",
      "In an Executor or fresh Review session, the named semantic tool is already present in the current tool catalog. Call it directly; do not search for it and do not report a tool-availability blocker.",
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
  assert(marker.version === 7, "Packaged Release storage did not activate layout v7");
  assert(marker.schemaVersion === 7, "Packaged Release storage did not activate schema v7");
  assert(
    marker.migrationState === "complete",
    "Packaged Release storage migration is not complete",
  );
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
  const catalogSchemaVersion = catalog.prepare("PRAGMA user_version").get().user_version;
  const catalogMigration = catalog
    .prepare("SELECT version, checksum FROM catalog_schema_migrations WHERE version = 7")
    .get();
  catalog.close();
  assert(catalogSchemaVersion === 7, "Packaged Release catalog did not activate SQLite schema v7");
  assert(
    catalogMigration?.checksum === "decision-session-tree-v7-catalog",
    "Packaged Release catalog is missing the Decision Session tree migration receipt",
  );
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
  const authoritySchemaVersion = authority.prepare("PRAGMA user_version").get().user_version;
  const authorityMigration = authority
    .prepare("SELECT version, checksum FROM authority_schema_migrations WHERE version = 10")
    .get();
  const decisionTreeTables = authority
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN (
         'decision_sessions',
         'decision_session_turns',
         'decision_tree_nodes',
         'decision_tree_cross_links',
         'decision_tree_activity'
       )
       ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
  const legacyDecisionMapTables = authority
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN ('clarify_sessions', 'clarify_decision_nodes')
       ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
  authority.close();
  assert(
    authoritySchemaVersion === 7,
    "Packaged Release Workspace authority did not activate SQLite schema v7",
  );
  assert(
    authorityMigration?.checksum === "decision-session-tree-v7",
    "Packaged Release authority is missing the Decision Session tree migration receipt",
  );
  assert(
    JSON.stringify(decisionTreeTables) ===
      JSON.stringify([
        "decision_session_turns",
        "decision_sessions",
        "decision_tree_activity",
        "decision_tree_cross_links",
        "decision_tree_nodes",
      ]),
    "Packaged Release authority is missing Decision Session tree tables",
  );
  assert(
    legacyDecisionMapTables.length === 0,
    "Packaged Release retained the replaced Clarify Decision Tree tables",
  );
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
    catalogSchemaVersion,
    authoritySchemaVersion,
    catalogMigration,
    authorityMigration,
    decisionTreeTables,
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
          WHERE e.task_id = ? AND e.phase_kind IN ('execute', 'review')
          ORDER BY e.started_at ASC`,
      )
      .all(taskId);
    assert(
      attachments.length === 4,
      `Expected four packaged Execute/Review attempts, received ${attachments.length}`,
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

function isProcessTreeRunning(child) {
  if (!child.pid) return false;
  if (process.platform === "win32") {
    return child.exitCode === null && child.signalCode === null;
  }
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcessTree(child, signal) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function waitForProcessTreeExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessTreeRunning(child)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isProcessTreeRunning(child);
}

function releaseChildHandles(child) {
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
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
  const userData = path.join(runRoot, "user-data");
  const fakeBin = path.join(runRoot, "bin");
  const capturePath = path.join(runRoot, "scripted-codex.jsonl");
  const statePath = path.join(runRoot, "scripted-codex-state.json");
  const desktopStdoutPath = path.join(runRoot, "desktop.stdout.log");
  const desktopStderrPath = path.join(runRoot, "desktop.stderr.log");
  const desktopRendererPath = path.join(runRoot, "desktop-renderer.json");
  const desktopRendererLogPath = path.join(runRoot, "desktop-renderer.log");
  const desktopRendererScreenshotPath = path.join(runRoot, "desktop-renderer.png");
  const decisionTreeActivityScreenshotPath = path.join(runRoot, "decision-tree-activity.png");
  const decisionTreeCardScreenshotPath = path.join(runRoot, "decision-tree-card.png");
  const decisionTreeFrozenScreenshotPath = path.join(runRoot, "decision-tree-frozen.png");
  const decisionTreeConstrainedScreenshotPath = path.join(runRoot, "decision-tree-constrained.png");
  const desktopProductSurfacesPath = path.join(runRoot, "desktop-product-surfaces.json");
  const desktopProductSurfacesScreenshotPath = path.join(runRoot, "desktop-product-surfaces.png");
  const quickWorkspace = path.join(runRoot, "quick-workspace");
  for (const directory of [
    home,
    thothHome,
    xdgConfigHome,
    xdgCacheHome,
    userData,
    fakeBin,
    quickWorkspace,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  seedProductSurfaceWorkspace(quickWorkspace);
  const browserFixture = realCodex ? null : await startBrowserFixture();
  let releaseMigrationProbe = null;
  if (!realCodex) {
    releaseMigrationProbe = seedReleaseStorage(thothHome);
    writeFileSync(
      statePath,
      JSON.stringify({ checkpoint: 0, review: 0, holdClarifyAfterMap: true }),
    );
    const fakeCodexPath = path.join(fakeBin, "codex");
    copyFileSync(path.join(root, "scripts/fixtures/scripted-codex-app-server.mjs"), fakeCodexPath);
    chmodSync(fakeCodexPath, 0o755);
  }

  const port = await reservePort();
  let cdpPort = await reservePort();
  while (cdpPort === port) cdpPort = await reservePort();
  const listen = `127.0.0.1:${port}`;
  const command = process.env.DISPLAY ? appImagePath : "xvfb-run";
  const commandArgs = process.env.DISPLAY ? ["--no-sandbox"] : ["-a", appImagePath, "--no-sandbox"];
  const child = spawn(command, commandArgs, {
    cwd: runRoot,
    detached: process.platform !== "win32",
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
      THOTH_ELECTRON_USER_DATA_DIR: userData,
      THOTH_ELECTRON_FLAGS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${cdpPort}`,
      THOTH_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      ...(realCodex
        ? { CODEX_HOME: process.env.CODEX_HOME }
        : {
            THOTH_FAKE_CODEX_CAPTURE: capturePath,
            THOTH_FAKE_CODEX_STATE: statePath,
            THOTH_FAKE_BROWSER_URL: browserFixture.baseUrl,
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
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  let client = null;
  let browser = null;
  let page = null;
  let rendererReceipt = null;
  const rendererLog = [];
  let productSurfacesReceipt = null;
  let decisionTreeSurface = null;
  let report = null;
  let failure = null;
  let journey = null;
  try {
    const renderer = await connectToPackagedRenderer({ child, cdpPort });
    browser = renderer.browser;
    page = renderer.page;
    page.on("console", (message) => {
      rendererLog.push(
        JSON.stringify({
          at: new Date().toISOString(),
          kind: "console",
          type: message.type(),
          text: message.text(),
        }),
      );
    });
    page.on("pageerror", (error) => {
      rendererLog.push(
        JSON.stringify({ at: new Date().toISOString(), kind: "pageerror", message: error.message }),
      );
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        rendererLog.push(
          JSON.stringify({
            at: new Date().toISOString(),
            kind: "main-frame-navigated",
            url: frame.url(),
          }),
        );
      }
    });
    const desktopDaemon = await waitForRendererStartedDaemon({ page, listen, thothHome });
    rendererReceipt = {
      url: page.url(),
      title: await page.title(),
      bridgeKeys: renderer.bridgeKeys,
      daemon: desktopDaemon,
    };
    writeFileSync(desktopRendererPath, `${JSON.stringify(rendererReceipt, null, 2)}\n`);
    await page.screenshot({ path: desktopRendererScreenshotPath, fullPage: true });
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
    productSurfacesReceipt = await inspectFilesAndChangesSurface(page, {
      serverId: desktopDaemon.serverId,
      workspaceId: quickWorkspaceId,
    });
    productSurfacesReceipt.workspaceScripts = await runWorkspaceScriptsSurfaceAcceptance({
      client,
      page,
      serverId: desktopDaemon.serverId,
      workspaceId: quickWorkspaceId,
    });
    productSurfacesReceipt.largeFile = await verifyLargeFileTransfer(
      client,
      quickWorkspace,
      seedLargeFile(quickWorkspace),
    );

    const quickPrompt = realCodex
      ? readFileSync(quickPromptPath, "utf8")
      : "PACKAGED_QUICK_CLARIFY";
    const loopPrompt = realCodex ? readFileSync(loopPromptPath, "utf8") : "PACKAGED_LOOP_RETRY";
    await configureRealCodexFixture(client, `${quickPrompt}\n\n${loopPrompt}`);
    journey = new ThothApiJourney({
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
      afterQuickTreeExpansion: realCodex
        ? undefined
        : async ({ agent }) => {
            const activity = await inspectDecisionTreeActivitySurface({
              page,
              serverId: desktopDaemon.serverId,
              workspaceId: quickWorkspaceId,
              agentId: agent.id,
              screenshotPath: decisionTreeActivityScreenshotPath,
            });
            const fixtureState = JSON.parse(readFileSync(statePath, "utf8"));
            writeFileSync(
              statePath,
              JSON.stringify({ ...fixtureState, holdClarifyAfterMap: false }),
            );
            decisionTreeSurface = { activity, card: null };
          },
      afterQuickClarifyCard: realCodex
        ? undefined
        : async ({ agent }) => {
            const card = await inspectDecisionTreeCardSurface({
              page,
              serverId: desktopDaemon.serverId,
              workspaceId: quickWorkspaceId,
              agentId: agent.id,
              screenshotPath: decisionTreeCardScreenshotPath,
            });
            decisionTreeSurface = { activity: decisionTreeSurface?.activity ?? null, card };
          },
    });
    writeFileSync(
      path.join(runRoot, "background-task-detail.json"),
      JSON.stringify(core.task, null, 2),
    );

    if (!realCodex) {
      const frozen = await inspectFrozenDecisionTreeGeometry({
        page,
        serverId: desktopDaemon.serverId,
        workspaceId: quickWorkspaceId,
        agentId: core.agent.id,
        screenshotPath: decisionTreeFrozenScreenshotPath,
        narrowScreenshotPath: decisionTreeConstrainedScreenshotPath,
      });
      decisionTreeSurface = {
        activity: decisionTreeSurface?.activity ?? null,
        card: decisionTreeSurface?.card ?? null,
        frozen,
      };
    }

    productSurfacesReceipt.providerPlan = await runNativePlanQuestionSurfaceAcceptance({
      client,
      page,
      serverId: desktopDaemon.serverId,
      workspaceId: quickWorkspaceId,
      agentId: core.agent.id,
      expectedSessionId: core.sessionId,
    });

    if (!realCodex) {
      await client.sendAgentMessage(core.agent.id, "PACKAGED_BROWSER_AUTOMATION", {
        thoth: { enabled: false },
      });
      await waitFor(
        async () => {
          const snapshot = await client.fetchAgent({ agentId: core.agent.id });
          return snapshot?.agent.status !== "idle" ? snapshot : null;
        },
        30_000,
        "packaged Browser turn to start",
      );
      await journey.waitForAgentIdle(core.agent.id);
      const browserCapture = parseCapture(capturePath);
      const browserTurnError = browserCapture.find(
        (entry) => entry.kind === "turn_error" && entry.threadId === core.sessionId,
      );
      assert(
        !browserTurnError,
        `Packaged Browser turn failed before surface navigation: ${JSON.stringify(browserTurnError)}`,
      );
      const completedBrowserFlow = browserCapture.find(
        (entry) => entry.kind === "browser_flow" && entry.threadId === core.sessionId,
      );
      assert(
        completedBrowserFlow?.startSnapshot === true &&
          completedBrowserFlow.completeSnapshot === true &&
          completedBrowserFlow.wrongBrowserRejected === true &&
          completedBrowserFlow.closed === true,
        "Packaged Browser flow did not settle before the Schedule surface navigation",
      );
      productSurfacesReceipt.browser = {
        commands: [
          "list_tabs",
          "new_tab",
          "snapshot",
          "navigate",
          "snapshot",
          "close_tab",
          "list_tabs",
        ],
        unknownBrowserIdRejected: true,
      };
      productSurfacesReceipt.schedule = await runScheduleSurfaceAcceptance({
        client,
        page,
        serverId: desktopDaemon.serverId,
        workspaceId: quickWorkspaceId,
      });
      writeFileSync(
        desktopProductSurfacesPath,
        `${JSON.stringify(productSurfacesReceipt, null, 2)}\n`,
      );
      await page.screenshot({ path: desktopProductSurfacesScreenshotPath, fullPage: true });
    }

    let stopTask = null;
    if (!realCodex) {
      const fixtureState = JSON.parse(readFileSync(statePath, "utf8"));
      writeFileSync(statePath, JSON.stringify({ ...fixtureState, holdExecute: true }));
      await client.sendAgentMessage(core.agent.id, "PACKAGED_LOOP_STOP", {
        thoth: {
          enabled: true,
          executionMode: "loop",
          clarifyStrength: "light",
          loopStrength: "light",
        },
      });
      await journey.approveIntentContract(core.agent.id, "loop");
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
        "held packaged Execute attempt",
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
            entry.dynamicToolNames.includes("thoth_clarify_update_map"),
        ),
        "Packaged foreground thread did not receive Clarify dynamic tools",
      );
      assert(
        toolCalls.filter((entry) => entry.tool === "thoth_loop_checkpoint").length === 4,
        "Expected four packaged semantic checkpoints",
      );
      assert(
        toolCalls.filter((entry) => entry.tool === "thoth_loop_review_decision").length === 4,
        "Expected four packaged fresh Review decisions",
      );
      const quickThreadStart = threadStarts.find((entry) => entry.cwd === quickWorkspace);
      assert(quickThreadStart, "Packaged Quick foreground thread was not captured");
      visibleTurnCount = capture.filter(
        (entry) => entry.kind === "turn_start" && entry.threadId === quickThreadStart.threadId,
      ).length;
      assert(
        visibleTurnCount === 13,
        `Expected thirteen hot-switch, Provider Plan, @Task, Browser and Stop-probe turns, received ${visibleTurnCount}`,
      );
      const nativeQuestion = capture.find(
        (entry) =>
          entry.kind === "provider_question_answer" && entry.threadId === quickThreadStart.threadId,
      );
      const nativePlan = capture.find(
        (entry) =>
          entry.kind === "native_plan_completed" && entry.threadId === quickThreadStart.threadId,
      );
      const nativeImplementation = capture.find(
        (entry) =>
          entry.kind === "native_plan_implemented" && entry.threadId === quickThreadStart.threadId,
      );
      assert(
        nativeQuestion?.questionId === "target" &&
          JSON.stringify(nativeQuestion.values) === JSON.stringify(["Local"]),
        "Packaged Provider question did not preserve its native id and string-array answer",
      );
      assert(
        nativePlan && nativeImplementation,
        "Packaged completed Plan did not continue into same-thread implementation",
      );
      const browserFlow = capture.find(
        (entry) => entry.kind === "browser_flow" && entry.threadId === quickThreadStart.threadId,
      );
      assert(
        browserFlow?.startSnapshot === true &&
          browserFlow.completeSnapshot === true &&
          browserFlow.wrongBrowserRejected === true &&
          browserFlow.closed === true,
        "Packaged Browser flow did not complete through Provider tools and Desktop automation",
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
    if (!realCodex) {
      assert(decisionTreeSurface, "Packaged Decision Tree visual acceptance did not run");
    }

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
      usedNonCompleteReviews: core.task.budget.usedNonCompleteReviews,
      stoppedTaskId: stopTask?.id ?? null,
      visibleSessionCount: visibleSessionIds.length,
      durableBytes,
      migration,
      ...(realCodex
        ? {}
        : {
            checkpointCalls: toolCalls.filter((entry) => entry.tool === "thoth_loop_checkpoint")
              .length,
            reviewDecisionCalls: toolCalls.filter(
              (entry) => entry.tool === "thoth_loop_review_decision",
            ).length,
            dynamicToolThreadCount: threadStarts.filter(
              (entry) => Array.isArray(entry.dynamicToolNames) && entry.dynamicToolNames.length > 0,
            ).length,
          }),
      runtimeBundles: runtimeAuthority.bundles,
      loopAttachmentCount: runtimeAuthority.loopAttachmentCount,
      desktopRenderer: rendererReceipt,
      decisionTreeSurface,
      productSurfaces: productSurfacesReceipt,
    };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await client?.close().catch(() => undefined);
    await page
      ?.evaluate(() => window.thothDesktop.invoke("stop_desktop_daemon", { reason: "manual_ipc" }))
      .catch(() => undefined);
    await page?.evaluate(() => window.close()).catch(() => undefined);
    await browser?.close().catch(() => undefined);
    if (isProcessTreeRunning(child)) {
      signalProcessTree(child, "SIGTERM");
      if (!(await waitForProcessTreeExit(child, 10_000))) {
        signalProcessTree(child, "SIGKILL");
        if (!(await waitForProcessTreeExit(child, 10_000))) {
          failure ??= new Error("Packaged desktop smoke process tree did not exit");
        }
      }
    }
    releaseChildHandles(child);
    writeFileSync(desktopStdoutPath, stdout);
    writeFileSync(desktopStderrPath, stderr);
    writeFileSync(
      desktopRendererLogPath,
      rendererLog.length > 0 ? `${rendererLog.join("\n")}\n` : "",
    );
    if (journey?.lastTaskDetail) {
      writeFileSync(
        path.join(runRoot, "background-task-detail.json"),
        `${JSON.stringify(journey.lastTaskDetail, null, 2)}\n`,
      );
    }
    rmSync(outputDir, { recursive: true, force: true });
    mkdirSync(outputDir, { recursive: true });
    for (const filePath of [
      capturePath,
      statePath,
      desktopStdoutPath,
      desktopStderrPath,
      desktopRendererPath,
      desktopRendererLogPath,
      desktopRendererScreenshotPath,
      decisionTreeActivityScreenshotPath,
      decisionTreeCardScreenshotPath,
      decisionTreeFrozenScreenshotPath,
      decisionTreeConstrainedScreenshotPath,
      desktopProductSurfacesPath,
      desktopProductSurfacesScreenshotPath,
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
    await browserFixture?.close().catch(() => undefined);
    if (report) writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    rmSync(runRoot, { recursive: true, force: true });
  }

  if (failure) throw failure;
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

await main();
