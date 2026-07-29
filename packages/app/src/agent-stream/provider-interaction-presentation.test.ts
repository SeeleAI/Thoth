import { describe, expect, it } from "vitest";
import type { AgentPermissionRequest } from "@thoth/protocol/agent-types";
import {
  filterVisibleProviderPermissions,
  isDaemonProviderPlanPermission,
} from "./provider-interaction-presentation";

function permission(
  id: string,
  kind: AgentPermissionRequest["kind"],
  metadata?: Record<string, unknown>,
) {
  return { key: id, request: { id, provider: "codex", name: id, kind, metadata } };
}

describe("Provider interaction presentation", () => {
  it("shows only Daemon-owned completed Plan approval as a Plan action", () => {
    const daemonPlan = permission("daemon-plan", "plan", {
      owner: "thoth-daemon",
      authority: "provider-plan",
    });
    const driverPlan = permission("driver-plan", "plan", { source: "synthetic" });
    expect(isDaemonProviderPlanPermission(daemonPlan.request)).toBe(true);
    expect(isDaemonProviderPlanPermission(driverPlan.request)).toBe(false);
    expect(filterVisibleProviderPermissions([daemonPlan, driverPlan], false)).toEqual([daemonPlan]);
  });

  it("hides Implement while a Provider question is pending but keeps ordinary permissions", () => {
    const tool = permission("tool", "tool");
    const daemonPlan = permission("daemon-plan", "plan", {
      owner: "thoth-daemon",
      authority: "provider-plan",
    });
    expect(filterVisibleProviderPermissions([tool, daemonPlan], true)).toEqual([tool]);
  });
});
