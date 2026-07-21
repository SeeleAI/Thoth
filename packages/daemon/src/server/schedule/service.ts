import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { AgentManager } from "../agent/agent-manager.js";
import type { AgentRegistry } from "../agent/agent-storage.js";
import type { AgentSessionConfig } from "@thoth/drivers/agent-runtime";
import { curateAgentActivity } from "@thoth/drivers/internal/server/agent/activity-curator";
import { ensureAgentLoaded } from "../agent/agent-loading.js";
import { formatSystemNotificationPrompt } from "../agent/agent-prompt.js";
import { resolveCreateAgentTitles } from "../agent/create-agent-title.js";
import { computeNextRunAt, validateScheduleCadence } from "./cron.js";
import type { WorkspaceAuthorityManager } from "../workspace-authority/workspace-authority-manager.js";
import type { WorkspaceCoordinationRepository } from "../workspace-authority/coordination-repository.js";
import type {
  ProviderSnapshotManager,
  ResolvedProviderCreateConfig,
  ResolveProviderCreateConfigOptions,
} from "../agent/provider-snapshot-manager.js";
import type {
  CreateScheduleInput,
  ScheduleExecutionResult,
  ScheduleRun,
  ScheduleTarget,
  StoredSchedule,
  UpdateScheduleInput,
  UpdateScheduleNewAgentConfig,
} from "@thoth/protocol/schedule/types";

const SCHEDULE_TICK_INTERVAL_MS = 1000;

