import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Logger } from "pino";
import type { AgentRegistry } from "../agent/agent-storage.js";
import { computeNextRunAt, validateScheduleCadence } from "./cron.js";
import type { WorkspaceAuthorityManager } from "../workspace-authority/workspace-authority-manager.js";
import type { WorkspaceCoordinationRepository } from "../workspace-authority/coordination-repository.js";
import type { WorkspaceTaskCoordinator } from "../workspace-authority/task-coordinator.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";
import type {
  ProviderSnapshotManager,
  ResolvedProviderCreateConfig,
  ResolveProviderCreateConfigOptions,
} from "../agent/provider-snapshot-manager.js";
import type {
  CreateScheduleInput,
  ScheduleRun,
  ScheduleTarget,
  StoredSchedule,
  UpdateScheduleInput,
  UpdateScheduleNewAgentConfig,
} from "@thoth/protocol/schedule/types";

const SCHEDULE_TICK_INTERVAL_MS = 1000;

interface ScheduledAuthorityBinding {
  workspaceId: string;
  taskId: string;
}

function trimOptionalName(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error("Schedule prompt is required");
  }
  return trimmed;
}

function applyNewAgentConfig(
  target: Extract<ScheduleTarget, { type: "new-agent" }>,
  patch: UpdateScheduleNewAgentConfig,
): Extract<ScheduleTarget, { type: "new-agent" }> {
  const config = { ...target.config };
  if (patch.provider !== undefined) {
    const trimmed = patch.provider.trim();
    if (!trimmed) {
      throw new Error("provider cannot be empty");
    }
    config.provider = trimmed;
  }
  if (patch.model !== undefined) {
    const trimmed = patch.model?.trim();
    if (trimmed) {
      config.model = trimmed;
    } else {
      delete config.model;
    }
  }
  if (patch.modeId !== undefined) {
    const trimmed = patch.modeId?.trim();
    if (trimmed) {
      config.modeId = trimmed;
    } else {
      delete config.modeId;
    }
  }
  if (patch.isolation !== undefined) {
    config.isolation = patch.isolation;
  }
  return { ...target, config };
}

function normalizeMaxRuns(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("maxRuns must be a positive integer");
  }
  return value;
}

function equivalentCadence(
  left: StoredSchedule["cadence"],
  right: StoredSchedule["cadence"],
): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "every" && right.type === "every") {
    return left.everyMs === right.everyMs;
  }
  if (left.type === "cron" && right.type === "cron") {
    return (
      left.expression === right.expression && (left.timezone ?? "UTC") === (right.timezone ?? "UTC")
    );
  }
  return false;
}

function equivalentTarget(left: ScheduleTarget, right: ScheduleTarget): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "agent" && right.type === "agent") return left.agentId === right.agentId;
  if (left.type !== "new-agent" || right.type !== "new-agent") return false;
  return isDeepStrictEqual(
    { ...left.config, isolation: left.config.isolation ?? "same-workspace" },
    { ...right.config, isolation: right.config.isolation ?? "same-workspace" },
  );
}

function countCompletedRuns(schedule: StoredSchedule): number {
  return schedule.runs.filter((run) => run.status !== "running").length;
}

function shouldCompleteSchedule(schedule: StoredSchedule, now: Date): boolean {
  if (schedule.expiresAt && new Date(schedule.expiresAt).getTime() <= now.getTime()) {
    return true;
  }
  if (schedule.maxRuns == null) {
    return false;
  }
  return countCompletedRuns(schedule) >= schedule.maxRuns;
}

function completeSchedule(schedule: StoredSchedule, now: Date): StoredSchedule {
  return {
    ...schedule,
    status: "completed",
    nextRunAt: null,
    pausedAt: null,
    updatedAt: now.toISOString(),
  };
}

type CreateConfigResolver = Pick<ProviderSnapshotManager, "resolveCreateConfig">;

export interface ScheduleWorktreeWorkspaceInput {
  sourceWorkspaceId: string;
  cwd: string;
  prompt: string;
  scheduleId: string;
  runId: string;
}

export type CreateScheduleWorktreeWorkspace = (
  input: ScheduleWorktreeWorkspaceInput,
) => Promise<PersistedWorkspaceRecord>;

