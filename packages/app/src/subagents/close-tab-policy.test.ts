import { describe, expect, it, vi } from "vitest";
import { executeCloseAgentTab, resolveCloseAgentTabPolicy } from "./close-tab-policy";

describe("resolveCloseAgentTabPolicy", () => {
  it("archives root agents when their tab closes", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: null })).toEqual({
      kind: "archive-on-close",
    });
  });

  it("keeps subagent tab close layout-only", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: "parent-agent" })).toEqual({
      kind: "layout-only",
    });
  });

  it("keeps archived and missing authority layout-only", () => {
    expect(
      resolveCloseAgentTabPolicy({
        parentAgentId: null,
        archivedAt: new Date("2026-07-25T00:00:00.000Z"),
      }),
    ).toEqual({ kind: "layout-only" });
    expect(resolveCloseAgentTabPolicy(null)).toEqual({ kind: "layout-only" });
    expect(resolveCloseAgentTabPolicy(undefined)).toEqual({ kind: "layout-only" });
  });
});

describe("executeCloseAgentTab", () => {
  function setup(
    agent: {
      parentAgentId: string | null;
      archivedAt: Date | null;
      status: "idle" | "running";
    } | null,
  ) {
    const confirmRunningArchive = vi.fn(async () => true);
    const archive = vi.fn(async () => undefined);
    const closeLayout = vi.fn();
    return {
      input: { agent, confirmRunningArchive, archive, closeLayout },
      confirmRunningArchive,
      archive,
      closeLayout,
    };
  }

  it("removes missing, archived, and subagent tabs without archive RPCs", async () => {
    for (const agent of [
      null,
      {
        parentAgentId: null,
        archivedAt: new Date("2026-07-25T00:00:00.000Z"),
        status: "idle" as const,
      },
      { parentAgentId: "root", archivedAt: null, status: "idle" as const },
    ]) {
      const harness = setup(agent);
      await expect(executeCloseAgentTab(harness.input)).resolves.toBe(true);
      expect(harness.archive).not.toHaveBeenCalled();
      expect(harness.closeLayout).toHaveBeenCalledOnce();
    }
  });

  it("archives a known root Agent before removing its layout", async () => {
    const harness = setup({ parentAgentId: null, archivedAt: null, status: "idle" });

    await expect(executeCloseAgentTab(harness.input)).resolves.toBe(true);

    expect(harness.archive).toHaveBeenCalledOnce();
    expect(harness.closeLayout).toHaveBeenCalledOnce();
    expect(harness.confirmRunningArchive).not.toHaveBeenCalled();
    expect(harness.archive.mock.invocationCallOrder[0]).toBeLessThan(
      harness.closeLayout.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps a known root Agent tab when archive fails", async () => {
    const harness = setup({ parentAgentId: null, archivedAt: null, status: "idle" });
    harness.archive.mockRejectedValueOnce(new Error("transport failed"));

    await expect(executeCloseAgentTab(harness.input)).rejects.toThrow("transport failed");

    expect(harness.closeLayout).not.toHaveBeenCalled();
  });

  it("keeps a running root Agent tab when archive confirmation is cancelled", async () => {
    const harness = setup({ parentAgentId: null, archivedAt: null, status: "running" });
    harness.confirmRunningArchive.mockResolvedValueOnce(false);

    await expect(executeCloseAgentTab(harness.input)).resolves.toBe(false);

    expect(harness.archive).not.toHaveBeenCalled();
    expect(harness.closeLayout).not.toHaveBeenCalled();
  });
});
