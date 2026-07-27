import { randomUUID } from "node:crypto";
import net from "node:net";

import type {
  CatalogRuntimeResourceLease,
  WorkspaceCatalogStore,
} from "./workspace-authority/catalog-store.js";
import { findFreePort } from "./service-proxy.js";

const RESOURCE_KIND = "workspace-service-port";
const DEFAULT_RESERVATION_TTL_MS = 10 * 60_000;
const DEFAULT_ACTIVE_TTL_MS = 90_000;
const MAX_DYNAMIC_PORT_ATTEMPTS = 32;
const PROCESS_RUNTIME_HOLDER_ID = `daemon-runtime-${process.pid}-${randomUUID()}`;

export interface WorkspaceServicePortDeclaration {
  scriptName: string;
  port?: number;
}

export interface WorkspaceServicePortLease {
  workspaceId: string;
  scriptName: string;
  port: number;
  declarationOrder: number;
  status: "reserved" | "active";
  generation: string;
}

export interface WorkspaceServicePortRegistryOptions {
  catalog: WorkspaceCatalogStore;
  holderId?: string;
  allocatePort?: () => Promise<number>;
  isPortAvailable?: (port: number) => Promise<boolean>;
  now?: () => Date;
  reservationTtlMs?: number;
  activeTtlMs?: number;
  heartbeatIntervalMs?: number;
}

export class WorkspaceServicePortRegistry {
  readonly heartbeatIntervalMs: number;
  private readonly catalog: WorkspaceCatalogStore;
  private readonly holderId: string;
  private readonly allocatePort: () => Promise<number>;
  private readonly isPortAvailable: (port: number) => Promise<boolean>;
  private readonly now: () => Date;
  private readonly reservationTtlMs: number;
  private readonly activeTtlMs: number;

  constructor(options: WorkspaceServicePortRegistryOptions) {
    this.catalog = options.catalog;
    this.holderId = options.holderId ?? PROCESS_RUNTIME_HOLDER_ID;
    this.allocatePort = options.allocatePort ?? findFreePort;
    this.isPortAvailable = options.isPortAvailable ?? isLoopbackPortAvailable;
    this.now = options.now ?? (() => new Date());
    this.reservationTtlMs = options.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS;
    this.activeTtlMs = options.activeTtlMs ?? DEFAULT_ACTIVE_TTL_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
  }

  async ensurePlan(options: {
    workspaceId: string;
    services: readonly WorkspaceServicePortDeclaration[];
  }): Promise<ReadonlyMap<string, WorkspaceServicePortLease>> {
    const persisted = this.catalog
      .listRuntimeResourceLeases(RESOURCE_KIND)
      .filter((lease) => lease.workspaceId === options.workspaceId);
    if (persisted.length > 0) {
      const recovered: WorkspaceServicePortLease[] = [];
      for (const lease of persisted) recovered.push(await this.recoverOrRenew(lease));
      const knownNames = new Set(recovered.map((lease) => lease.scriptName));
      let nextDeclarationOrder =
        Math.max(-1, ...recovered.map((lease) => lease.declarationOrder)) + 1;
      const added: WorkspaceServicePortLease[] = [];
      try {
        for (const service of options.services) {
          if (knownNames.has(service.scriptName)) continue;
          const lease = await this.reserve({
            workspaceId: options.workspaceId,
            service,
            declarationOrder: nextDeclarationOrder,
          });
          added.push(lease);
          knownNames.add(service.scriptName);
          nextDeclarationOrder += 1;
        }
        return planFromLeases([...recovered, ...added]);
      } catch (error) {
        for (const lease of added) this.release(lease);
        throw error;
      }
    }

    const reserved: WorkspaceServicePortLease[] = [];
    try {
      for (const [index, service] of options.services.entries()) {
        reserved.push(
          await this.reserve({
            workspaceId: options.workspaceId,
            service,
            declarationOrder: index,
          }),
        );
      }
      return planFromLeases(reserved);
    } catch (error) {
      for (const lease of reserved) this.release(lease);
      throw error;
    }
  }