export interface ScheduleServiceOptions {
  authority: WorkspaceAuthorityManager;
  taskCoordinator: WorkspaceTaskCoordinator;
  logger: Logger;
  agentStorage: AgentRegistry;
  providerSnapshotManager: CreateConfigResolver;
  createWorktreeWorkspace?: CreateScheduleWorktreeWorkspace;
  now?: () => Date;
}

export class ScheduleService {
  private readonly authority: WorkspaceAuthorityManager;
  private readonly taskCoordinator: WorkspaceTaskCoordinator;
  private readonly logger: Logger;
  private readonly agentStorage: AgentRegistry;
  private readonly createConfigResolver: CreateConfigResolver;
  private readonly createWorktreeWorkspace: CreateScheduleWorktreeWorkspace | null;
  private readonly now: () => Date;
  private readonly runningScheduleIds = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ScheduleServiceOptions) {
    this.authority = options.authority;
    this.taskCoordinator = options.taskCoordinator;
    this.logger = options.logger.child({ module: "schedule-service" });
    this.agentStorage = options.agentStorage;
    this.createConfigResolver = options.providerSnapshotManager;
    this.createWorktreeWorkspace = options.createWorktreeWorkspace ?? null;
    this.now = options.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    await this.recoverInterruptedRuns();
    if (this.tickTimer) {
      return;
    }
    const timer = setInterval(() => {
      void this.tick().catch((error) => {
        this.logger.error({ err: error }, "Failed to process schedule tick");
      });
    }, SCHEDULE_TICK_INTERVAL_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.tickTimer = timer;
  }

  async stop(): Promise<void> {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  close(): void {}

  async create(workspaceId: string, input: CreateScheduleInput): Promise<StoredSchedule> {
    const now = this.now();
    const prompt = normalizePrompt(input.prompt);
    validateScheduleCadence(input.cadence);
    const runOnCreate = input.runOnCreate ?? input.cadence.type === "every";
    const nextRunAt = runOnCreate ? now : computeNextRunAt(input.cadence, now);
    const target = await this.normalizeTarget(workspaceId, input.target);
    this.requireConfirmedScheduleContract(workspaceId, input.intentContractId);
    const schedule = this.repository(workspaceId).createSchedule({
      name: trimOptionalName(input.name),
      prompt,
      cadence: input.cadence,
      target,
      intentContractId: input.intentContractId,
      status: "active",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextRunAt: nextRunAt.toISOString(),
      lastRunAt: null,
      pausedAt: null,
      expiresAt: input.expiresAt ?? null,
      maxRuns: normalizeMaxRuns(input.maxRuns),
      runs: [],
    });
    return schedule;
  }

  async list(workspaceId: string): Promise<StoredSchedule[]> {
    return this.repository(workspaceId).listSchedules();
  }

  async inspect(workspaceId: string, id: string): Promise<StoredSchedule> {
    const schedule = this.repository(workspaceId).getSchedule(id);
    if (!schedule) {
      throw new Error(`Schedule not found: ${id}`);
    }
    return schedule;
  }

  async logs(workspaceId: string, id: string): Promise<ScheduleRun[]> {
    const schedule = await this.inspect(workspaceId, id);
    return [...schedule.runs].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  async pause(workspaceId: string, id: string): Promise<StoredSchedule> {
    const schedule = await this.inspect(workspaceId, id);
    if (schedule.status === "needs_contract") return schedule;
    if (schedule.status === "completed") {
      throw new Error(`Schedule ${id} is already completed`);
    }
    if (schedule.status === "paused") {
      return schedule;
    }
    const now = this.now();
    const paused = {
      ...schedule,
      status: "paused" as const,
      nextRunAt: null,
      pausedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.repository(workspaceId).putSchedule(paused);
    return paused;
  }

  async resume(workspaceId: string, id: string): Promise<StoredSchedule> {
    const schedule = await this.inspect(workspaceId, id);
    if (schedule.status === "needs_contract" || !schedule.intentContractId) {
      throw new Error(`Schedule ${id} requires a confirmed Intent Contract before resume`);
    }
    if (schedule.status === "completed") {
      throw new Error(`Schedule ${id} is already completed`);
    }
    if (schedule.status === "active") {
      return schedule;
    }
    const now = this.now();
    const resumed = {
      ...schedule,
      status: "active" as const,
      pausedAt: null,
      nextRunAt: computeNextRunAt(schedule.cadence, now).toISOString(),
      updatedAt: now.toISOString(),
    };
    this.repository(workspaceId).putSchedule(resumed);
    return resumed;
  }

  async update(workspaceId: string, input: UpdateScheduleInput): Promise<StoredSchedule> {
    const schedule = await this.inspect(workspaceId, input.id);
    const now = this.now();
    let updated: StoredSchedule = schedule;
    if (input.newAgentConfig !== undefined && schedule.target.type !== "new-agent") {
      throw new Error("new-agent config updates are only valid for new-agent target schedules");
    }
    const nextPrompt = input.prompt === undefined ? schedule.prompt : normalizePrompt(input.prompt);
    const nextCadence = input.cadence ?? schedule.cadence;
    if (input.cadence !== undefined) validateScheduleCadence(nextCadence);
    const nextTarget =
      input.newAgentConfig === undefined || schedule.target.type !== "new-agent"
        ? schedule.target
        : applyNewAgentConfig(schedule.target, input.newAgentConfig);
    const nextMaxRuns =
      input.maxRuns === undefined ? schedule.maxRuns : normalizeMaxRuns(input.maxRuns);
    const nextExpiresAt = input.expiresAt === undefined ? schedule.expiresAt : input.expiresAt;
    const changesExecutionContract =
      nextPrompt !== schedule.prompt ||
      !equivalentCadence(nextCadence, schedule.cadence) ||
      !equivalentTarget(nextTarget, schedule.target) ||
      nextMaxRuns !== schedule.maxRuns ||
      nextExpiresAt !== schedule.expiresAt;
    if (
      changesExecutionContract &&
      (!input.intentContractId || input.intentContractId === schedule.intentContractId)
    ) {
      throw new Error("A substantive Schedule update requires a newly confirmed Intent Contract");
    }
    if (input.intentContractId) {
      this.requireConfirmedScheduleContract(workspaceId, input.intentContractId);
      updated = { ...updated, intentContractId: input.intentContractId };
    }

    if (input.prompt !== undefined) {
      updated = { ...updated, prompt: nextPrompt };
    }

    if (input.name !== undefined) {
      updated = { ...updated, name: trimOptionalName(input.name) };
    }

    if (input.cadence !== undefined) {
      const nextRunAt =
        updated.status === "active" ? computeNextRunAt(nextCadence, now).toISOString() : null;
      updated = { ...updated, cadence: nextCadence, nextRunAt };
    }

    if (input.newAgentConfig !== undefined) {
      if (updated.target.type !== "new-agent")
        throw new Error("Schedule target changed concurrently");
      updated = { ...updated, target: nextTarget };
    }

    if (input.maxRuns !== undefined) {
      updated = { ...updated, maxRuns: nextMaxRuns };
    }

    if (input.expiresAt !== undefined) {
      updated = { ...updated, expiresAt: nextExpiresAt };
    }

    updated = { ...updated, updatedAt: now.toISOString() };
    this.repository(workspaceId).putSchedule(updated);
    return updated;
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    this.repository(workspaceId).deleteSchedule(id);
  }

  async deleteForAgent(workspaceId: string, agentId: string): Promise<number> {
    const schedules = this.repository(workspaceId).listSchedules();
    const matches = schedules.filter(
      (schedule) => schedule.target.type === "agent" && schedule.target.agentId === agentId,
    );
    const results = await Promise.allSettled(
      matches.map(async (schedule) => this.repository(workspaceId).deleteSchedule(schedule.id)),
    );
    let deleted = 0;
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        deleted += 1;
      } else {
        this.logger.warn(
          { err: result.reason, scheduleId: matches[index].id, agentId },
          "Failed to delete schedule for archived agent; continuing",
        );
      }
    }
    return deleted;
  }

  async runOnce(workspaceId: string, id: string): Promise<StoredSchedule> {
    const schedule = await this.inspect(workspaceId, id);
    if (schedule.status === "needs_contract" || !schedule.intentContractId) {
      throw new Error(`Schedule ${id} requires a confirmed Intent Contract before it can run`);
    }
    if (schedule.status === "completed") {
      throw new Error(`Schedule ${id} is already completed`);
    }
    if (this.runningScheduleIds.has(this.scheduleKey(workspaceId, id))) {
      throw new Error(`Schedule ${id} is already running`);
    }
    await this.runSchedule(workspaceId, schedule, this.now(), { manual: true });
    return this.inspect(workspaceId, id);
  }

  async tick(): Promise<void> {
    const now = this.now();
    for (const workspace of this.authority.catalog.listWorkspaces()) {
      await this.tickWorkspace(workspace.id, now);
    }
  }

  private async tickWorkspace(workspaceId: string, now: Date): Promise<void> {
    const repository = this.repository(workspaceId);
    const schedules = repository.listSchedules();
    for (const schedule of schedules) {
      if (schedule.status !== "active" || !schedule.nextRunAt) {
        continue;
      }
      if (this.runningScheduleIds.has(this.scheduleKey(workspaceId, schedule.id))) {
        continue;
      }
      if (shouldCompleteSchedule(schedule, now)) {
        repository.putSchedule(completeSchedule(schedule, now));
        continue;
      }
      if (new Date(schedule.nextRunAt).getTime() > now.getTime()) {
        continue;
      }
      await this.runSchedule(workspaceId, schedule, now);
    }
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const now = this.now();
    for (const workspace of this.authority.catalog.listWorkspaces()) {
      const repository = this.repository(workspace.id);
      const schedules = repository.listSchedules();
      await Promise.all(
        schedules.map(async (schedule) => {
          let updated = { ...schedule };
          let dirty = false;

          // Mark any in-flight runs as failed
          const runningIndex = updated.runs.findIndex((run) => run.status === "running");
          if (runningIndex !== -1) {
            const runs = [...updated.runs];
            runs[runningIndex] = {
              ...runs[runningIndex],
              status: "failed",
              endedAt: now.toISOString(),
              error: "Daemon restarted before the scheduled run completed",
            };
            updated = { ...updated, runs };
            dirty = true;
          }

          // Advance stale nextRunAt for active schedules
          if (
            updated.status === "active" &&
            updated.nextRunAt &&
            new Date(updated.nextRunAt).getTime() <= now.getTime()
          ) {
            let nextRunAt = computeNextRunAt(updated.cadence, new Date(updated.nextRunAt));
            while (nextRunAt.getTime() <= now.getTime()) {
              nextRunAt = computeNextRunAt(updated.cadence, nextRunAt);
            }
            updated = { ...updated, nextRunAt: nextRunAt.toISOString() };
            dirty = true;
          }

          if (dirty) {
            updated = { ...updated, updatedAt: now.toISOString() };
            repository.putSchedule(updated);
          }
        }),
      );
    }
  }

  private async runSchedule(
    workspaceId: string,
    schedule: StoredSchedule,
    now: Date,
    options?: { manual?: boolean },
  ): Promise<void> {
    const manual = options?.manual === true;
    const scheduleKey = this.scheduleKey(workspaceId, schedule.id);
    this.runningScheduleIds.add(scheduleKey);
    const runId = randomUUID();
    const runningRun: ScheduleRun = {
      id: runId,
      workspaceId: null,
      taskId: null,
      executionId: null,
      scheduledFor: manual ? now.toISOString() : (schedule.nextRunAt ?? now.toISOString()),
      startedAt: now.toISOString(),
      endedAt: null,
      status: "running",
      agentId: null,
      output: null,
      error: null,
    };
    const scheduleWithRun = {
      ...schedule,
      updatedAt: now.toISOString(),
      runs: [...schedule.runs, runningRun],
    };
    this.repository(workspaceId).putSchedule(scheduleWithRun);

    let authorityBinding: ScheduledAuthorityBinding | null = null;
    try {
      const executionWorkspaceId = await this.resolveExecutionWorkspace(
        workspaceId,
        scheduleWithRun,
        runId,
      );
      authorityBinding = await this.beginScheduledAuthority(
        executionWorkspaceId,
        scheduleWithRun,
        runId,
        workspaceId,
      );
      this.recordRunAuthority(workspaceId, schedule.id, runId, authorityBinding);
      await this.finishRun({
        workspaceId,
        scheduleId: schedule.id,
        runId,
        status: "succeeded",
        agentId: null,
        output: `Registered background Task ${authorityBinding.taskId}.`,
        error: null,
        manual,
      });
    } catch (error) {
      await this.finishRun({
        workspaceId,
        scheduleId: schedule.id,
        runId,
        status: "failed",
        agentId: null,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        manual,
      });
    } finally {
      this.runningScheduleIds.delete(scheduleKey);
    }
  }

  private async beginScheduledAuthority(
    workspaceId: string,
    schedule: StoredSchedule,
    runId: string,
    ownerWorkspaceId: string,
  ): Promise<ScheduledAuthorityBinding> {
    const now = this.now().toISOString();
    const executionWorkspace = this.authority.catalog.getWorkspace(workspaceId);
    if (!executionWorkspace) {
      throw new Error(`Workspace ${workspaceId} is not registered`);
    }
    const existingAgent =
      schedule.target.type === "agent"
        ? await this.agentStorage.get(schedule.target.agentId)
        : null;
    const adapterId =
      schedule.target.type === "new-agent"
        ? schedule.target.config.provider
        : existingAgent?.provider;
    if (!adapterId) {
      throw new Error(`Schedule ${schedule.id} has no available Provider profile`);
    }
    let profileConfig: Record<string, unknown>;
    if (schedule.target.type === "new-agent") {
      const targetConfig = {
        ...schedule.target.config,
        cwd: executionWorkspace.canonicalPath,
      };
      const unattended = targetConfig.modeId
        ? { modeId: targetConfig.modeId, featureValues: targetConfig.featureValues }
        : await this.resolveProviderCreateConfig({
            provider: targetConfig.provider,
            cwd: targetConfig.cwd,
            requestedMode: undefined,
            featureValues: targetConfig.featureValues,
            parent: null,
            unattended: true,
          });
      profileConfig = {
        ...targetConfig,
        ...(unattended.modeId ? { modeId: unattended.modeId } : {}),
        ...(unattended.featureValues ? { featureValues: unattended.featureValues } : {}),
      };
    } else {
      profileConfig = {
        provider: existingAgent!.provider,
        cwd: executionWorkspace.canonicalPath,
        ...(existingAgent!.config ?? {}),
      };
    }

    if (!schedule.intentContractId) {
      throw new Error(`Schedule ${schedule.id} requires a confirmed Intent Contract`);
    }
    const template = this.requireConfirmedScheduleContract(
      ownerWorkspaceId,
      schedule.intentContractId,
    );
    const clonedContract = {
      ...template,
      id: `intent-contract-${randomUUID()}`,
      workspaceId,
      taskId: null,
      acceptanceClaims: template.acceptanceClaims.map((claim) => ({
        ...claim,
        id: `acceptance-claim-${randomUUID()}`,
        status: "open" as const,
        evidenceRefs: [],
        revision: 1,
      })),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const registered = this.taskCoordinator.register({
      workspaceId,
      sourceAgentWorkspaceId: ownerWorkspaceId,
      sourceAgentId: clonedContract.sourceAgentId,
      sourceTurnId: `schedule-turn-${runId}`,
      sourceContractCardId: `schedule-contract-${schedule.intentContractId}`,
      mode: "loop",
      loopStrength: "balanced",
      intentContract: clonedContract,
      providerProfile: {
        adapterId,
        config: profileConfig,
      },
      origin: {
        type: "schedule",
        ownerWorkspaceId,
        scheduleId: schedule.id,
        runId,
      },
    });
    return {
      workspaceId,
      taskId: registered.task.id,
    };
  }

  private recordRunAuthority(
    ownerWorkspaceId: string,
    scheduleId: string,
    runId: string,
    binding: ScheduledAuthorityBinding,
  ): void {
    const schedule = this.repository(ownerWorkspaceId).getSchedule(scheduleId);
    if (!schedule) {
      throw new Error(`Schedule not found while recording authority: ${scheduleId}`);
    }
    this.repository(ownerWorkspaceId).putSchedule({
      ...schedule,
      runs: schedule.runs.map((run) =>
        run.id === runId
          ? {
              ...run,
              workspaceId: binding.workspaceId,
              taskId: binding.taskId,
              executionId: null,
            }
          : run,
      ),
    });
  }

  private async resolveExecutionWorkspace(
    ownerWorkspaceId: string,
    schedule: StoredSchedule,
    runId: string,
  ): Promise<string> {
    if (
      schedule.target.type !== "new-agent" ||
      (schedule.target.config.isolation ?? "same-workspace") !== "worktree"
    ) {
      return ownerWorkspaceId;
    }
    const sourceWorkspace = this.authority.catalog.getWorkspace(ownerWorkspaceId);
    if (!sourceWorkspace) {
      throw new Error(`Workspace ${ownerWorkspaceId} is not registered`);
    }
    if (!this.createWorktreeWorkspace) {
      throw new Error("Schedule worktree isolation is unavailable in this daemon runtime");
    }
    const worktree = await this.createWorktreeWorkspace({
      sourceWorkspaceId: ownerWorkspaceId,
      cwd: sourceWorkspace.canonicalPath,
      prompt: schedule.prompt,
      scheduleId: schedule.id,
      runId,
    });
    if (worktree.kind !== "worktree") {
      throw new Error(`Schedule ${schedule.id} did not receive a worktree Workspace`);
    }
    if (worktree.workspaceId === ownerWorkspaceId) {
      throw new Error(`Schedule ${schedule.id} worktree isolation reused its source Workspace`);
    }
    this.authority.registerWorkspace(worktree);
    return worktree.workspaceId;
  }

  private async finishRun(params: {
    workspaceId: string;
    scheduleId: string;
    runId: string;
    status: "succeeded" | "failed";
    agentId: string | null;
    output: string | null;
    error: string | null;
    manual: boolean;
  }): Promise<void> {
    const schedule = await this.inspect(params.workspaceId, params.scheduleId);
    const now = this.now();
    const completedRuns = schedule.runs.map((run) =>
      run.id === params.runId
        ? {
            ...run,
            status: params.status,
            endedAt: now.toISOString(),
            agentId: params.agentId,
            output: params.output,
            error: params.error,
          }
        : run,
    );
    let updated: StoredSchedule = {
      ...schedule,
      runs: completedRuns,
      lastRunAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    if (params.manual) {
      // Manual one-shot runs do not advance the cadence or recompute completion.
    } else if (shouldCompleteSchedule(updated, now)) {
      updated = completeSchedule(updated, now);
    } else if (updated.status === "paused") {
      updated = {
        ...updated,
        nextRunAt: null,
      };
    } else {
      const after = new Date(schedule.nextRunAt ?? now.toISOString());
      let nextRunAt = computeNextRunAt(updated.cadence, after);
      while (nextRunAt.getTime() <= now.getTime()) {
        nextRunAt = computeNextRunAt(updated.cadence, nextRunAt);
      }
      updated = {
        ...updated,
        nextRunAt: nextRunAt.toISOString(),
      };
    }

    this.repository(params.workspaceId).putSchedule(updated);
  }

  private async resolveProviderCreateConfig(
    input: ResolveProviderCreateConfigOptions,
  ): Promise<ResolvedProviderCreateConfig> {
    return this.createConfigResolver.resolveCreateConfig(input);
  }

  private repository(workspaceId: string): WorkspaceCoordinationRepository {
    return this.authority.forWorkspace(workspaceId).coordination;
  }

  private requireConfirmedScheduleContract(workspaceId: string, contractId: string) {
    const contract = this.authority.forWorkspace(workspaceId).getIntentContract(contractId);
    if (!contract)
      throw new Error(`Intent Contract ${contractId} was not found in Workspace ${workspaceId}`);
    if (contract.status !== "confirmed") {
      throw new Error(`Intent Contract ${contractId} is not confirmed`);
    }
    return contract;
  }

  private scheduleKey(workspaceId: string, scheduleId: string): string {
    return `${workspaceId}:${scheduleId}`;
  }

  private async normalizeTarget(
    workspaceId: string,
    target: ScheduleTarget,
  ): Promise<ScheduleTarget> {
    if (target.type === "agent") {
      const record = await this.agentStorage.get(target.agentId);
      if (!record || record.workspaceId !== workspaceId) {
        throw new Error(`Agent ${target.agentId} is outside Workspace ${workspaceId}`);
      }
      return target;
    }
    const workspace = this.authority.catalog.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} is not registered`);
    }
    return target;
  }
}
