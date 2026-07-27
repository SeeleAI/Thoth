import { describe, expect, test } from "vitest";

import { ScheduleCadenceSchema, ScheduleRunSchema, ScheduleTargetSchema } from "./types.js";

describe("ScheduleCadenceSchema", () => {
  test("accepts existing UTC cron cadence without a time zone", () => {
    expect(ScheduleCadenceSchema.parse({ type: "cron", expression: "0 9 * * *" })).toEqual({
      type: "cron",
      expression: "0 9 * * *",
    });
  });

  test("accepts timezone-aware cron cadence", () => {
    expect(
      ScheduleCadenceSchema.parse({
        type: "cron",
        expression: "0 9 * * *",
        timezone: "America/New_York",
      }),
    ).toEqual({
      type: "cron",
      expression: "0 9 * * *",
      timezone: "America/New_York",
    });
  });
});

describe("ScheduleRunSchema", () => {
  const legacyRun = {
    id: "run-1",
    scheduledFor: "2026-07-27T00:00:00.000Z",
    startedAt: "2026-07-27T00:00:00.000Z",
    endedAt: null,
    status: "running" as const,
    agentId: null,
    output: null,
    error: null,
  };

  test("keeps older persisted runs backward parseable", () => {
    expect(ScheduleRunSchema.parse(legacyRun)).toMatchObject({
      taskId: null,
      executionId: null,
    });
  });

  test("exposes the durable Task and ExecutionAttempt created by a trigger", () => {
    expect(
      ScheduleRunSchema.parse({
        ...legacyRun,
        taskId: "task-schedule-1",
        executionId: "execution-schedule-1",
      }),
    ).toMatchObject({
      taskId: "task-schedule-1",
      executionId: "execution-schedule-1",
    });
  });
});

describe("ScheduleTargetSchema", () => {
  test("keeps same-Workspace execution as the backward-compatible default", () => {
    expect(
      ScheduleTargetSchema.parse({
        type: "new-agent",
        config: { provider: "codex" },
      }),
    ).toEqual({
      type: "new-agent",
      config: { provider: "codex" },
    });
  });

  test("accepts only an explicit worktree isolation request", () => {
    expect(
      ScheduleTargetSchema.parse({
        type: "new-agent",
        config: { provider: "codex", isolation: "worktree" },
      }),
    ).toEqual({
      type: "new-agent",
      config: { provider: "codex", isolation: "worktree" },
    });
    expect(() =>
      ScheduleTargetSchema.parse({
        type: "new-agent",
        config: { provider: "codex", isolation: "directory" },
      }),
    ).toThrow();
  });
});