  async refresh(options: {
    workspaceId: string;
    service: WorkspaceServicePortDeclaration;
  }): Promise<WorkspaceServicePortLease> {
    const existing = this.catalog.getRuntimeResourceLeaseByOwner({
      resourceKind: RESOURCE_KIND,
      workspaceId: options.workspaceId,
      ownerKey: options.service.scriptName,
    });
    if (existing?.holderId === this.holderId) {
      this.catalog.releaseRuntimeResource({
        resourceKind: RESOURCE_KIND,
        resourceKey: existing.resourceKey,
        workspaceId: existing.workspaceId,
        ownerKey: existing.ownerKey,
        holderId: existing.holderId,
        generation: existing.generation,
      });
    }
    return await this.reserve({
      workspaceId: options.workspaceId,
      service: options.service,
      declarationOrder: runtimeDeclarationOrder(existing),
    });
  }

  activate(lease: WorkspaceServicePortLease): boolean {
    const now = this.now();
    return this.catalog.updateRuntimeResourceLease({
      ...leaseIdentity(lease, this.holderId),
      fromStatuses: ["reserved", "active"],
      status: "active",
      expiresAt: expiry(now, this.activeTtlMs),
      updatedAt: now.toISOString(),
    });
  }

  renew(lease: WorkspaceServicePortLease): boolean {
    const now = this.now();
    return this.catalog.updateRuntimeResourceLease({
      ...leaseIdentity(lease, this.holderId),
      fromStatuses: ["active"],
      status: "active",
      expiresAt: expiry(now, this.activeTtlMs),
      updatedAt: now.toISOString(),
    });
  }

  release(lease: WorkspaceServicePortLease): boolean {
    return this.catalog.releaseRuntimeResource(leaseIdentity(lease, this.holderId));
  }

