#!/usr/bin/env npx tsx

import assert from "node:assert";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectToDaemon } from "../src/utils/client.ts";
import { createE2ETestContext } from "./helpers/test-daemon.ts";

console.log("=== Task And Schedule Command Tests ===\n");

const fixtureRoot = await mkdtemp(join(tmpdir(), "thoth-cli-schedule-fixture-"));
const fixtureBin = join(fixtureRoot, "bin");
const fixtureCapture = join(fixtureRoot, "scripted-codex.jsonl");
const fixtureState = join(fixtureRoot, "scripted-codex-state.json");
const fixtureCodex = join(fixtureBin, "codex");
await mkdir(fixtureBin, { recursive: true });
await copyFile(
  join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "scripts",
    "fixtures",
    "scripted-codex-app-server.mjs",
  ),
  fixtureCodex,
);
await chmod(fixtureCodex, 0o755);
await writeFile(fixtureState, JSON.stringify({ checkpoint: 0, review: 0 }));
await writeFile(fixtureCapture, "");

const ctx = await createE2ETestContext({
  timeout: 30000,
  env: {
    THOTH_NODE_ENV: "development",
    THOTH_FAKE_CODEX_CAPTURE: fixtureCapture,
    THOTH_FAKE_CODEX_STATE: fixtureState,
    PATH: `${fixtureBin}:${process.env.PATH ?? ""}`,
  },
});

async function waitFor<T>(read: () => Promise<T | null>, label: string): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function createConfirmedScheduleContract(
  workspaceId: string,
): Promise<{ intentContractId: string; sourceAgentId: string }> {
  const previousHome = process.env.THOTH_HOME;
  process.env.THOTH_HOME = ctx.thothHome;
  const client = await connectToDaemon({ host: `127.0.0.1:${ctx.port}` });
  try {
    const agent = await client.createAgent({
      provider: "codex",
      cwd: ctx.workDir,
      workspaceId,
      initialPrompt: "PACKAGED_RAW_FIRST",
      thoth: { enabled: false },
    });
    await waitFor(async () => {
      const snapshot = await client.fetchAgent({ agentId: agent.id });
      return snapshot?.agent.status === "idle" ? true : null;
    }, "schedule source Agent to become idle");

    await client.sendAgentMessage(agent.id, "Create one reusable Schedule Intent Contract.", {
      thoth: { enabled: true, executionMode: "quick", clarifyStrength: "light" },
    });

    let contractId: string | null = null;
    for (let cardIndex = 0; cardIndex < 10 && !contractId; cardIndex += 1) {
      const current = await waitFor(async () => {
        const state = await client.getAgentThothState(agent.id);
        if (state.error) throw new Error(state.error);
        return state.state.pendingCard?.card.submitted === false ? state.state : null;
      }, "Schedule Clarify Card");
      const pending = current.pendingCard!;
      if (pending.kind === "clarify_card") {
        const answered = await client.answerAgentThothCard({
          agentId: agent.id,
          cardId: pending.card.id,
          expectedRevision: current.revision,
          commandId: `cli-schedule-clarify-${cardIndex}`,
          answer: {
            intent: "submit_choices",
            questionCardId: pending.card.id,
            answers: pending.card.card.questions.map((question) => ({
              nodeId: question.nodeId,
              choiceIds: [question.choices[0]!.id],
              choiceNotes: {},
            })),
            delegatedNodeIds: [],
            rawAnswer: "Use every first recommended schedule choice.",
          },
        });
        assert.strictEqual(answered.accepted, true, answered.error ?? "Clarify answer rejected");
        continue;
      }

      contractId = pending.card.contract.id;
      const accepted = await client.answerAgentThothCard({
        agentId: agent.id,
        cardId: pending.card.id,
        expectedRevision: current.revision,
        commandId: "cli-schedule-contract-accept",
        answer: {
          intent: "accept_quick",
          cardId: pending.card.id,
          rawAnswer: "Confirm the Schedule Intent Contract.",
        },
      });
      assert.strictEqual(accepted.accepted, true, accepted.error ?? "Intent Contract rejected");
    }
    assert(contractId, "Clarify should produce one confirmed Intent Contract");

    await waitFor(async () => {
      const state = await client.getAgentThothState(agent.id);
      if (state.error) throw new Error(state.error);
      return state.state.lifecycle === "done" ? true : null;
    }, "Quick contract Task to settle");
    await waitFor(async () => {
      const tasks = await client.listTasks(workspaceId);
      if (tasks.error) throw new Error(tasks.error);
      return tasks.tasks.some(
        (task) => task.sourceAgentId === agent.id && task.intentContract.id === contractId,
      )
        ? true
        : null;
    }, "confirmed contract Task authority");
    return { intentContractId: contractId, sourceAgentId: agent.id };
  } finally {
    await client.close();
    if (previousHome === undefined) delete process.env.THOTH_HOME;
    else process.env.THOTH_HOME = previousHome;
  }
}

try {
  const workspaceId = await ctx.createWorkspace();
  const { intentContractId, sourceAgentId } = await createConfirmedScheduleContract(workspaceId);
  const scopedSchedule = (args: string[]) => [...args, "--workspace", workspaceId];
  const scheduledAuthority: Array<{ scheduleId: string; taskId: string }> = [];
  const waitForScheduleAuthority = async (
    scheduleId: string,
  ): Promise<{ scheduleId: string; taskId: string }> => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const logs = await ctx.thoth(scopedSchedule(["schedule", "logs", scheduleId, "--json"]));
      assert.strictEqual(logs.exitCode, 0, logs.stderr);
      const runs = JSON.parse(logs.stdout) as Array<{ taskId?: string | null }>;
      const authorityRun = runs.find((run) => typeof run.taskId === "string");
      if (authorityRun?.taskId) {
        return { scheduleId, taskId: authorityRun.taskId };
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
        "--intent-contract",
        intentContractId,
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
    assert.strictEqual(createdJson.intentContractId, intentContractId);
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
        "--intent-contract",
        intentContractId,
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
        "--intent-contract",
        intentContractId,
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
      sourceAgentWorkspaceId: string;
      sourceAgentId: string;
    }>;
    assert.strictEqual(scheduledAuthority.length, 2);
    for (const authority of scheduledAuthority) {
      const task = listedTasks.find((candidate) => candidate.id === authority.taskId);
      assert(task, `Task ${authority.taskId} should remain after deleting its Schedule`);
      assert.strictEqual(task.workspaceId, workspaceId);
      assert.strictEqual(task.sourceAgentWorkspaceId, workspaceId);
      assert.strictEqual(task.sourceAgentId, sourceAgentId);

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
        task: {
          id: string;
          workspaceId: string;
          origin: {
            type: string;
            ownerWorkspaceId: string;
            scheduleId: string;
            runId: string;
          } | null;
        };
        executions: Array<{ id: string; taskId: string }>;
      };
      assert.strictEqual(detailJson.task.id, authority.taskId);
      assert.strictEqual(detailJson.task.workspaceId, workspaceId);
      assert.strictEqual(detailJson.task.origin?.type, "schedule");
      assert.strictEqual(detailJson.task.origin?.ownerWorkspaceId, workspaceId);
      assert.strictEqual(detailJson.task.origin?.scheduleId, authority.scheduleId);
      assert(detailJson.task.origin?.runId, "Schedule Task should preserve its run lineage");
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
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log("=== Task And Schedule Command Tests Passed ===");
