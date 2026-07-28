import { describe, expect, it } from "vitest";
import {
  ScheduleCreateRequestSchema,
  ScheduleListRequestSchema,
  ScheduleUpdateRequestSchema,
} from "./rpc-schemas.js";

describe("Workspace-scoped schedule RPC", () => {
  it("requires an explicit Workspace authority scope", () => {
    expect(
      ScheduleListRequestSchema.safeParse({ type: "schedule/list", requestId: "request-1" })
        .success,
    ).toBe(false);
  });

  it("does not accept a client cwd as schedule execution authority", () => {
    const parsed = ScheduleCreateRequestSchema.parse({
      type: "schedule/create",
      requestId: "request-1",
      workspaceId: "workspace-1",
      prompt: "Inspect status",
      cadence: { type: "every", everyMs: 60_000 },
      target: {
        type: "new-agent",
        config: { provider: "codex", cwd: "/client-only/path" },
      },
    });
    expect(parsed.target).toEqual({ type: "new-agent", config: { provider: "codex" } });
  });

  it("updates explicit Schedule isolation through the wire contract", () => {
    expect(
      ScheduleUpdateRequestSchema.parse({
        type: "schedule/update",
        requestId: "request-2",
        workspaceId: "workspace-1",
        scheduleId: "schedule-1",
        newAgentConfig: { isolation: "worktree" },
      }).newAgentConfig,
    ).toEqual({ isolation: "worktree" });
  });
});