function trimOptionalName(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildScheduleFireBody(schedule: StoredSchedule, runId: string): string {
  const heading = schedule.name
    ? `Schedule "${schedule.name}" fired (id=${schedule.id}, run=${runId}).`
    : `Schedule fired (id=${schedule.id}, run=${runId}).`;
  return `${heading}\n${schedule.prompt}`;
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

function buildRunOutput(params: {
  output: string | null;
  timelineText: string;
  finalText: string;
}): string | null {
  if (params.output && params.output.trim().length > 0) {
    return params.output;
  }
  if (params.finalText.trim().length > 0) {
    return params.finalText.trim();
  }
  if (params.timelineText.trim().length > 0) {
    return params.timelineText.trim();
  }
  return null;
}

type CreateConfigResolver = Pick<ProviderSnapshotManager, "resolveCreateConfig">;

export interface ScheduleServiceOptions {
  authority: WorkspaceAuthorityManager;
  logger: Logger;
  agentManager: AgentManager;
  agentStorage: AgentRegistry;
  providerSnapshotManager: CreateConfigResolver;
  now?: () => Date;
  runner?: (
    workspaceId: string,
    schedule: StoredSchedule,
    runId: string,
  ) => Promise<ScheduleExecutionResult>;
}

export class ScheduleService {
  private readonly authority: WorkspaceAuthorityManager;
  private readonly logger: Logger;
  private readonly agentManager: AgentManager;
  private readonly agentStorage: AgentRegistry;
  private readonly createConfigResolver: CreateConfigResolver;
  private readonly now: () => Date;
  private readonly runner: (
    workspaceId: string,
    schedule: StoredSchedule,
    runId: string,
  ) => Promise<ScheduleExecutionResult>;
  private readonly runningScheduleIds = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ScheduleServiceOptions) {
    this.authority = options.authority;
    this.logger = options.logger.child({ module: "schedule-service" });
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.createConfigResolver = options.providerSnapshotManager;
    this.now = options.now ?? (() => new Date());
    this.runner =
      options.runner ??
      ((workspaceId, schedule, runId) => this.executeSchedule(workspaceId, schedule, runId));
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
    const schedule = this.repository(workspaceId).createSchedule({
      name: trimOptionalName(input.name),
      prompt,
      cadence: input.cadence,
      target,
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

    if (input.prompt !== undefined) {
      updated = { ...updated, prompt: normalizePrompt(input.prompt) };
    }

    if (input.name !== undefined) {
      updated = { ...updated, name: trimOptionalName(input.name) };
    }

    if (input.cadence !== undefined) {
      validateScheduleCadence(input.cadence);
      const nextRunAt =
        updated.status === "active" ? computeNextRunAt(input.cadence, now).toISOString() : null;
      updated = { ...updated, cadence: input.cadence, nextRunAt };
    }

    if (input.newAgentConfig !== undefined) {
      if (updated.target.type !== "new-agent") {
        throw new Error("new-agent config updates are only valid for new-agent target schedules");
      }
      updated = { ...updated, target: applyNewAgentConfig(updated.target, input.newAgentConfig) };
    }

    if (input.maxRuns !== undefined) {
      updated = { ...updated, maxRuns: normalizeMaxRuns(input.maxRuns) };
    }

    if (input.expiresAt !== undefined) {
      updated = { ...updated, expiresAt: input.expiresAt };
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

    try {
      const result = await this.runner(workspaceId, scheduleWithRun, runId);
      await this.finishRun({
        workspaceId,
        scheduleId: schedule.id,
        runId,
        status: "succeeded",
        agentId: result.agentId,
        output: result.output,
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

  private async executeSchedule(
    workspaceId: string,
    schedule: StoredSchedule,
    runId: string,
  ): Promise<ScheduleExecutionResult> {
    if (schedule.target.type === "agent") {
      const wrappedPrompt = formatSystemNotificationPrompt(buildScheduleFireBody(schedule, runId));
      const record = await this.agentStorage.get(schedule.target.agentId);
      if (record?.workspaceId !== workspaceId) {
        throw new Error(`Agent ${schedule.target.agentId} is outside Workspace ${workspaceId}`);
      }
      if (record?.archivedAt) {
        throw new Error(`Agent ${schedule.target.agentId} is archived`);
      }

      const agent = await ensureAgentLoaded(schedule.target.agentId, {
        agentManager: this.agentManager,
        agentStorage: this.agentStorage,
        logger: this.logger,
      });
      if (this.agentManager.hasInFlightRun(agent.id)) {
        throw new Error(`Agent ${agent.id} already has an active run`);
      }
      const result = await this.agentManager.runAgent(agent.id, wrappedPrompt);
      const timelineText = curateAgentActivity(result.timeline);
      return {
        agentId: agent.id,
        output: buildRunOutput({
          output: null,
          timelineText,
          finalText: result.finalText,
        }),
      };
    }

    const workspace = this.authority.catalog.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} is not registered`);
    }
    const targetConfig = { ...schedule.target.config, cwd: workspace.canonicalPath };
    const resolvedUnattendedConfig = targetConfig.modeId
      ? { modeId: targetConfig.modeId, featureValues: targetConfig.featureValues }
      : await this.resolveProviderCreateConfig({
          provider: targetConfig.provider,
          cwd: targetConfig.cwd,
          requestedMode: undefined,
          featureValues: targetConfig.featureValues,
          parent: null,
          unattended: true,
        });
    const config: AgentSessionConfig = {
      provider: targetConfig.provider,
      cwd: targetConfig.cwd,
      modeId: resolvedUnattendedConfig.modeId,
      model: targetConfig.model,
      thinkingOptionId: targetConfig.thinkingOptionId,
      title: targetConfig.title,
      approvalPolicy: targetConfig.approvalPolicy,
      sandboxMode: targetConfig.sandboxMode,
      networkAccess: targetConfig.networkAccess,
      webSearch: targetConfig.webSearch,
      featureValues: resolvedUnattendedConfig.featureValues,
      extra: targetConfig.extra,
      systemPrompt: targetConfig.systemPrompt,
      mcpServers: targetConfig.mcpServers as AgentSessionConfig["mcpServers"],
    };
    const { provisionalTitle } = resolveCreateAgentTitles({
      configTitle: config.title,
      initialPrompt: schedule.prompt,
    });
    const labels = {
      "thoth.schedule-id": schedule.id,
      "thoth.schedule-run": runId,
    };
    const agent = await this.agentManager.createAgent(config, undefined, {
      labels,
      initialPrompt: schedule.prompt,
      initialTitle: provisionalTitle,
      workspaceId,
    });
    let result;
    try {
      result = await this.agentManager.runAgent(agent.id, schedule.prompt);
    } catch (error) {
      try {
        await this.agentManager.archiveAgent(agent.id);
      } catch (archiveError) {
        this.logger.warn(
          { err: archiveError, agentId: agent.id, scheduleId: schedule.id, runId },
          "Failed to archive scheduled agent after failed run",
        );
      }
      throw error;
    }

    await this.agentManager.archiveAgent(agent.id);
    const timelineText = curateAgentActivity(result.timeline);
    return {
      agentId: agent.id,
      output: buildRunOutput({
        output: null,
        timelineText,
        finalText: result.finalText,
      }),
    };
  }

  private async resolveProviderCreateConfig(
    input: ResolveProviderCreateConfigOptions,
  ): Promise<ResolvedProviderCreateConfig> {
    return this.createConfigResolver.resolveCreateConfig(input);
  }

  private repository(workspaceId: string): WorkspaceCoordinationRepository {
    return this.authority.forWorkspace(workspaceId).coordination;
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