  private async reserve(input: {
    workspaceId: string;
    service: WorkspaceServicePortDeclaration;
    declarationOrder: number;
  }): Promise<WorkspaceServicePortLease> {
    assertDeclaration(input.service);
    const existing = this.catalog.getRuntimeResourceLeaseByOwner({
      resourceKind: RESOURCE_KIND,
      workspaceId: input.workspaceId,
      ownerKey: input.service.scriptName,
    });
    if (existing) {
      if (existing.holderId !== this.holderId) return await this.recoverOrRenew(existing);
      const existingPort = runtimePort(existing);
      if (input.service.port === undefined || input.service.port === existingPort) {
        return this.renewPersistedReservation(existing);
      }
      this.catalog.releaseRuntimeResource({
        resourceKind: RESOURCE_KIND,
        resourceKey: existing.resourceKey,
        workspaceId: existing.workspaceId,
        ownerKey: existing.ownerKey,
        holderId: existing.holderId,
        generation: existing.generation,
      });
    }

    const explicitPort = input.service.port;
    for (let attempt = 0; attempt < MAX_DYNAMIC_PORT_ATTEMPTS; attempt += 1) {
      const port = explicitPort ?? (await this.allocatePort());
      assertPort(port);
      const now = this.now();
      const generation = randomUUID();
      const inserted = this.catalog.tryReserveRuntimeResource({
        resourceKind: RESOURCE_KIND,
        resourceKey: String(port),
        workspaceId: input.workspaceId,
        ownerKey: input.service.scriptName,
        holderId: this.holderId,
        status: "reserved",
        generation,
        value: { port, declarationOrder: input.declarationOrder },
        expiresAt: expiry(now, this.reservationTtlMs),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      if (inserted) return toWorkspaceServicePortLease(inserted);

      const concurrent = this.catalog.getRuntimeResourceLeaseByOwner({
        resourceKind: RESOURCE_KIND,
        workspaceId: input.workspaceId,
        ownerKey: input.service.scriptName,
      });
      if (concurrent?.holderId === this.holderId) {
        return this.renewPersistedReservation(concurrent);
      }
      if (explicitPort !== undefined) {
        const conflict = this.catalog.getRuntimeResourceLeaseByKey({
          resourceKind: RESOURCE_KIND,
          resourceKey: String(port),
        });
        throw new Error(
          conflict
            ? `Port ${port} is already leased by Workspace ${conflict.workspaceId} service '${conflict.ownerKey}'`
            : `Port ${port} could not be reserved`,
        );
      }
    }
    throw new Error(
      `Unable to reserve a unique service port for Workspace ${input.workspaceId} service '${input.service.scriptName}'`,
    );
  }

  private async recoverOrRenew(
    persisted: CatalogRuntimeResourceLease,
  ): Promise<WorkspaceServicePortLease> {
    if (persisted.holderId === this.holderId) return this.renewPersistedReservation(persisted);
    const port = runtimePort(persisted);
    if (!(await this.isPortAvailable(port))) {
      throw new Error(
        `Port ${port} for Workspace ${persisted.workspaceId} service '${persisted.ownerKey}' is still held by a previous daemon runtime`,
      );
    }
    const now = this.now();
    const reclaimed = this.catalog.reclaimRuntimeResource({
      resourceKind: RESOURCE_KIND,
      resourceKey: persisted.resourceKey,
      workspaceId: persisted.workspaceId,
      ownerKey: persisted.ownerKey,
      expectedGeneration: persisted.generation,
      holderId: this.holderId,
      generation: randomUUID(),
      value: persisted.value,
      expiresAt: expiry(now, this.reservationTtlMs),
      updatedAt: now.toISOString(),
    });
    if (!reclaimed) {
      throw new Error(
        `Service port lease changed while recovering Workspace ${persisted.workspaceId} service '${persisted.ownerKey}'`,
      );
    }
    return toWorkspaceServicePortLease(reclaimed);
  }

  private renewPersistedReservation(
    persisted: CatalogRuntimeResourceLease,
  ): WorkspaceServicePortLease {
    const now = this.now();
    const updated = this.catalog.updateRuntimeResourceLease({
      resourceKind: RESOURCE_KIND,
      resourceKey: persisted.resourceKey,
      workspaceId: persisted.workspaceId,
      ownerKey: persisted.ownerKey,
      holderId: persisted.holderId,
      generation: persisted.generation,
      fromStatuses: [persisted.status],
      status: persisted.status,
      expiresAt: expiry(
        now,
        persisted.status === "active" ? this.activeTtlMs : this.reservationTtlMs,
      ),
      updatedAt: now.toISOString(),
    });
    if (!updated) {
      throw new Error(
        `Service port lease changed while renewing Workspace ${persisted.workspaceId} service '${persisted.ownerKey}'`,
      );
    }
    return toWorkspaceServicePortLease({
      ...persisted,
      expiresAt: expiry(
        now,
        persisted.status === "active" ? this.activeTtlMs : this.reservationTtlMs,
      ),
      updatedAt: now.toISOString(),
    });
  }
}

export function requirePlannedWorkspaceServicePort(
  plan: ReadonlyMap<string, WorkspaceServicePortLease>,
  scriptName: string,
): WorkspaceServicePortLease {
  const lease = plan.get(scriptName);
  if (!lease) {
    throw new Error(`Service '${scriptName}' is missing from workspace service port plan`);
  }
  return lease;
}

function planFromLeases(
  leases: readonly WorkspaceServicePortLease[],
): ReadonlyMap<string, WorkspaceServicePortLease> {
  return new Map(
    leases
      .toSorted(
        (left, right) =>
          left.declarationOrder - right.declarationOrder ||
          left.scriptName.localeCompare(right.scriptName),
      )
      .map((lease) => [lease.scriptName, { ...lease }]),
  );
}

function leaseIdentity(lease: WorkspaceServicePortLease, holderId: string) {
  return {
    resourceKind: RESOURCE_KIND,
    resourceKey: String(lease.port),
    workspaceId: lease.workspaceId,
    ownerKey: lease.scriptName,
    holderId,
    generation: lease.generation,
  };
}

function toWorkspaceServicePortLease(
  lease: CatalogRuntimeResourceLease,
): WorkspaceServicePortLease {
  return {
    workspaceId: lease.workspaceId,
    scriptName: lease.ownerKey,
    port: runtimePort(lease),
    declarationOrder: runtimeDeclarationOrder(lease),
    status: lease.status,
    generation: lease.generation,
  };
}

function runtimePort(lease: CatalogRuntimeResourceLease): number {
  const port = lease.value.port;
  if (typeof port !== "number") {
    throw new Error(`Persisted service port lease '${lease.resourceKey}' has no numeric port`);
  }
  assertPort(port);
  if (String(port) !== lease.resourceKey) {
    throw new Error(
      `Persisted service port lease key '${lease.resourceKey}' does not match ${port}`,
    );
  }
  return port;
}

function runtimeDeclarationOrder(lease: CatalogRuntimeResourceLease | null): number {
  return typeof lease?.value.declarationOrder === "number" ? lease.value.declarationOrder : 0;
}

function assertDeclaration(service: WorkspaceServicePortDeclaration): void {
  if (!service.scriptName.trim()) throw new Error("Workspace service script name is required");
  if (service.port !== undefined) assertPort(service.port);
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid Workspace service port: ${String(port)}`);
  }
}

function expiry(now: Date, ttlMs: number): string {
  return new Date(now.getTime() + ttlMs).toISOString();
}

function isLoopbackPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}
