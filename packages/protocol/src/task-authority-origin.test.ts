import { describe, expect, test } from "vitest";

import { TaskOriginSchema } from "./task-authority.js";

describe("TaskOriginSchema", () => {
  test("accepts a canonical Schedule origin", () => {
    expect(
      TaskOriginSchema.parse({
        type: "schedule",
        ownerWorkspaceId: "workspace-owner",
        scheduleId: "schedule-1",
        runId: "run-1",
      }),
    ).toEqual({
      type: "schedule",
      ownerWorkspaceId: "workspace-owner",
      scheduleId: "schedule-1",
      runId: "run-1",
    });
  });

  test("rejects an origin without its owning Workspace", () => {
    expect(
      TaskOriginSchema.safeParse({ type: "schedule", scheduleId: "schedule-1", runId: "run-1" })
        .success,
    ).toBe(false);
  });
});
