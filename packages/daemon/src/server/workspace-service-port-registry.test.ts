import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceAuthorityManager } from "./workspace-authority/index.js";
import {
  WorkspaceServicePortRegistry,
  requirePlannedWorkspaceServicePort,
} from "./workspace-service-port-registry.js";

const roots: string[] = [];
const managers: WorkspaceAuthorityManager[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("WorkspaceServicePortRegistry", () => {
  it("persists a defensive declaration-order plan and reconciles newly declared services", async () => {
    const manager = authorityManager();
    let allocationCount = 0;
    const registry = registryFor(manager, {
      holderId: "daemon-a",
      allocatePort: async () => 4100 + allocationCount++,
    });

    const first = await registry.ensurePlan({
      workspaceId: "workspace-a",
      services: [{ scriptName: "api" }, { scriptName: "web" }, { scriptName: "worker" }],
    });
    const second = await registry.ensurePlan({
      workspaceId: "workspace-a",
      services: [{ scriptName: "new-service" }],
    });

    expect(Array.from(first, ([name, lease]) => [name, lease.port])).toEqual([
      ["api", 4100],
      ["web", 4101],
      ["worker", 4102],
    ]);
    expect(Array.from(second, ([name, lease]) => [name, lease.port])).toEqual([
      ...Array.from(first, ([name, lease]) => [name, lease.port]),
      ["new-service", 4103],
    ]);
    expect(first).not.toBe(second);
    expect(allocationCount).toBe(4);
  });

  it("enforces cross-Workspace uniqueness when concurrent allocators nominate the same port", async () => {
    const manager = authorityManager();
    const candidates = [4200, 4200, 4201];
    const registry = registryFor(manager, {
      holderId: "daemon-a",
      allocatePort: async () => candidates.shift() ?? 4202,
    });

    const [left, right] = await Promise.all([
      registry.ensurePlan({ workspaceId: "workspace-left", services: [{ scriptName: "api" }] }),
      registry.ensurePlan({ workspaceId: "workspace-right", services: [{ scriptName: "api" }] }),
    ]);

    expect(requirePlannedWorkspaceServicePort(left, "api").port).toBe(4200);
    expect(requirePlannedWorkspaceServicePort(right, "api").port).toBe(4201);
  });

  it("rejects an explicit port already leased by another Workspace", async () => {
    const manager = authorityManager();
    const registry = registryFor(manager, { holderId: "daemon-a" });
    await registry.ensurePlan({
      workspaceId: "workspace-left",
      services: [{ scriptName: "api", port: 4300 }],
    });

    await expect(
      registry.ensurePlan({
        workspaceId: "workspace-right",
        services: [{ scriptName: "web", port: 4300 }],
      }),
    ).rejects.toThrow("Port 4300 is already leased");
  });

  it("fences reserve, activate, heartbeat and release by lease generation", async () => {
    const manager = authorityManager();
    let nowMs = Date.parse("2026-07-27T00:00:00.000Z");
    const registry = registryFor(manager, {
      holderId: "daemon-a",
      now: () => new Date(nowMs),
      allocatePort: async () => 4400,
    });
    const plan = await registry.ensurePlan({
      workspaceId: "workspace-a",
      services: [{ scriptName: "api" }],
    });
    const lease = requirePlannedWorkspaceServicePort(plan, "api");

    expect(lease.status).toBe("reserved");
    expect(registry.activate(lease)).toBe(true);
    nowMs += 30_000;
    expect(registry.renew({ ...lease, generation: "stale-generation" })).toBe(false);
    expect(registry.renew(lease)).toBe(true);
    expect(registry.release({ ...lease, generation: "stale-generation" })).toBe(false);
    expect(registry.release(lease)).toBe(true);
    expect(manager.catalog.listRuntimeResourceLeases("workspace-service-port")).toEqual([]);
  });

  it("reclaims a free persisted lease after restart and rejects the stale holder", async () => {
    const home = temporaryHome();
    const firstManager = new WorkspaceAuthorityManager(home);
    managers.push(firstManager);
    const firstRegistry = registryFor(firstManager, {
      holderId: "daemon-before-restart",
      allocatePort: async () => 4500,
    });
    const firstLease = requirePlannedWorkspaceServicePort(
      await firstRegistry.ensurePlan({
        workspaceId: "workspace-a",
        services: [{ scriptName: "api" }],
      }),
      "api",
    );
    expect(firstRegistry.activate(firstLease)).toBe(true);
    firstManager.close();
    managers.splice(managers.indexOf(firstManager), 1);

    const secondManager = new WorkspaceAuthorityManager(home);
    managers.push(secondManager);
    const secondRegistry = registryFor(secondManager, {
      holderId: "daemon-after-restart",
      isPortAvailable: async () => true,
      allocatePort: async () => {
        throw new Error("Restart recovery must reuse the persisted port");
      },
    });
    const recovered = requirePlannedWorkspaceServicePort(
      await secondRegistry.ensurePlan({
        workspaceId: "workspace-a",
        services: [{ scriptName: "api" }],
      }),
      "api",
    );

    expect(recovered.port).toBe(4500);
    expect(recovered.generation).not.toBe(firstLease.generation);
    const staleHolder = registryFor(secondManager, { holderId: "daemon-before-restart" });
    expect(staleHolder.release(firstLease)).toBe(false);
    expect(secondRegistry.activate(recovered)).toBe(true);
  });

  it("does not take over a persisted port that is still bound by the previous runtime", async () => {
    const manager = authorityManager();
    const firstRegistry = registryFor(manager, {
      holderId: "daemon-before-crash",
      allocatePort: async () => 4600,
    });
    const firstLease = requirePlannedWorkspaceServicePort(
      await firstRegistry.ensurePlan({
        workspaceId: "workspace-a",
        services: [{ scriptName: "api" }],
      }),
      "api",
    );
    expect(firstRegistry.activate(firstLease)).toBe(true);

    const restarted = registryFor(manager, {
      holderId: "daemon-after-crash",
      isPortAvailable: async () => false,
    });
    await expect(
      restarted.ensurePlan({
        workspaceId: "workspace-a",
        services: [{ scriptName: "api" }],
      }),
    ).rejects.toThrow("still held by a previous daemon runtime");
  });

  it("refreshes only the stopped service and releases the replaced reservation", async () => {
    const manager = authorityManager();
    const candidates = [4700, 4701, 4800];
    const registry = registryFor(manager, {
      holderId: "daemon-a",
      allocatePort: async () => candidates.shift()!,
    });
    const first = await registry.ensurePlan({
      workspaceId: "workspace-a",
      services: [{ scriptName: "api" }, { scriptName: "web" }],
    });
    const oldApi = requirePlannedWorkspaceServicePort(first, "api");
    const refreshed = await registry.refresh({
      workspaceId: "workspace-a",
      service: { scriptName: "api" },
    });

    expect(refreshed.port).toBe(4800);
    expect(refreshed.generation).not.toBe(oldApi.generation);
    expect(registry.activate(oldApi)).toBe(false);
    const leases = manager.catalog.listRuntimeResourceLeases("workspace-service-port");
    expect(leases.map((lease) => Number(lease.resourceKey)).toSorted()).toEqual([4701, 4800]);
  });
});

function authorityManager(): WorkspaceAuthorityManager {
  const manager = new WorkspaceAuthorityManager(temporaryHome());
  managers.push(manager);
  return manager;
}

function temporaryHome(): string {
  const root = mkdtempSync(path.join(tmpdir(), "thoth-service-port-registry-"));
  roots.push(root);
  return path.join(root, ".thoth");
}

function registryFor(
  manager: WorkspaceAuthorityManager,
  options: Partial<ConstructorParameters<typeof WorkspaceServicePortRegistry>[0]> = {},
): WorkspaceServicePortRegistry {
  return new WorkspaceServicePortRegistry({
    catalog: manager.catalog,
    holderId: "daemon-test",
    allocatePort: async () => 49_000,
    isPortAvailable: async () => true,
    ...options,
  });
}
