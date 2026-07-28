import type { DaemonClient as InternalDaemonClient } from "@thoth/client/internal/daemon-client";
import type { ScheduleRun } from "@thoth/protocol/schedule/types";
import { expect, test, type Page } from "./fixtures";
import { connectDaemonClient } from "./helpers/daemon-client-loader";
import { getServerId } from "./helpers/server-id";
import { createTempGitRepo } from "./helpers/workspace";
import { waitForWorkspaceTabsVisible } from "./helpers/workspace-tabs";
import { buildHostWorkspaceRoute, buildHostWorkspaceTasksRoute } from "../src/utils/host-routes";

const SCRIPT_NAME = "scheduled-web-service";
const SCHEDULE_NAME = "Web Schedule";
const UPDATED_SCHEDULE_NAME = "Web Schedule Updated";

test("manages Workspace scripts and a Schedule through the real Tasks surface", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const repo = await createTempGitRepo("tasks-schedules-scripts-", {
    thothConfig: {
      scripts: {
        [SCRIPT_NAME]: {
          type: "service",
          command:
            "node -e \"const http = require('http'); const server = http.createServer((_request, response) => response.end('THOTH_SCRIPT_OK')); server.listen(process.env.PORT || 3000)\"",
        },
      },
    },
  });
  const client = await connectDaemonClient<InternalDaemonClient>({
    clientIdPrefix: "tasks-schedules-scripts",
  });
  let projectId: string | null = null;

  try {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
    });
    expect(created.error).toBeNull();
    expect(created.workspace).not.toBeNull();
    const workspace = created.workspace!;
    projectId = workspace.projectId;

    await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
    await waitForWorkspaceTabsVisible(page);

    await page.getByTestId("workspace-scripts-button").click();
    await expect(page.getByTestId("workspace-scripts-menu")).toBeVisible();
    await expect(page.getByTestId(`workspace-scripts-item-${SCRIPT_NAME}`)).toContainText(
      SCRIPT_NAME,
    );
    await page.getByTestId(`workspace-scripts-start-${SCRIPT_NAME}`).click();
    await expect(page.getByTestId(`workspace-scripts-item-${SCRIPT_NAME}`)).toContainText(
      "localhost:",
      { timeout: 30_000 },
    );
    await expect
      .poll(async () => {
        const listed = await client.listWorkspaceScripts({ workspaceId: workspace.id });
        return listed.scripts.find((script) => script.scriptName === SCRIPT_NAME)?.lifecycle;
      })
      .toBe("running");
    await page.getByTestId(`workspace-scripts-stop-${SCRIPT_NAME}`).click();
    await expect(page.getByTestId(`workspace-scripts-start-${SCRIPT_NAME}`)).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(async () => {
        const listed = await client.listWorkspaceScripts({ workspaceId: workspace.id });
        return listed.scripts.find((script) => script.scriptName === SCRIPT_NAME)?.lifecycle;
      })
      .toBe("stopped");

    await page.goto(buildHostWorkspaceTasksRoute(getServerId(), workspace.id));
    await expect(page.getByTestId("tasks-surface")).toBeVisible();
    await page.getByTestId("schedules-tab").click();
    await expect(page.getByTestId("schedules-panel")).toBeVisible();
    await page.getByTestId("schedule-create-open").click();
    await expect(page.getByTestId("schedule-create-form")).toBeVisible();
    await page.getByTestId("schedule-name").fill(SCHEDULE_NAME);
    await page.getByTestId("schedule-prompt").fill("WEB_SCHEDULE_RUN");
    await page.getByTestId("schedule-provider").fill("mock");
    await page.getByTestId("schedule-model").fill("ten-second-stream");
    await page.getByTestId("schedule-max-runs").fill("2");
    await page.getByTestId("schedule-create-submit").click();
    await expect(page.getByTestId("schedule-detail")).toContainText(SCHEDULE_NAME, {
      timeout: 30_000,
    });

    await expect
      .poll(async () => {
        const listed = await client.scheduleList({ workspaceId: workspace.id });
        return listed.schedules.find((schedule) => schedule.name === SCHEDULE_NAME)?.id ?? null;
      })
      .not.toBeNull();
    const listedSchedules = await client.scheduleList({ workspaceId: workspace.id });
    const scheduleId = listedSchedules.schedules.find(
      (schedule) => schedule.name === SCHEDULE_NAME,
    )?.id;
    if (!scheduleId) throw new Error("Created Schedule disappeared before UI verification");
    const initialRun = await waitForSuccessfulRun(client, workspace.id, scheduleId);

    await page.getByTestId("schedule-edit-open").click();
    await page.getByTestId("schedule-name").fill(UPDATED_SCHEDULE_NAME);
    await page.getByTestId("schedule-edit-submit").click();
    await expect(page.getByTestId("schedule-detail")).toContainText(UPDATED_SCHEDULE_NAME);

    await page.getByTestId("schedule-pause").click();
    await expect
      .poll(
        async () =>
          (await client.scheduleInspect({ workspaceId: workspace.id, id: scheduleId })).schedule
            ?.status,
      )
      .toBe("paused");
    await expect(page.getByTestId("schedule-detail")).toContainText("paused");
    await page.getByTestId("schedule-resume").click();
    await expect
      .poll(
        async () =>
          (await client.scheduleInspect({ workspaceId: workspace.id, id: scheduleId })).schedule
            ?.status,
      )
      .toBe("active");

    await page.getByTestId("schedule-run-now").click();
    const run = await waitForSuccessfulRun(client, workspace.id, scheduleId, initialRun.id);
    expect(run.workspaceId).toBe(workspace.id);
    expect(run.taskId).not.toBeNull();
    expect(run.executionId).not.toBeNull();
    await expect(page.getByTestId(`schedule-run-${run.id}`)).toContainText("succeeded", {
      timeout: 30_000,
    });

    await page.getByTestId(`schedule-open-task-${run.id}`).click();
    await expect(visibleTestId(page, `background-task-row-${run.taskId}`)).toContainText(
      UPDATED_SCHEDULE_NAME,
    );
    await expect(visibleTestId(page, "background-task-open-schedule")).toBeVisible();
    await visibleTestId(page, "background-task-open-schedule").click();
    await expect(visibleTestId(page, "schedule-detail")).toContainText(UPDATED_SCHEDULE_NAME);

    await visibleTestId(page, "schedule-delete").click();
    await visibleTestId(page, "schedule-delete").click();
    await expect
      .poll(async () => {
        const listed = await client.scheduleList({ workspaceId: workspace.id });
        return listed.schedules.some((schedule) => schedule.id === scheduleId);
      })
      .toBe(false);
    await expect(page.getByText("No schedules in this Workspace.")).toBeVisible();
  } finally {
    if (projectId) {
      await client.removeProject(projectId).catch(() => undefined);
    }
    await client.close().catch(() => undefined);
    await repo.cleanup();
  }
});

function visibleTestId(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

async function waitForSuccessfulRun(
  client: InternalDaemonClient,
  workspaceId: string,
  scheduleId: string,
  excludedRunId: string | null = null,
) {
  let successfulRun: ScheduleRun | null = null;
  await expect
    .poll(
      async () => {
        const inspected = await client.scheduleInspect({ workspaceId, id: scheduleId });
        successfulRun =
          inspected.schedule?.runs.findLast(
            (run) => run.status === "succeeded" && run.id !== excludedRunId,
          ) ?? null;
        return successfulRun?.id ?? null;
      },
      { timeout: 60_000 },
    )
    .not.toBeNull();
  return successfulRun!;
}
