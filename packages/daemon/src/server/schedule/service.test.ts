import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AgentStorage } from "../agent/agent-storage.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { ProviderSnapshotManager } from "../agent/provider-snapshot-manager.js";
import { WorkspaceAuthorityManager } from "../workspace-authority/workspace-authority-manager.js";
import {
  WorkspaceTaskCoordinator,
  type TaskCommandScheduler,
} from "../workspace-authority/task-coordinator.js";
import { seedConfirmedIntentContract } from "../test-utils/authority-fixtures.js";
import { ScheduleService } from "./service.js";

const WORKSPACE_ID = "workspace-schedule-test";
const TARGET_AGENT_ID = "00000000-0000-4000-8000-000000000101";

const NO_UNATTENDED_SCHEDULE_POLICY: Pick<ProviderSnapshotManager, "resolveCreateConfig"> = {
  async resolveCreateConfig(input) {
    return { modeId: undefined, featureValues: input.featureValues };
  },
};

describe("ScheduleService", () => {
  let tempDir: string;
  let agentStorage: AgentStorage;
  let authority: WorkspaceAuthorityManager;
  let taskCoordinator: WorkspaceTaskCoordinator;
  let scheduler: TaskCommandScheduler;
  let scheduleTask: ReturnType<typeof vi.fn>;
  let intentContractId: string;
  let now: Date;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "schedule-service-test-"));
    await mkdir(join(tempDir, "agents"), { recursive: true });
    agentStorage = new AgentStorage(join(tempDir, "agents"), createTestLogger());
    await agentStorage.initialize();
    authority = new WorkspaceAuthorityManager(tempDir);
    authority.catalog.upsertWorkspace({
      id: WORKSPACE_ID,
      canonicalPath: tempDir,
      displayName: "Schedule Test",
      kind: "workspace",
      parentWorkspaceId: null,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    taskCoordinator = new WorkspaceTaskCoordinator(authority, createTestLogger());
    scheduleTask = vi.fn(async () => undefined);
    scheduler = {
      scheduleTask,
      handleTaskCommand: vi.fn(async () => undefined),
      continueAfterExecutionApproval: vi.fn(async () => undefined),
      handleTaskStopSettled: vi.fn(async () => undefined),
    };
    taskCoordinator.setScheduler(scheduler);
    intentContractId = seedConfirmedIntentContract({
      store: authority.forWorkspace(WORKSPACE_ID),
      workspaceId: WORKSPACE_ID,
      agentId: "agent-schedule-contract",
      sourceMessageId: "message-schedule-contract",
    }).id;
    now = new Date("2026-01-01T00:00:00.000Z");
  });

  afterEach(async () => {
    await agentStorage.flush();
    authority.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function createService(
    options: {
      providerSnapshotManager?: Pick<ProviderSnapshotManager, "resolveCreateConfig">;
      createWorktreeWorkspace?: ConstructorParameters<
        typeof ScheduleService
      >[0]["createWorktreeWorkspace"];
    } = {},
  ): ScheduleService {
    return new ScheduleService({
      authority,
      taskCoordinator,
      logger: createTestLogger(),
      agentStorage,
      providerSnapshotManager: options.providerSnapshotManager ?? NO_UNATTENDED_SCHEDULE_POLICY,
      ...(options.createWorktreeWorkspace
        ? { createWorktreeWorkspace: options.createWorktreeWorkspace }
        : {}),
      now: () => now,
    });
  }

  async function createSchedule(
    service: ScheduleService,
    input: Partial<Parameters<ScheduleService["create"]>[1]> = {},
  ) {
    return service.create(WORKSPACE_ID, {
      intentContractId,
      prompt: "Review new pull requests",
      cadence: { type: "every", everyMs: 60_000 },
      target: { type: "new-agent", config: { provider: "claude" } },
      ...input,
    });
  }

  function seedReplacementContract(label: string): string {
    return seedConfirmedIntentContract({
      store: authority.forWorkspace(WORKSPACE_ID),
      workspaceId: WORKSPACE_ID,
      agentId: `agent-schedule-contract-${label}`,
      sourceMessageId: `message-schedule-contract-${label}`,
      title: `Confirmed schedule template ${label}`,
      objective: `Execute the revised scheduled task ${label}.`,
    }).id;
  }

  async function registerTargetAgent(): Promise<void> {
    await agentStorage.upsert({
      id: TARGET_AGENT_ID,
      provider: "claude",
      cwd: tempDir,
      workspaceId: WORKSPACE_ID,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
      lastUserMessageAt: null,
      title: "Schedule profile source",
      labels: {},
      lastStatus: "idle",
      lastModeId: "default",
      config: { modeId: "default", model: "claude-fixture" },
      runtimeInfo: null,
      features: [],
      persistence: null,
      requiresAttention: false,
      attentionReason: null,
      attentionTimestamp: null,
      internal: false,
      archivedAt: null,
    });
  }

  test("dispatches each due run as one target-anchored Loop Task", async () => {
    const service = createService();
    const schedule = await createSchedule(service);

    now = new Date("2026-01-01T00:01:00.000Z");
    await service.tick();

    const inspected = await service.inspect(WORKSPACE_ID, schedule.id);
    expect(inspected.runs).toHaveLength(1);
    expect(inspected.runs[0]).toMatchObject({
      status: "succeeded",
      workspaceId: WORKSPACE_ID,
      executionId: null,
      agentId: null,
      error: null,
    });
    expect(inspected.runs[0]!.taskId).toMatch(/^task-/);
    expect(inspected.runs[0]!.output).toContain(inspected.runs[0]!.taskId!);
    expect(inspected.nextRunAt).toBe("2026-01-01T00:02:00.000Z");

    const store = authority.forWorkspace(WORKSPACE_ID);
    const task = store.getTask(inspected.runs[0]!.taskId!);
    expect(task).toMatchObject({
      mode: "loop",
      status: "queued",
      budget: { strength: "balanced", maxNonCompleteReviews: 10 },
      origin: {
        type: "schedule",
        ownerWorkspaceId: WORKSPACE_ID,
        scheduleId: schedule.id,
        runId: inspected.runs[0]!.id,
      },
    });
    expect(task?.intentContract.id).not.toBe(intentContractId);
    expect(task?.intentContract.workspaceId).toBe(WORKSPACE_ID);
    expect(task?.intentContract.objective).toContain("scheduled task");
    expect(store.listExecutions(task!.id)).toEqual([]);
    expect(scheduleTask).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID, taskId: task!.id });

    const metadata = store.getTaskRuntimeMetadata(task!.id)!;
    expect(authority.catalog.getProviderProfile(metadata.providerProfileId)).toMatchObject({
      adapterId: "claude",
      config: { provider: "claude", cwd: tempDir },
    });
  });

  test("creates a worktree Workspace as the Task execution boundary when requested", async () => {
    const worktreeId = "workspace-schedule-worktree";
    const worktreePath = join(tempDir, "worktree-run");
    await mkdir(worktreePath, { recursive: true });
    const createWorktreeWorkspace = vi.fn(async () => ({
      workspaceId: worktreeId,
      projectId: "project-schedule-test",
      cwd: worktreePath,
      kind: "worktree" as const,
      displayName: "Schedule worktree",
      title: "Schedule worktree",
      branch: "schedule-worktree",
      baseBranch: "main",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      archivedAt: null,
    }));
    const service = createService({ createWorktreeWorkspace });
    const schedule = await createSchedule(service, {
      target: {
        type: "new-agent",
        config: { provider: "claude", isolation: "worktree" },
      },
    });

    await service.runOnce(WORKSPACE_ID, schedule.id);

    const run = (await service.inspect(WORKSPACE_ID, schedule.id)).runs[0]!;
    expect(createWorktreeWorkspace).toHaveBeenCalledOnce();
    expect(run.error).toBeNull();
    expect(run.workspaceId).toBe(worktreeId);
    const task = authority.forWorkspace(worktreeId).getTask(run.taskId!);
    expect(task).toMatchObject({
      workspaceId: worktreeId,
      mode: "loop",
      origin: { ownerWorkspaceId: WORKSPACE_ID, scheduleId: schedule.id },
      intentContract: { workspaceId: worktreeId },
    });
    expect(scheduleTask).toHaveBeenCalledWith({ workspaceId: worktreeId, taskId: task!.id });
  });

  test("records worktree creation failure without manufacturing Task authority", async () => {
    const service = createService({
      createWorktreeWorkspace: async () => {
        throw new Error("worktree unavailable");
      },
    });
    const schedule = await createSchedule(service, {
      target: {
        type: "new-agent",
        config: { provider: "claude", isolation: "worktree" },
      },
    });

    await service.runOnce(WORKSPACE_ID, schedule.id);

    const run = (await service.inspect(WORKSPACE_ID, schedule.id)).runs[0]!;
    expect(run).toMatchObject({
      status: "failed",
      workspaceId: null,
      taskId: null,
      executionId: null,
      error: "worktree unavailable",
    });
    expect(authority.forWorkspace(WORKSPACE_ID).listTasks()).toEqual([]);
  });

  test("derives an unattended provider profile without running a hidden Agent", async () => {
    const resolveCreateConfig = vi.fn(async () => ({
      modeId: "trusted",
      featureValues: { fast: true },
    }));
    const service = createService({ providerSnapshotManager: { resolveCreateConfig } });
    const schedule = await createSchedule(service, {
      target: { type: "new-agent", config: { provider: "opencode", model: "large" } },
    });

    await service.runOnce(WORKSPACE_ID, schedule.id);

    expect(resolveCreateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "opencode",
        cwd: tempDir,
        parent: null,
        unattended: true,
      }),
    );
    const run = (await service.inspect(WORKSPACE_ID, schedule.id)).runs[0]!;
    const metadata = authority.forWorkspace(WORKSPACE_ID).getTaskRuntimeMetadata(run.taskId!)!;
    expect(authority.catalog.getProviderProfile(metadata.providerProfileId)).toMatchObject({
      adapterId: "opencode",
      config: {
        provider: "opencode",
        cwd: tempDir,
        model: "large",
        modeId: "trusted",
        featureValues: { fast: true },
      },
    });
    expect(await agentStorage.list()).toHaveLength(0);
  });

  test("uses an existing Agent only as a provider-profile source", async () => {
    await registerTargetAgent();
    const service = createService();
    const schedule = await createSchedule(service, {
      target: { type: "agent", agentId: TARGET_AGENT_ID },
    });

    await service.runOnce(WORKSPACE_ID, schedule.id);

    const run = (await service.inspect(WORKSPACE_ID, schedule.id)).runs[0]!;
    const metadata = authority.forWorkspace(WORKSPACE_ID).getTaskRuntimeMetadata(run.taskId!)!;
    expect(authority.catalog.getProviderProfile(metadata.providerProfileId)).toMatchObject({
      adapterId: "claude",
      config: {
        provider: "claude",
        cwd: tempDir,
        modeId: "default",
        model: "claude-fixture",
      },
    });
    expect((await agentStorage.get(TARGET_AGENT_ID))?.archivedAt).toBeNull();
  });

  test("rejects missing or cross-Workspace target Agents", async () => {
    const service = createService();
    await expect(
      createSchedule(service, {
        target: { type: "agent", agentId: TARGET_AGENT_ID },
      }),
    ).rejects.toThrow(`Agent ${TARGET_AGENT_ID} is outside Workspace ${WORKSPACE_ID}`);
  });

  test("requires a confirmed Intent Contract before create or run", async () => {
    const service = createService();
    await expect(
      createSchedule(service, { intentContractId: "intent-contract-missing" }),
    ).rejects.toThrow("was not found");

    const schedule = await createSchedule(service);
    const stored = authority.forWorkspace(WORKSPACE_ID).coordination.getSchedule(schedule.id)!;
    authority.forWorkspace(WORKSPACE_ID).coordination.putSchedule({
      ...stored,
      status: "needs_contract",
      intentContractId: null,
    });
    await expect(service.runOnce(WORKSPACE_ID, schedule.id)).rejects.toThrow(
      "requires a confirmed Intent Contract",
    );
  });

  test("requires a newly confirmed contract for every substantive update", async () => {
    const service = createService();
    const schedule = await createSchedule(service);
    await expect(
      service.update(WORKSPACE_ID, { id: schedule.id, prompt: "Changed" }),
    ).rejects.toThrow("newly confirmed Intent Contract");
    await expect(
      service.update(WORKSPACE_ID, {
        id: schedule.id,
        prompt: "Changed",
        intentContractId,
      }),
    ).rejects.toThrow("newly confirmed Intent Contract");

    const replacement = seedReplacementContract("prompt");
    const updated = await service.update(WORKSPACE_ID, {
      id: schedule.id,
      prompt: "Changed after Clarify",
      cadence: { type: "cron", expression: "0 * * * *", timezone: "UTC" },
      intentContractId: replacement,
    });
    expect(updated).toMatchObject({
      prompt: "Changed after Clarify",
      cadence: { type: "cron", expression: "0 * * * *", timezone: "UTC" },
      intentContractId: replacement,
    });
  });

  test("allows presentation-only name changes without replacing the contract", async () => {
    const service = createService();
    const schedule = await createSchedule(service);
    const updated = await service.update(WORKSPACE_ID, {
      id: schedule.id,
      name: "Daily review",
    });
    expect(updated.name).toBe("Daily review");
    expect(updated.intentContractId).toBe(intentContractId);
  });

  test("treats an unchanged editor snapshot as presentation-only", async () => {
    const service = createService();
    const schedule = await createSchedule(service, {
      maxRuns: 2,
      expiresAt: null,
    });
    const updated = await service.update(WORKSPACE_ID, {
      id: schedule.id,
      name: "Daily review from the full editor",
      prompt: schedule.prompt,
      cadence: schedule.cadence,
      newAgentConfig: {
        provider: "claude",
        model: null,
        modeId: null,
        isolation: "same-workspace",
      },
      intentContractId,
      maxRuns: 2,
      expiresAt: null,
    });
    expect(updated).toMatchObject({
      name: "Daily review from the full editor",
      prompt: schedule.prompt,
      cadence: schedule.cadence,
      intentContractId,
      maxRuns: 2,
      expiresAt: null,
    });
  });

  test("validates target-specific updates before contract replacement", async () => {
    await registerTargetAgent();
    const service = createService();
    const schedule = await createSchedule(service, {
      target: { type: "agent", agentId: TARGET_AGENT_ID },
    });
    await expect(
      service.update(WORKSPACE_ID, {
        id: schedule.id,
        newAgentConfig: { provider: "opencode" },
      }),
    ).rejects.toThrow("only valid for new-agent target schedules");
  });

  test("updates new-Agent provider controls only with a replacement contract", async () => {
    const service = createService();
    const schedule = await createSchedule(service);
    const replacement = seedReplacementContract("provider");
    const updated = await service.update(WORKSPACE_ID, {
      id: schedule.id,
      newAgentConfig: {
        provider: "opencode",
        model: "provider-model",
        modeId: "build",
        isolation: "worktree",
      },
      intentContractId: replacement,
    });
    expect(updated.target).toEqual({
      type: "new-agent",
      config: {
        provider: "opencode",
        model: "provider-model",
        modeId: "build",
        isolation: "worktree",
      },
    });
  });

  test("pause and resume preserve the bound contract", async () => {
    const service = createService();
    const schedule = await createSchedule(service);
    const paused = await service.pause(WORKSPACE_ID, schedule.id);
    expect(paused).toMatchObject({
      status: "paused",
      nextRunAt: null,
      intentContractId,
    });

    now = new Date("2026-01-01T00:10:00.000Z");
    const resumed = await service.resume(WORKSPACE_ID, schedule.id);
    expect(resumed).toMatchObject({
      status: "active",
      nextRunAt: "2026-01-01T00:11:00.000Z",
      intentContractId,
    });
  });

  test("manual run records a Task without advancing cadence or max-run completion", async () => {
    const service = createService();
    const schedule = await createSchedule(service, { maxRuns: 1, runOnCreate: false });
    const nextRunAt = schedule.nextRunAt;

    await service.runOnce(WORKSPACE_ID, schedule.id);

    const inspected = await service.inspect(WORKSPACE_ID, schedule.id);
    expect(inspected.status).toBe("active");
    expect(inspected.nextRunAt).toBe(nextRunAt);
    expect(inspected.runs).toHaveLength(1);
    expect(inspected.runs[0]!.taskId).toMatch(/^task-/);
  });

  test("automatic dispatch completes a max-run Schedule", async () => {
    const service = createService();
    const schedule = await createSchedule(service, { maxRuns: 1 });
    await service.tick();
    const inspected = await service.inspect(WORKSPACE_ID, schedule.id);
    expect(inspected).toMatchObject({ status: "completed", nextRunAt: null });
    await expect(service.runOnce(WORKSPACE_ID, schedule.id)).rejects.toThrow("already completed");
  });

  test("restart marks only the interrupted Schedule dispatch as failed", async () => {
    const service = createService();
    const schedule = await createSchedule(service, { runOnCreate: false });
    authority.forWorkspace(WORKSPACE_ID).coordination.putSchedule({
      ...schedule,
      runs: [
        {
          id: "run-interrupted",
          workspaceId: null,
          taskId: null,
          executionId: null,
          scheduledFor: now.toISOString(),
          startedAt: now.toISOString(),
          endedAt: null,
          status: "running",
          agentId: null,
          output: null,
          error: null,
        },
      ],
    });
    now = new Date("2026-01-01T00:00:30.000Z");

    await service.start();
    await service.stop();

    expect((await service.inspect(WORKSPACE_ID, schedule.id)).runs[0]).toMatchObject({
      status: "failed",
      endedAt: now.toISOString(),
      error: "Daemon restarted before the scheduled run completed",
    });
    expect(authority.forWorkspace(WORKSPACE_ID).listTasks()).toEqual([]);
  });

  test("deletes a Schedule without deleting Tasks produced by prior runs", async () => {
    const service = createService();
    const schedule = await createSchedule(service);
    await service.runOnce(WORKSPACE_ID, schedule.id);
    const taskId = (await service.inspect(WORKSPACE_ID, schedule.id)).runs[0]!.taskId!;

    await service.delete(WORKSPACE_ID, schedule.id);

    await expect(service.inspect(WORKSPACE_ID, schedule.id)).rejects.toThrow("Schedule not found");
    expect(authority.forWorkspace(WORKSPACE_ID).getTask(taskId)).not.toBeNull();
  });
});
