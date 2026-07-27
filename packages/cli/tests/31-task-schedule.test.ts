#!/usr/bin/env npx tsx

import assert from "node:assert";
import { rm } from "node:fs/promises";
import { createE2ETestContext } from "./helpers/test-daemon.ts";

console.log("=== Task And Schedule Command Tests ===\n");

const ctx = await createE2ETestContext({
  timeout: 30000,
  env: { THOTH_NODE_ENV: "development" },
});

try {
  const workspaceId = await ctx.createWorkspace();
  const scopedSchedule = (args: string[]) => [...args, "--workspace", workspaceId];
  const scheduledAuthority: Array<{ taskId: string; executionId: string }> = [];
  const waitForScheduleAuthority = async (
    scheduleId: string,
  ): Promise<{ taskId: string; executionId: string }> => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const logs = await ctx.thoth(scopedSchedule(["schedule", "logs", scheduleId, "--json"]));
      assert.strictEqual(logs.exitCode, 0, logs.stderr);
      const runs = JSON.parse(logs.stdout) as Array<{
        taskId?: string | null;
        executionId?: string | null;
      }>;
      const authorityRun = runs.find(
        (run) => typeof run.taskId === "string" && typeof run.executionId === "string",
      );
      if (authorityRun?.taskId && authorityRun.executionId) {
        return {
          taskId: authorityRun.taskId,
          executionId: authorityRun.executionId,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Schedule ${scheduleId} did not create Task/Execution authority`);
  };
  {
    console.log("Test 1: schedule create/ls/inspect/pause/resume/delete work");
    const created = await ctx.thoth(
      scopedSchedule([
        "schedule",
        "create",
        "Review new PRs",
        "--every",
        "5m",
        "--name",
        "review-prs",
        "--provider",
        "claude",
        "--json",
      ]),
      { timeout: 30000 },
    );
    assert.strictEqual(created.exitCode, 0, created.stderr);
    const createdJson = JSON.parse(created.stdout);
    assert.strictEqual(createdJson.name, "review-prs");
    assert.strictEqual(createdJson.cadence, "every:5m");
    assert(
      typeof createdJson.target === "string" &&
        (createdJson.target.startsWith("agent:") || createdJson.target === "new-agent:claude"),
      created.stdout,
    );

    const listed = await ctx.thoth(scopedSchedule(["schedule", "ls", "--json"]));
    assert.strictEqual(listed.exitCode, 0, listed.stderr);
    const listedJson = JSON.parse(listed.stdout);
    assert(Array.isArray(listedJson), listed.stdout);
    assert(
      listedJson.some((item: { id: string }) => item.id === createdJson.id),
      listed.stdout,
    );

    const inspected = await ctx.thoth(
      scopedSchedule(["schedule", "inspect", createdJson.id, "--json"]),
    );
    assert.strictEqual(inspected.exitCode, 0, inspected.stderr);
    const inspectedJson = JSON.parse(inspected.stdout);
    assert.strictEqual(inspectedJson.status, "active");
    assert.strictEqual(inspectedJson.prompt, "Review new PRs");
    scheduledAuthority.push(await waitForScheduleAuthority(createdJson.id));

    const paused = await ctx.thoth(scopedSchedule(["schedule", "pause", createdJson.id, "--json"]));
    assert.strictEqual(paused.exitCode, 0, paused.stderr);
    assert.strictEqual(JSON.parse(paused.stdout).status, "paused");

    const resumed = await ctx.thoth(
      scopedSchedule(["schedule", "resume", createdJson.id, "--json"]),
    );
    assert.strictEqual(resumed.exitCode, 0, resumed.stderr);
    assert.strictEqual(JSON.parse(resumed.stdout).status, "active");

    const deleted = await ctx.thoth(
      scopedSchedule(["schedule", "delete", createdJson.id, "--json"]),
    );
    assert.strictEqual(deleted.exitCode, 0, deleted.stderr);
    assert.strictEqual(JSON.parse(deleted.stdout).id, createdJson.id);
    console.log("schedule commands work\n");
  }

  {
    console.log("Test 1b: schedule create accepts provider/model syntax for new-agent runs");
    const created = await ctx.thoth(
      scopedSchedule([
        "schedule",
        "create",
        "Refactor the API layer",
        "--every",
        "10m",
        "--provider",
        "codex/gpt-5.4",
        "--json",
      ]),
      { timeout: 30000 },
    );
    assert.strictEqual(created.exitCode, 0, created.stderr);
    const createdJson = JSON.parse(created.stdout);
    assert.strictEqual(createdJson.target, "new-agent:codex/gpt-5.4");

    const inspected = await ctx.thoth(
      scopedSchedule(["schedule", "inspect", createdJson.id, "--json"]),
    );
    assert.strictEqual(inspected.exitCode, 0, inspected.stderr);
    const inspectedJson = JSON.parse(inspected.stdout);
    assert.strictEqual(inspectedJson.target.config.provider, "codex");
    assert.strictEqual(inspectedJson.target.config.model, "gpt-5.4");
    scheduledAuthority.push(await waitForScheduleAuthority(createdJson.id));

    const deleted = await ctx.thoth(
      scopedSchedule(["schedule", "delete", createdJson.id, "--json"]),
    );
    assert.strictEqual(deleted.exitCode, 0, deleted.stderr);
    console.log("schedule provider/model syntax works\n");
  }

  {
    console.log("Test 1c: schedule create rejects provider with self target");
    const result = await ctx.thoth(
      scopedSchedule([
        "schedule",
        "create",
        "Conflicting schedule",
        "--every",
        "5m",
        "--target",
        "self",
        "--provider",
        "codex/gpt-5.4",
      ]),
      { timeout: 30000 },
    );
    assert.notStrictEqual(result.exitCode, 0, "should fail for self target with provider");
    const output = result.stdout + result.stderr;
    assert(
      output.includes("can only be used with a new-agent target"),
      "should explain provider target mismatch",
    );
    console.log("schedule rejects provider with self target\n");
  }

  {
    console.log("Test 2: task list resolves Workspace authority");
    const listed = await ctx.thoth(["task", "list", "--workspace", workspaceId, "--json"]);
    assert.strictEqual(listed.exitCode, 0, listed.stderr);
    const listedTasks = JSON.parse(listed.stdout) as Array<{
      id: string;
      workspaceId: string;
      sourceAgentId: string;
    }>;
    assert.strictEqual(scheduledAuthority.length, 2);
    for (const authority of scheduledAuthority) {
      const task = listedTasks.find((candidate) => candidate.id === authority.taskId);
      assert(task, `Task ${authority.taskId} should remain after deleting its Schedule`);
      assert.strictEqual(task.workspaceId, workspaceId);
      assert(task.sourceAgentId.startsWith("schedule-source-"));

      const detail = await ctx.thoth([
        "task",
        "get",
        authority.taskId,
        "--workspace",
        workspaceId,
        "--json",
      ]);
      assert.strictEqual(detail.exitCode, 0, detail.stderr);
      const detailJson = JSON.parse(detail.stdout) as {
        task: { id: string; workspaceId: string };
        executions: Array<{ id: string; taskId: string }>;
      };
      assert.strictEqual(detailJson.task.id, authority.taskId);
      assert.strictEqual(detailJson.task.workspaceId, workspaceId);
      assert(
        detailJson.executions.some(
          (execution) =>
            execution.id === authority.executionId && execution.taskId === authority.taskId,
        ),
        `Execution ${authority.executionId} should belong to Task ${authority.taskId}`,
      );
    }

    const inferred = await ctx.thoth(["task", "list", "--json"]);
    assert.strictEqual(inferred.exitCode, 0, inferred.stderr);
    const inferredTasks = JSON.parse(inferred.stdout) as Array<{ id: string }>;
    assert.deepStrictEqual(
      new Set(inferredTasks.map((task) => task.id)),
      new Set(listedTasks.map((task) => task.id)),
    );
    console.log("task list resolves Workspace authority\n");
  }

  {
    console.log("Test 3: task get rejects an unknown Task in the selected Workspace");
    const missing = await ctx.thoth([
      "task",
      "get",
      "00000000-0000-4000-8000-000000000999",
      "--workspace",
      workspaceId,
      "--json",
    ]);
    assert.notStrictEqual(missing.exitCode, 0, "unknown Task should fail");
    assert(
      `${missing.stdout}\n${missing.stderr}`.includes("was not found"),
      `${missing.stdout}\n${missing.stderr}`,
    );
    console.log("unknown Task rejection works\n");
  }
} finally {
  await ctx.stop();
  await rm(ctx.thothHome, { recursive: true, force: true });
  await rm(ctx.workDir, { recursive: true, force: true });
}

console.log("=== Task And Schedule Command Tests Passed ===");
