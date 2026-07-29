import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DaemonClient,
  ConnectionState,
  FetchAgentsEntry,
  FetchAgentsOptions,
} from "@thoth/client/internal/daemon-client";
import type { ConnectionOffer } from "@thoth/protocol/connection-offer";
import type { HostConnection, HostProfile } from "@/types/host-connection";
import {
  AuthorityProjectionStore,
  DaemonProjectionService,
} from "@/projection/authority-projection";
import {
  HostRuntimeController,
  HostRuntimeStore,
  readInitialDaemonConnectionHint,
  type HostRuntimeControllerDeps,
  type HostRuntimeStorage,
} from "./host-runtime";

class FakeDaemonClient {
  private state: ConnectionState = { status: "idle" };
  private listeners = new Set<(status: ConnectionState) => void>();
  private eventListeners = new Map<string, Set<(message: { payload: unknown }) => void>>();
  private error: string | null = null;
  private heartbeatRttMs: number | null = null;
  private latencyMeasurementFailure: Error | null = null;
  private latencyMeasurementsRequested: Array<{ timeoutMs?: number }> = [];
  private serverInfo: ReturnType<DaemonClient["getLastServerInfoMessage"]> = null;
  public connectCalls = 0;
  public fetchAgentsCalls: FetchAgentsOptions[] = [];
  public fetchAgentsResponses: Awaited<ReturnType<DaemonClient["fetchAgents"]>>[] = [];

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.setConnectionState({ status: "connected" });
  }

  async close(): Promise<void> {
    this.setConnectionState({ status: "disconnected", reason: "client_closed" });
  }

  ensureConnected(): void {
    if (this.state.status !== "connected") {
      this.setConnectionState({ status: "connected" });
    }
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  getLastServerInfoMessage(): ReturnType<DaemonClient["getLastServerInfoMessage"]> {
    return this.serverInfo;
  }

  setServerInfo(serverInfo: ReturnType<DaemonClient["getLastServerInfoMessage"]>): void {
    this.serverInfo = serverInfo;
  }

  subscribeAgentThothStateUpdates(): () => void {
    return () => {};
  }

  on(type: string, listener: (message: { payload: never }) => void): () => void {
    const listeners = this.eventListeners.get(type) ?? new Set();
    listeners.add(listener as (message: { payload: unknown }) => void);
    this.eventListeners.set(type, listeners);
    return () => listeners.delete(listener as (message: { payload: unknown }) => void);
  }

  emitStatus(payload: ReturnType<DaemonClient["getLastServerInfoMessage"]>): void {
    if (!payload) return;
    for (const listener of this.eventListeners.get("status") ?? []) listener({ payload });
  }

  subscribeConnectionStatus(listener: (status: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get lastError(): string | null {
    return this.error;
  }

  async fetchAgents(
    options?: FetchAgentsOptions,
  ): Promise<Awaited<ReturnType<DaemonClient["fetchAgents"]>>> {
    this.fetchAgentsCalls.push(options ?? {});
    const queued = this.fetchAgentsResponses.shift();
    if (queued) {
      return queued;
    }
    return makeFetchAgentsPayload({
      entries: [],
      subscriptionId: options?.subscribe?.subscriptionId ?? undefined,
    });
  }

  async ping(): Promise<{ rttMs: number }> {
    return { rttMs: 0 };
  }

  async measureLatency(params?: { timeoutMs?: number }): Promise<number> {
    this.latencyMeasurementsRequested.push(params ?? {});
    if (this.latencyMeasurementFailure) {
      throw this.latencyMeasurementFailure;
    }
    const result = await this.ping();
    return result.rttMs;
  }

  setReconnectEnabled(_enabled: boolean): void {}

  getLastLivenessRttMs(): number | null {
    return this.heartbeatRttMs;
  }

  heartbeatReportsRtt(rttMs: number | null): void {
    this.heartbeatRttMs = rttMs;
  }

  latencyMeasurementsFailWith(message: string): void {
    this.latencyMeasurementFailure = new Error(message);
  }

  latencyMeasurements(): Array<{ timeoutMs?: number }> {
    return this.latencyMeasurementsRequested;
  }

  clearLatencyMeasurements(): void {
    this.latencyMeasurementsRequested = [];
  }

  isDisposed(): boolean {
    return this.state.status === "disconnected" && this.state.reason === "client_closed";
  }

  setConnectionState(next: ConnectionState): void {
    this.state = next;
    if (next.status === "disconnected") {
      this.error = next.reason ?? this.error;
    }
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).__THOTH_INITIAL_DAEMON_CONNECTION__;
  delete (globalThis as { window?: unknown }).window;
});

function useHostRuntimeClock(): void {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
}

function makeFetchAgentsPayload(input: {
  entries: FetchAgentsEntry[];
  hasMore?: boolean;
  nextCursor?: string | null;
  subscriptionId?: string;
}): Awaited<ReturnType<DaemonClient["fetchAgents"]>> {
  return {
    entries: input.entries,
    pageInfo: {
      nextCursor: input.nextCursor ?? null,
      prevCursor: null,
      hasMore: input.hasMore ?? false,
    } as Awaited<ReturnType<DaemonClient["fetchAgents"]>>["pageInfo"],
    ...(input.subscriptionId ? { subscriptionId: input.subscriptionId } : {}),
    requestId: "req_test",
  };
}

function makeFetchAgentsEntry(input: {
  id: string;
  cwd: string;
  updatedAt: string;
  title?: string | null;
  requiresAttention?: boolean;
  attentionReason?: "permission" | "error" | null;
  archivedAt?: string | null;
}): FetchAgentsEntry {
  return {
    agent: {
      id: input.id,
      provider: "codex",
      status: "idle",
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
      lastUserMessageAt: null,
      lastError: undefined,
      runtimeInfo: {
        provider: "codex",
        sessionId: null,
      },
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      pendingProviderQuestions: [],
      persistence: null,
      title: input.title ?? null,
      cwd: input.cwd,
      model: null,
      thinkingOptionId: null,
      requiresAttention: input.requiresAttention ?? false,
      attentionReason: input.attentionReason ?? null,
      attentionTimestamp: input.requiresAttention && input.attentionReason ? input.updatedAt : null,
      archivedAt: input.archivedAt ?? null,
      labels: {},
    },
    project: {
      projectKey: input.cwd,
      projectName: "workspace",
      checkout: {
        cwd: input.cwd,
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isThothOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  };
}

function makeHost(input?: Partial<HostProfile>): HostProfile {
  const direct: HostConnection = {
    id: "direct:lan:6767",
    type: "directTcp",
    endpoint: "lan:6767",
  };
  const relay: HostConnection = {
    id: "relay:relay.thoth.seeles.ai:443",
    type: "relay",
    relayEndpoint: "relay.thoth.seeles.ai:443",
    daemonPublicKeyB64: "pk_test",
    relayToken: "rdt_valid",
    relayTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  };

  return {
    serverId: input?.serverId ?? "srv_test",
    label: input?.label ?? "test host",
    lifecycle: input?.lifecycle ?? {},
    connections: input?.connections ?? [direct, relay],
    preferredConnectionId: input?.preferredConnectionId ?? direct.id,
    createdAt: input?.createdAt ?? new Date(0).toISOString(),
    updatedAt: input?.updatedAt ?? new Date(0).toISOString(),
  };
}

function makeOffer(input?: Partial<ConnectionOffer>): ConnectionOffer {
  return {
    v: 3,
    serverId: input?.serverId ?? "srv_offer",
    daemonPublicKeyB64: input?.daemonPublicKeyB64 ?? "pk_test_offer",
    relay: {
      endpoint: input?.relay?.endpoint ?? "relay.thoth.seeles.ai:443",
      useTls: input?.relay?.useTls ?? false,
      protocolVersion: 3,
    },
    pairingToken: input?.pairingToken ?? "rpt_valid_pairing_token_abcdefghijklmnopqrstuvwxyz",
    pairingExpiresAt: input?.pairingExpiresAt ?? "2099-01-01T00:00:00.000Z",
  };
}

function encodeOfferUrl(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `https://app.thoth.seeles.ai/#offer=${encoded}`;
}

function makeDeps(
  latencyByConnectionId: Record<string, number | Error>,
  createdClients: FakeDaemonClient[],
): HostRuntimeControllerDeps {
  return {
    createClient: () => {
      const client = new FakeDaemonClient();
      createdClients.push(client);
      return client as unknown as DaemonClient;
    },
    connectToDaemon: async ({ host, connection }) => {
      const readLatency = (): number => {
        const value = latencyByConnectionId[connection.id];
        if (value instanceof Error) {
          throw value;
        }
        if (typeof value !== "number") {
          throw new Error(`missing latency for ${connection.id}`);
        }
        return value;
      };
      readLatency();
      const client = new FakeDaemonClient();
      client.connectCalls = 1;
      client.setConnectionState({ status: "connected" });
      client.ping = async () => ({ rttMs: readLatency() });
      createdClients.push(client);
      return {
        client: client as unknown as DaemonClient,
        serverId: host.serverId,
        hostname: host.label ?? null,
      };
    },
    getClientId: async () => "cid_test_runtime",
  };
}

function createDeferred<T>() {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve: (value: T | PromiseLike<T>) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
}

function makeConnectedProbeClient(latencyMs: number): FakeDaemonClient {
  const client = new FakeDaemonClient();
  client.connectCalls = 1;
  client.setConnectionState({ status: "connected" });
  client.ping = async () => ({ rttMs: latencyMs });
  return client;
}

function createMemoryHostRuntimeStorage(entries: Record<string, string> = {}): HostRuntimeStorage {
  const values = new Map(Object.entries(entries));
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
}

function onceHostListMatches(store: HostRuntimeStore, predicate: () => boolean): Promise<void> {
  if (predicate()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let unsubscribe = (): void => {};
    unsubscribe = store.subscribeHostList(() => {
      if (!predicate()) {
        return;
      }
      unsubscribe();
      resolve();
    });
  });
}

describe("HostRuntimeController", () => {
  it("replaces the active relay client when re-pairing changes the daemon public key", async () => {
    const oldRelay: HostConnection = {
      id: "relay:wss:relay.thoth.seeles.ai:443",
      type: "relay",
      relayEndpoint: "relay.thoth.seeles.ai:443",
      useTls: true,
      daemonPublicKeyB64: "pk_old",
      relayToken: "rdt_valid",
      relayTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    };
    const newRelay: HostConnection = {
      ...oldRelay,
      daemonPublicKeyB64: "pk_new",
    };
    const createdClients: Array<{ client: FakeDaemonClient; connection: HostConnection }> = [];
    const controller = new HostRuntimeController({
      host: makeHost({
        connections: [oldRelay],
        preferredConnectionId: oldRelay.id,
      }),
      deps: {
        createClient: ({ connection }) => {
          const client = new FakeDaemonClient();
          createdClients.push({ client, connection });
          return client as unknown as DaemonClient;
        },
        connectToDaemon: async ({ host, connection }) => ({
          client: makeConnectedProbeClient(5) as unknown as DaemonClient,
          serverId: host.serverId,
          hostname: connection.id,
        }),
        getClientId: async () => "cid_test_runtime",
      },
    });

    await controller.activateConnection({ connectionId: oldRelay.id });
    expect(controller.getSnapshot().client).toBe(createdClients[0]?.client);

    await controller.updateHost(
      makeHost({
        connections: [newRelay],
        preferredConnectionId: newRelay.id,
      }),
    );

    expect(createdClients.map((entry) => entry.connection)).toEqual([oldRelay, newRelay]);
    expect(createdClients[0]?.client.isDisposed()).toBe(true);
    expect(controller.getSnapshot().client).toBe(createdClients[1]?.client);
  });

  it("keeps known hosts in connecting when a created client reports idle during connect", async () => {
    const host = makeHost({
      connections: [
        {
          id: "direct:lan:6767",
          type: "directTcp",
          endpoint: "lan:6767",
        },
      ],
    });
    const idleClient = new FakeDaemonClient();
    const deps: HostRuntimeControllerDeps = {
      createClient: () => idleClient as unknown as DaemonClient,
      connectToDaemon: async () => {
        throw new Error("probe unavailable");
      },
      getClientId: async () => "cid_test_runtime",
    };
    const controller = new HostRuntimeController({
      host,
      deps,
    });

    idleClient.connect = async () => {
      idleClient.connectCalls += 1;
      // Intentionally do not emit a connected state; stay in idle.
    };

    await controller.activateConnection({ connectionId: "direct:lan:6767" });

    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");
    expect(controller.getSnapshot().connectionStatus).toBe("connecting");
    expect(controller.getSnapshot()).not.toHaveProperty("agentDirectoryStatus");
  });

  it("passes resolved client id into created active clients", async () => {
    const host = makeHost({
      connections: [
        {
          id: "direct:lan:6767",
          type: "directTcp",
          endpoint: "lan:6767",
        },
      ],
    });
    const seenClientIds: string[] = [];
    const fakeClient = new FakeDaemonClient();
    const controller = new HostRuntimeController({
      host,
      deps: {
        createClient: ({ clientId }) => {
          seenClientIds.push(clientId);
          return fakeClient as unknown as DaemonClient;
        },
        connectToDaemon: async () => {
          throw new Error("probe unavailable");
        },
        getClientId: async () => "cid_runtime_stable",
      },
    });

    await controller.activateConnection({ connectionId: "direct:lan:6767" });

    expect(seenClientIds).toEqual(["cid_runtime_stable"]);
    expect(controller.getSnapshot().connectionStatus).toBe("online");
  });

  it("owns the active client's initial server info snapshot", async () => {
    const host = makeHost({
      connections: [{ id: "direct:lan:6767", type: "directTcp", endpoint: "lan:6767" }],
    });
    const client = new FakeDaemonClient();
    client.setServerInfo({
      status: "server_info",
      serverId: host.serverId,
      hostname: "runtime-host",
      version: "0.2.0",
      capabilities: {},
      features: { projectAdd: true },
    });
    const controller = new HostRuntimeController({
      host,
      deps: {
        createClient: () => client as unknown as DaemonClient,
        connectToDaemon: async () => {
          throw new Error("probe unavailable");
        },
        getClientId: async () => "cid_server_info",
      },
    });

    await controller.activateConnection({ connectionId: "direct:lan:6767" });

    expect(controller.getSnapshot().serverInfo).toEqual({
      serverId: host.serverId,
      hostname: "runtime-host",
      version: "0.2.0",
      capabilities: {},
      features: { projectAdd: true },
    });
  });

  it("updates server info only from the active client's status event", async () => {
    const host = makeHost({
      connections: [{ id: "direct:lan:6767", type: "directTcp", endpoint: "lan:6767" }],
    });
    const client = new FakeDaemonClient();
    const controller = new HostRuntimeController({
      host,
      deps: {
        createClient: () => client as unknown as DaemonClient,
        connectToDaemon: async () => {
          throw new Error("probe unavailable");
        },
        getClientId: async () => "cid_server_info_event",
      },
    });
    await controller.activateConnection({ connectionId: "direct:lan:6767" });

    client.emitStatus({
      status: "server_info",
      serverId: host.serverId,
      hostname: "updated-host",
      version: "0.2.1",
      capabilities: {},
      features: { projectAdd: false },
    });

    expect(controller.getSnapshot().serverInfo).toEqual(
      expect.objectContaining({
        serverId: host.serverId,
        hostname: "updated-host",
        version: "0.2.1",
        features: { projectAdd: false },
      }),
    );
  });

  it("reconciles the HostRuntime server id without duplicating server info", () => {
    const host = makeHost();
    const controller = new HostRuntimeController({
      host,
      deps: makeDeps({}, []),
    });
    (
      controller as unknown as {
        updateSnapshot: (patch: {
          serverInfo: ReturnType<typeof controller.getSnapshot>["serverInfo"];
        }) => void;
      }
    ).updateSnapshot({
      serverInfo: {
        serverId: host.serverId,
        hostname: "runtime-host",
        version: "0.2.0",
        capabilities: {},
        features: {},
      },
    });

    controller.adoptReconciledServerId("srv_reconciled");

    expect(controller.getSnapshot().serverId).toBe("srv_reconciled");
    expect(controller.getSnapshot().serverInfo).toEqual(
      expect.objectContaining({ serverId: "srv_reconciled", hostname: "runtime-host" }),
    );
  });

  it("adopts the first successful probe on startup", async () => {
    const host = makeHost({ preferredConnectionId: "direct:lan:6767" });
    const clients: FakeDaemonClient[] = [];
    const latencies: Record<string, number | Error> = {
      "direct:lan:6767": 82,
      "relay:relay.thoth.seeles.ai:443": 18,
    };
    const controller = new HostRuntimeController({
      host,
      deps: makeDeps(latencies, clients),
    });

    await controller.start({ autoProbe: false });

    const snapshot = controller.getSnapshot();
    expect(snapshot.activeConnectionId).toBe("direct:lan:6767");
    expect(snapshot.connectionStatus).toBe("online");
    expect(clients).toHaveLength(2);
    expect(snapshot.client).toBe(clients[0] as unknown as DaemonClient);
    expect(clients[0]?.connectCalls).toBe(1);
    expect(clients[1]?.isDisposed()).toBe(true);
  });

  it("activates the first successful probe without waiting for slower probes", async () => {
    const host = makeHost({ preferredConnectionId: "direct:lan:6767" });
    const slowPing = createDeferred<number>();
    const clients: FakeDaemonClient[] = [];

    const controller = new HostRuntimeController({
      host,
      deps: {
        createClient: () => {
          throw new Error("should adopt the probe client");
        },
        connectToDaemon: async ({ host: hostProfile, connection }) => {
          const client = makeConnectedProbeClient(connection.id === "direct:lan:6767" ? 12 : 30);
          if (connection.id === "relay:relay.thoth.seeles.ai:443") {
            client.ping = async () => ({ rttMs: await slowPing.promise });
          }
          clients.push(client);
          return {
            client: client as unknown as DaemonClient,
            serverId: hostProfile.serverId,
            hostname: hostProfile.label ?? null,
          };
        },
        getClientId: async () => "cid_test_runtime",
      },
    });

    const probeCycle = controller.runProbeCycleNow();

    const timeoutAt = Date.now() + 200;
    while (Date.now() < timeoutAt) {
      const snapshot = controller.getSnapshot();
      if (
        snapshot.activeConnectionId === "direct:lan:6767" &&
        snapshot.connectionStatus === "online"
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");
    expect(controller.getSnapshot().connectionStatus).toBe("online");

    slowPing.resolve(30);
    await probeCycle;
  });

  it("ranks the live connection by its heartbeat RTT without pinging it again", async () => {
    useHostRuntimeClock();
    const host = makeHost({ preferredConnectionId: "direct:lan:6767" });
    const probeAttempts: string[] = [];
    const latencies: Record<string, number | Error> = {
      "direct:lan:6767": 12,
      "relay:relay.thoth.seeles.ai:443": 65,
    };
    const controller = new HostRuntimeController({
      host,
      deps: {
        createClient: () => {
          throw new Error("should adopt probe clients");
        },
        connectToDaemon: async ({ host: hostProfile, connection }) => {
          probeAttempts.push(connection.id);
          const value = latencies[connection.id];
          if (value instanceof Error) {
            throw value;
          }
          if (typeof value !== "number") {
            throw new Error(`missing latency for ${connection.id}`);
          }
          return {
            client: makeConnectedProbeClient(value) as unknown as DaemonClient,
            serverId: hostProfile.serverId,
            hostname: hostProfile.label ?? null,
          };
        },
        getClientId: async () => "cid_test_runtime",
      },
    });

    await controller.start({ autoProbe: false });
    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");

    probeAttempts.length = 0;
    const activeClient = controller.getSnapshot().client as unknown as FakeDaemonClient;
    activeClient.heartbeatReportsRtt(42);
    activeClient.clearLatencyMeasurements();
    activeClient.ping = async () => ({ rttMs: 9 });
    await vi.advanceTimersByTimeAsync(10_000);
    await controller.runProbeCycleNow();

    expect(probeAttempts).toEqual([]);
    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");
    expect(controller.getSnapshot().connectionStatus).toBe("online");
    expect(controller.getSnapshot().probeByConnectionId.get("direct:lan:6767")).toEqual({
      status: "available",
      latencyMs: 42,
    });
    expect(activeClient.latencyMeasurements()).toEqual([]);
  });

  it("rejects probes that resolve to a different server id", async () => {
    const host = makeHost({
      serverId: "srv_old",
      connections: [
        {
          id: "direct:localhost:6767",
          type: "directTcp",
          endpoint: "localhost:6767",
        },
      ],
    });
    const mismatchedClient = makeConnectedProbeClient(8);
    const controller = new HostRuntimeController({
      host,
      deps: {
        createClient: () => {
          throw new Error("should not create active client");
        },
        connectToDaemon: async () => ({
          client: mismatchedClient as unknown as DaemonClient,
          serverId: "srv_current",
          hostname: "current host",
        }),
        getClientId: async () => "cid_test_runtime",
      },
    });

    await controller.start({ autoProbe: false });

    expect(controller.getSnapshot().connectionStatus).toBe("connecting");
    expect(controller.getSnapshot().activeConnectionId).toBeNull();
    expect(controller.getSnapshot().probeByConnectionId.get("direct:localhost:6767")).toEqual({
      status: "unavailable",
      latencyMs: null,
    });
    expect(mismatchedClient.isDisposed()).toBe(true);
  });

  it("keeps the live connection when one probe cycle looks slow", async () => {
    useHostRuntimeClock();
    const host = makeHost({ preferredConnectionId: "direct:lan:6767" });
    const clients: FakeDaemonClient[] = [];
    const latencies: Record<string, number | Error> = {
      "direct:lan:6767": 15,
      "relay:relay.thoth.seeles.ai:443": 55,
    };
    const controller = new HostRuntimeController({
      host,
      deps: makeDeps(latencies, clients),
    });

    await controller.start({ autoProbe: false });
    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");
    const initialClient = controller.getSnapshot().client;
    expect(initialClient).toBeTruthy();

    const activeClient = initialClient as unknown as FakeDaemonClient;
    activeClient.heartbeatReportsRtt(200);
    activeClient.latencyMeasurementsFailWith("active measurement failed");
    latencies["relay:relay.thoth.seeles.ai:443"] = 42;
    await vi.advanceTimersByTimeAsync(120_000);
    await controller.runProbeCycleNow();

    const snapshot = controller.getSnapshot();
    expect(snapshot.activeConnectionId).toBe("direct:lan:6767");
    expect(snapshot.connectionStatus).toBe("online");
    expect(snapshot.client).toBe(initialClient);
    expect(activeClient.isDisposed()).toBe(false);
  });

  it("does not mark the live connection unavailable before its first heartbeat resolves", async () => {
    useHostRuntimeClock();
    const direct: HostConnection = {
      id: "direct:lan:6767",
      type: "directTcp",
      endpoint: "lan:6767",
    };
    const host = makeHost({
      connections: [direct],
      preferredConnectionId: direct.id,
    });
    const activeClient = new FakeDaemonClient();
    activeClient.setConnectionState({ status: "connected" });
    activeClient.latencyMeasurementsFailWith("heartbeat has not resolved");
    const controller = new HostRuntimeController({
      host,
      deps: makeDeps({ [direct.id]: 12 }, []),
    });

    await controller.start({
      autoProbe: false,
      initialConnection: {
        connectionId: direct.id,
        existingClient: activeClient as unknown as DaemonClient,
      },
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot.activeConnectionId).toBe(direct.id);
    expect(snapshot.connectionStatus).toBe("online");
    expect(snapshot.probeByConnectionId.get(direct.id)).toEqual({
      status: "pending",
      latencyMs: null,
    });
  });

  it("backs off inactive connection probes while a host is online", async () => {
    useHostRuntimeClock();
    const host = makeHost({ preferredConnectionId: "direct:lan:6767" });
    const clients: FakeDaemonClient[] = [];
    const latencies: Record<string, number | Error> = {
      "direct:lan:6767": 10,
      "relay:relay.thoth.seeles.ai:443": 50,
    };
    const controller = new HostRuntimeController({
      host,
      deps: makeDeps(latencies, clients),
    });

    await controller.start({ autoProbe: false });
    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");
    const activeClient = controller.getSnapshot().client as unknown as FakeDaemonClient;
    const initialClientCount = clients.length;
    const initialRelayProbe = controller
      .getSnapshot()
      .probeByConnectionId.get("relay:relay.thoth.seeles.ai:443");

    latencies["direct:lan:6767"] = 12;
    latencies["relay:relay.thoth.seeles.ai:443"] = 25;
    activeClient.heartbeatReportsRtt(12);
    await vi.advanceTimersByTimeAsync(60_000);

    await controller.runProbeCycleNow();

    const snapshot = controller.getSnapshot();
    expect(clients.length).toBe(initialClientCount);
    expect(snapshot.probeByConnectionId.get("direct:lan:6767")).toEqual({
      status: "available",
      latencyMs: 12,
    });
    expect(snapshot.probeByConnectionId.get("relay:relay.thoth.seeles.ai:443")).toEqual(
      initialRelayProbe,
    );
  });

  it("switches only after the faster alternative wins consecutive probes", async () => {
    useHostRuntimeClock();
    const host = makeHost({ preferredConnectionId: "direct:lan:6767" });
    const clients: FakeDaemonClient[] = [];
    const latencies: Record<string, number | Error> = {
      "direct:lan:6767": 15,
      "relay:relay.thoth.seeles.ai:443": 60,
    };
    const controller = new HostRuntimeController({
      host,
      deps: makeDeps(latencies, clients),
    });

    await controller.start({ autoProbe: false });
    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");
    const activeClient = controller.getSnapshot().client as unknown as FakeDaemonClient;

    latencies["direct:lan:6767"] = 95;
    latencies["relay:relay.thoth.seeles.ai:443"] = 30;
    activeClient.heartbeatReportsRtt(95);
    await vi.advanceTimersByTimeAsync(120_000);
    await controller.runProbeCycleNow();
    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");

    await vi.advanceTimersByTimeAsync(120_000);
    await controller.runProbeCycleNow();
    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");

    let switched =
      controller.getSnapshot().activeConnectionId === "relay:relay.thoth.seeles.ai:443";
    for (let index = 0; index < 6 && !switched; index += 1) {
      await vi.advanceTimersByTimeAsync(120_000);
      await controller.runProbeCycleNow();
      switched = controller.getSnapshot().activeConnectionId === "relay:relay.thoth.seeles.ai:443";
    }
    expect(switched).toBe(true);
    expect(controller.getSnapshot().client).not.toBeNull();
  });

  it("does not switch on a transient latency spike", async () => {
    useHostRuntimeClock();
    const host = makeHost({ preferredConnectionId: "direct:lan:6767" });
    const clients: FakeDaemonClient[] = [];
    const latencies: Record<string, number | Error> = {
      "direct:lan:6767": 15,
      "relay:relay.thoth.seeles.ai:443": 80,
    };
    const controller = new HostRuntimeController({
      host,
      deps: makeDeps(latencies, clients),
    });

    await controller.start({ autoProbe: false });
    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");
    const activeClient = controller.getSnapshot().client as unknown as FakeDaemonClient;

    latencies["direct:lan:6767"] = 100;
    latencies["relay:relay.thoth.seeles.ai:443"] = 20;
    activeClient.heartbeatReportsRtt(100);
    await vi.advanceTimersByTimeAsync(120_000);
    await controller.runProbeCycleNow();
    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");

    latencies["direct:lan:6767"] = 20;
    latencies["relay:relay.thoth.seeles.ai:443"] = 90;
    activeClient.heartbeatReportsRtt(20);
    await vi.advanceTimersByTimeAsync(120_000);
    await controller.runProbeCycleNow();
    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");

    latencies["direct:lan:6767"] = 100;
    latencies["relay:relay.thoth.seeles.ai:443"] = 20;
    activeClient.heartbeatReportsRtt(100);
    await vi.advanceTimersByTimeAsync(120_000);
    await controller.runProbeCycleNow();
    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");

    await vi.advanceTimersByTimeAsync(120_000);
    await controller.runProbeCycleNow();
    expect(controller.getSnapshot().activeConnectionId).toBe("direct:lan:6767");

    let switched =
      controller.getSnapshot().activeConnectionId === "relay:relay.thoth.seeles.ai:443";
    for (let index = 0; index < 6 && !switched; index += 1) {
      await vi.advanceTimersByTimeAsync(120_000);
      await controller.runProbeCycleNow();
      switched = controller.getSnapshot().activeConnectionId === "relay:relay.thoth.seeles.ai:443";
    }
    expect(switched).toBe(true);
  });

  it("exposes one snapshot with active connection and status from same source", async () => {
    const host = makeHost();
    const clients: FakeDaemonClient[] = [];
    const latencies: Record<string, number | Error> = {
      "direct:lan:6767": 12,
      "relay:relay.thoth.seeles.ai:443": 65,
    };
    const controller = new HostRuntimeController({
      host,
      deps: makeDeps(latencies, clients),
    });

    const observed = new Array<ReturnType<typeof controller.getSnapshot>>();
    const unsubscribe = controller.subscribe(() => {
      observed.push(controller.getSnapshot());
    });

    await controller.start({ autoProbe: false });

    clients[0]?.setConnectionState({
      status: "disconnected",
      reason: "transport closed",
    });

    const latest = observed[observed.length - 1];
    expect(latest?.activeConnectionId).toBe("direct:lan:6767");
    expect(latest?.connectionStatus).toBe("error");
    expect(latest?.lastError).toBe("transport closed");
    unsubscribe();
  });

  it("preserves transport disconnect reasons on the runtime snapshot", async () => {
    const host = makeHost({
      connections: [
        {
          id: "direct:lan:6767",
          type: "directTcp",
          endpoint: "lan:6767",
        },
      ],
    });
    const clients: FakeDaemonClient[] = [];
    const controller = new HostRuntimeController({
      host,
      deps: makeDeps(
        {
          "direct:lan:6767": 12,
        },
        clients,
      ),
    });

    await controller.start({ autoProbe: false });
    clients[0]?.setConnectionState({
      status: "disconnected",
      reason: "transport closed",
    });

    expect(controller.getSnapshot()).toMatchObject({
      connectionStatus: "error",
      lastError: "transport closed",
    });
  });

  it("does not emit legacy typed reason-code transition logs", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const host = makeHost({
        connections: [
          {
            id: "direct:lan:6767",
            type: "directTcp",
            endpoint: "lan:6767",
          },
        ],
      });
      const clients: FakeDaemonClient[] = [];
      const controller = new HostRuntimeController({
        host,
        deps: makeDeps(
          {
            "direct:lan:6767": 12,
          },
          clients,
        ),
      });

      await controller.start({ autoProbe: false });
      clients[0]?.setConnectionState({
        status: "disconnected",
        reason: "transport closed",
      });

      const transitionPayloads = infoSpy.mock.calls
        .filter((call) => call[0] === "[HostRuntimeTransition]")
        .map((call) => call[1] as { reasonCode?: string | null });
      const lastTransition = transitionPayloads[transitionPayloads.length - 1] ?? null;

      expect(lastTransition?.reasonCode).toBeUndefined();
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("marks Agent hydration loading while the first Projection refresh is pending", async () => {
    const client = new FakeDaemonClient();
    const response = createDeferred<Awaited<ReturnType<DaemonClient["fetchAgents"]>>>();
    client.fetchAgents = vi.fn(async () => response.promise);
    const store = new AuthorityProjectionStore();
    const service = new DaemonProjectionService(store);
    service.start(client as unknown as DaemonClient, "srv_projection_loading");

    const refresh = service.refreshAgents();
    expect(store.getSnapshot("srv_projection_loading").hydration.agents).toBe("loading");
    response.resolve(makeFetchAgentsPayload({ entries: [] }));
    await refresh;
    expect(store.getSnapshot("srv_projection_loading").hydration.agents).toBe("ready");
  });

  it("keeps Agent projection ready across repeated successful refreshes", async () => {
    const client = new FakeDaemonClient();
    const store = new AuthorityProjectionStore();
    const service = new DaemonProjectionService(store);
    service.start(client as unknown as DaemonClient, "srv_projection_ready");

    await service.refreshAgents();
    await service.refreshAgents();

    expect(store.getSnapshot("srv_projection_ready").hydration.agents).toBe("ready");
    expect(client.fetchAgentsCalls).toHaveLength(2);
  });

  it("records a refresh error without deleting the last ready Agent snapshot", async () => {
    const client = new FakeDaemonClient();
    const store = new AuthorityProjectionStore();
    const service = new DaemonProjectionService(store);
    service.start(client as unknown as DaemonClient, "srv_projection_error");
    client.fetchAgentsResponses.push(
      makeFetchAgentsPayload({
        entries: [
          makeFetchAgentsEntry({
            id: "agent-ready",
            cwd: "/repo",
            updatedAt: "2026-07-24T00:00:00.000Z",
          }),
        ],
      }),
    );
    await service.refreshAgents();
    client.fetchAgents = vi.fn(async () => {
      throw new Error("bootstrap failed");
    });

    await expect(service.refreshAgents()).rejects.toThrow("bootstrap failed");
    const snapshot = store.getSnapshot("srv_projection_error");
    expect(snapshot.hydration.agents).toBe("error");
    expect(snapshot.agents.has("agent-ready")).toBe(true);
  });

  it("keeps online snapshots coupled to a live client reference", async () => {
    const host = makeHost();
    const clients: FakeDaemonClient[] = [];
    const latencies: Record<string, number | Error> = {
      "direct:lan:6767": 12,
      "relay:relay.thoth.seeles.ai:443": 65,
    };
    const controller = new HostRuntimeController({
      host,
      deps: makeDeps(latencies, clients),
    });

    const observed = new Array<ReturnType<typeof controller.getSnapshot>>();
    const unsubscribe = controller.subscribe(() => {
      observed.push(controller.getSnapshot());
    });

    await controller.start({ autoProbe: false });

    for (const snapshot of observed) {
      if (snapshot.connectionStatus === "online") {
        expect(snapshot.client).toBeTruthy();
      }
    }
    expect(controller.getSnapshot().connectionStatus).toBe("online");
    expect(controller.getSnapshot().client).toBeTruthy();
    unsubscribe();
  });

  it("ignores stale switch failures after a newer connection is already online", async () => {
    const host = makeHost({
      connections: [
        {
          id: "direct:lan:6767",
          type: "directTcp",
          endpoint: "lan:6767",
        },
        {
          id: "relay:relay.thoth.seeles.ai:443",
          type: "relay",
          relayEndpoint: "relay.thoth.seeles.ai:443",
          daemonPublicKeyB64: "pk_test",
          relayToken: "rdt_valid",
          relayTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        },
      ],
    });
    const firstConnectGate = createDeferred<void>();
    const createdClients: FakeDaemonClient[] = [];
    const deps: HostRuntimeControllerDeps = {
      createClient: ({ connection }) => {
        const client = new FakeDaemonClient();
        if (connection.id === "direct:lan:6767") {
          client.connect = async () => {
            client.connectCalls += 1;
            await firstConnectGate.promise;
            throw new Error("stale direct connect failed");
          };
        }
        createdClients.push(client);
        return client as unknown as DaemonClient;
      },
      connectToDaemon: async ({ host: hostProfile }) => ({
        client: makeConnectedProbeClient(10) as unknown as DaemonClient,
        serverId: hostProfile.serverId,
        hostname: hostProfile.label ?? null,
      }),
      getClientId: async () => "cid_test_runtime",
    };
    const controller = new HostRuntimeController({
      host,
      deps,
    });

    const waitUntil = async (predicate: () => boolean, timeoutMs = 200): Promise<void> => {
      const timeoutAt = Date.now() + timeoutMs;
      while (!predicate()) {
        if (Date.now() >= timeoutAt) {
          throw new Error("timed out waiting for predicate");
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };

    const switchDirect = controller.activateConnection({ connectionId: "direct:lan:6767" });
    await waitUntil(() => {
      const snapshot = controller.getSnapshot();
      return (
        createdClients.length === 1 &&
        snapshot.activeConnectionId === "direct:lan:6767" &&
        snapshot.connectionStatus === "connecting"
      );
    });

    const switchRelay = controller.activateConnection({
      connectionId: "relay:relay.thoth.seeles.ai:443",
    });
    await waitUntil(() => {
      const snapshot = controller.getSnapshot();
      return (
        snapshot.activeConnectionId === "relay:relay.thoth.seeles.ai:443" &&
        snapshot.connectionStatus === "online"
      );
    });

    firstConnectGate.resolve();
    await Promise.allSettled([switchDirect, switchRelay]);

    const snapshot = controller.getSnapshot();
    expect(snapshot.activeConnectionId).toBe("relay:relay.thoth.seeles.ai:443");
    expect(snapshot.connectionStatus).toBe("online");
    expect(snapshot.lastError).toBeNull();
    expect(createdClients).toHaveLength(2);
    expect(createdClients[0]?.isDisposed()).toBe(true);
  });

  it("coalesces overlapping probe cycles instead of invalidating the in-flight result", async () => {
    const host = makeHost({
      connections: [
        {
          id: "direct:lan:6767",
          type: "directTcp",
          endpoint: "lan:6767",
        },
      ],
    });
    const slowProbe = createDeferred<number>();
    let probeCalls = 0;

    const controller = new HostRuntimeController({
      host,
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async ({ host: hostProfile }) => {
          probeCalls += 1;
          const client = new FakeDaemonClient();
          client.connectCalls = 1;
          client.setConnectionState({ status: "connected" });
          client.ping = async () => {
            if (probeCalls === 1) {
              return { rttMs: await slowProbe.promise };
            }
            throw new Error("unexpected probe call");
          };
          return {
            client: client as unknown as DaemonClient,
            serverId: hostProfile.serverId,
            hostname: hostProfile.label ?? null,
          };
        },
        getClientId: async () => "cid_test_runtime",
      },
    });

    const first = controller.runProbeCycleNow();
    const second = controller.runProbeCycleNow();
    expect(probeCalls).toBe(1);

    slowProbe.resolve(900);
    await Promise.all([first, second]);
    const probeAfterCycle = controller.getSnapshot().probeByConnectionId.get("direct:lan:6767");
    expect(probeAfterCycle).toEqual({
      status: "available",
      latencyMs: 900,
    });
  });

  it("keeps active client generation stable during background probe cycles", async () => {
    useHostRuntimeClock();
    const host = makeHost({
      connections: [
        {
          id: "direct:lan:6767",
          type: "directTcp",
          endpoint: "lan:6767",
        },
      ],
    });
    const createdClients: FakeDaemonClient[] = [];

    const controller = new HostRuntimeController({
      host,
      deps: {
        createClient: () => {
          const client = new FakeDaemonClient();
          createdClients.push(client);
          return client as unknown as DaemonClient;
        },
        connectToDaemon: async ({ host: hostProfile }) => {
          const client = makeConnectedProbeClient(10);
          return {
            client: client as unknown as DaemonClient,
            serverId: hostProfile.serverId,
            hostname: hostProfile.label ?? null,
          };
        },
        getClientId: async () => "cid_test_runtime",
      },
    });

    await controller.start({ autoProbe: false });
    const activeClientBeforeProbes = controller.getSnapshot().client;
    const generationBeforeProbes = controller.getSnapshot().clientGeneration;

    await vi.advanceTimersByTimeAsync(10_000);
    await controller.runProbeCycleNow();
    expect(controller.getSnapshot().client).toBe(activeClientBeforeProbes);
    expect(controller.getSnapshot().clientGeneration).toBe(generationBeforeProbes);
    expect(createdClients).toHaveLength(0);
  });
});

describe("HostRuntimeStore", () => {
  it("marks the host registry loaded after boot reads storage", async () => {
    const previousOverride = process.env.EXPO_PUBLIC_LOCAL_DAEMON;
    process.env.EXPO_PUBLIC_LOCAL_DAEMON = "not-an-endpoint";
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => {
          throw new Error("createClient should not be called");
        },
        connectToDaemon: async () => {
          throw new Error("connectToDaemon should not be called");
        },
        getClientId: async () => "cid_test_runtime",
      },
    });

    try {
      let hostListNotifications = 0;
      let unsubscribeHostList = () => {};
      const registryLoaded = new Promise<void>((resolve) => {
        unsubscribeHostList = store.subscribeHostList(() => {
          hostListNotifications += 1;
          if (store.isHostRegistryLoaded()) {
            unsubscribeHostList();
            resolve();
          }
        });
      });

      store.boot();
      await registryLoaded;

      expect(store.isHostRegistryLoaded()).toBe(true);
      expect(hostListNotifications).toBe(2);
    } finally {
      if (previousOverride === undefined) {
        delete process.env.EXPO_PUBLIC_LOCAL_DAEMON;
      } else {
        process.env.EXPO_PUBLIC_LOCAL_DAEMON = previousOverride;
      }
    }
  });

  it("subscribes the Agent projection on the first refresh page", async () => {
    const client = new FakeDaemonClient();
    const store = new AuthorityProjectionStore();
    const service = new DaemonProjectionService(store);
    service.start(client as unknown as DaemonClient, "srv_projection_subscription");

    await service.refreshAgents();

    expect(client.fetchAgentsCalls).toEqual([
      {
        scope: "active",
        sort: [{ key: "updated_at", direction: "desc" }],
        subscribe: { subscriptionId: "app:srv_projection_subscription" },
        page: { limit: 200 },
      },
    ]);
  });

  it("hydrates Agent projection without any prior App authority snapshot", async () => {
    const client = new FakeDaemonClient();
    client.fetchAgentsResponses.push(
      makeFetchAgentsPayload({
        entries: [
          makeFetchAgentsEntry({
            id: "agent-first",
            cwd: "/repo",
            updatedAt: "2026-07-24T00:00:00.000Z",
          }),
        ],
      }),
    );
    const store = new AuthorityProjectionStore();
    const service = new DaemonProjectionService(store);
    service.start(client as unknown as DaemonClient, "srv_projection_empty");

    await service.refreshAgents();

    expect(store.getSnapshot("srv_projection_empty").agents.has("agent-first")).toBe(true);
    expect(store.getSnapshot("srv_projection_empty").hydration.agents).toBe("ready");
  });

  it("hydrates legacy daemons into path-backed Agent and Workspace projections", async () => {
    const serverId = "srv_legacy_workspace_daemon";
    const client = new FakeDaemonClient();
    client.setServerInfo({
      status: "server_info",
      serverId,
      hostname: null,
      version: "0.1.96",
      capabilities: {},
      features: {},
    });
    client.fetchAgentsResponses.push(
      makeFetchAgentsPayload({
        entries: [
          makeFetchAgentsEntry({
            id: "agent-legacy",
            cwd: "/repo/legacy-app",
            updatedAt: "2026-06-18T12:00:00.000Z",
            title: "Legacy daemon agent",
          }),
        ],
      }),
    );
    const store = new AuthorityProjectionStore();
    const service = new DaemonProjectionService(store);
    service.start(client as unknown as DaemonClient, serverId);

    await service.refreshAgents();

    const projection = store.getSnapshot(serverId);
    expect(projection.agents.get("agent-legacy")?.workspaceId).toBe("/repo/legacy-app");
    expect(Array.from(projection.workspaces.values())).toEqual([
      expect.objectContaining({
        id: "/repo/legacy-app",
        workspaceDirectory: "/repo/legacy-app",
        name: "legacy-app",
      }),
    ]);
    expect(projection.hydration.workspaces).toBe("ready");
  });

  it("fetches every active Agent page before publishing the replacement projection", async () => {
    const serverId = "srv_paged";
    const client = new FakeDaemonClient();
    client.fetchAgentsResponses.push(
      makeFetchAgentsPayload({
        entries: [
          makeFetchAgentsEntry({
            id: "agent-recent",
            cwd: "/Users/moboudra/dev/thoth",
            updatedAt: "2026-03-04T12:00:00.000Z",
            title: "Recent agent",
          }),
        ],
        hasMore: true,
        nextCursor: "cursor-page-2",
      }),
      makeFetchAgentsPayload({
        entries: [
          makeFetchAgentsEntry({
            id: "agent-stale-attention",
            cwd: "/Users/moboudra/dev/thoth-pr67-review",
            updatedAt: "2026-02-20T08:00:00.000Z",
            title: "Needs triage",
            requiresAttention: true,
            attentionReason: "error",
          }),
        ],
        hasMore: false,
      }),
    );
    const store = new AuthorityProjectionStore();
    const service = new DaemonProjectionService(store);
    service.start(client as unknown as DaemonClient, serverId);

    await service.refreshAgents();

    expect(client.fetchAgentsCalls).toHaveLength(2);
    expect(client.fetchAgentsCalls[0]).toEqual({
      scope: "active",
      sort: [{ key: "updated_at", direction: "desc" }],
      subscribe: { subscriptionId: "app:srv_paged" },
      page: { limit: 200 },
    });
    expect(client.fetchAgentsCalls[1]).toEqual({
      scope: "active",
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: 200, cursor: "cursor-page-2" },
    });

    const staleAgent = store.getSnapshot(serverId).agents.get("agent-stale-attention");
    expect(staleAgent?.requiresAttention).toBe(true);
    expect(staleAgent?.attentionReason).toBe("error");
    expect(store.getSnapshot(serverId).hydration.agents).toBe("ready");
  });

  it("re-subscribes Agent projection after the service reconnects", async () => {
    const serverId = "srv_resubscribe";
    const client = new FakeDaemonClient();
    const store = new AuthorityProjectionStore();
    const service = new DaemonProjectionService(store);
    service.start(client as unknown as DaemonClient, serverId);
    await service.refreshAgents();
    service.stop();
    service.start(client as unknown as DaemonClient, serverId);
    await service.refreshAgents();

    expect(client.fetchAgentsCalls).toEqual([
      {
        scope: "active",
        sort: [{ key: "updated_at", direction: "desc" }],
        subscribe: { subscriptionId: "app:srv_resubscribe" },
        page: { limit: 200 },
      },
      {
        scope: "active",
        sort: [{ key: "updated_at", direction: "desc" }],
        subscribe: { subscriptionId: "app:srv_resubscribe" },
        page: { limit: 200 },
      },
    ]);
  });

  it("replaces stale active Agent projection when refresh omits the Agent", async () => {
    const serverId = "srv_archived_rehydrate";
    const client = new FakeDaemonClient();
    const store = new AuthorityProjectionStore();
    const service = new DaemonProjectionService(store);
    service.start(client as unknown as DaemonClient, serverId);
    client.fetchAgentsResponses.push(
      makeFetchAgentsPayload({
        entries: [
          makeFetchAgentsEntry({
            id: "agent-archived",
            cwd: "/Users/moboudra/dev/thoth",
            updatedAt: "2026-03-30T15:29:00.000Z",
            title: "Stale active copy",
          }),
        ],
      }),
      makeFetchAgentsPayload({ entries: [] }),
    );

    await service.refreshAgents();
    expect(store.getSnapshot(serverId).agents.has("agent-archived")).toBe(true);
    await service.refreshAgents();
    expect(store.getSnapshot(serverId).agents.has("agent-archived")).toBe(false);
  });

  it("records unavailable startup probes when no connection can be established", async () => {
    const host = makeHost({
      connections: [
        {
          id: "direct:lan:6767",
          type: "directTcp",
          endpoint: "lan:6767",
        },
      ],
    });
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => {
          throw new Error("create client failed");
        },
        connectToDaemon: async () => {
          throw new Error("probe unavailable");
        },
        getClientId: async () => "cid_test_runtime",
      },
    });

    store.syncHosts([host]);
    let snapshot = store.getSnapshot(host.serverId);
    const timeoutAt = Date.now() + 100;
    while (
      snapshot?.probeByConnectionId.get("direct:lan:6767")?.status !== "unavailable" &&
      Date.now() < timeoutAt
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      snapshot = store.getSnapshot(host.serverId);
    }

    expect(snapshot?.connectionStatus).toBe("connecting");
    expect(snapshot?.lastError).toBeNull();
    expect(snapshot?.probeByConnectionId.get("direct:lan:6767")).toEqual({
      status: "unavailable",
      latencyMs: null,
    });
  });

  it("marks expired relay credentials unavailable without probing the network", async () => {
    const host = makeHost({
      connections: [
        {
          id: "relay:wss:relay.test.thoth.seeles.ai:443",
          type: "relay",
          relayEndpoint: "relay.test.thoth.seeles.ai:443",
          useTls: true,
          daemonPublicKeyB64: "pk_test",
          relayToken: "rdt_expired",
          relayTokenExpiresAt: "2000-01-01T00:00:00.000Z",
        },
      ],
      preferredConnectionId: "relay:wss:relay.test.thoth.seeles.ai:443",
    });
    let probeCalls = 0;
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => {
          throw new Error("create client should not be called");
        },
        connectToDaemon: async () => {
          probeCalls += 1;
          throw new Error("probe should not be called");
        },
        getClientId: async () => "cid_test_runtime",
      },
    });

    store.syncHosts([host]);
    let snapshot = store.getSnapshot(host.serverId);
    const timeoutAt = Date.now() + 100;
    while (
      snapshot?.probeByConnectionId.get("relay:wss:relay.test.thoth.seeles.ai:443")?.status !==
        "unavailable" &&
      Date.now() < timeoutAt
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      snapshot = store.getSnapshot(host.serverId);
    }

    expect(probeCalls).toBe(0);
    expect(snapshot?.probeByConnectionId.get("relay:wss:relay.test.thoth.seeles.ai:443")).toEqual({
      status: "unavailable",
      latencyMs: null,
    });
  });

  it("renameHost updates label in memory", async () => {
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async ({ host }) => ({
          client: makeConnectedProbeClient(5) as unknown as DaemonClient,
          serverId: host.serverId,
          hostname: host.label ?? null,
        }),
        getClientId: async () => "cid_test_runtime",
      },
    });

    // upsertDirectConnection goes through setHostsAndSync, which both sets
    // this.hosts and syncs controllers — matching the real init path.
    await store.upsertDirectConnection({
      serverId: "srv_rename",
      endpoint: "lan:6767",
      label: "old name",
    });
    expect(store.getHosts().find((h) => h.serverId === "srv_rename")?.label).toBe("old name");

    // persistHosts may throw in test env (no AsyncStorage/window), but the
    // in-memory state should still be updated by setHostsAndSync.
    await store.renameHost("srv_rename", "new name").catch(() => undefined);

    const renamed = store.getHosts().find((h) => h.serverId === "srv_rename");
    expect(renamed?.label).toBe("new name");

    store.syncHosts([]);
  });

  it("upsertDirectConnection stores SSL and password settings", async () => {
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async ({ host }) => ({
          client: makeConnectedProbeClient(5) as unknown as DaemonClient,
          serverId: host.serverId,
          hostname: host.label ?? null,
        }),
        getClientId: async () => "cid_test_runtime",
      },
    });

    await store.upsertDirectConnection({
      serverId: "srv_tls_password",
      endpoint: "example.thoth.test:7443",
      useTls: true,
      password: "shared-secret",
      label: "tls host",
    });

    const host = store.getHosts().find((entry) => entry.serverId === "srv_tls_password");
    expect(host?.connections).toEqual([
      {
        id: "direct:example.thoth.test:7443",
        type: "directTcp",
        endpoint: "example.thoth.test:7443",
        useTls: true,
        password: "shared-secret",
      },
    ]);

    store.syncHosts([]);
  });

  it("probeAndUpsertConnection learns the real server id before storing a direct host", async () => {
    const connection: HostConnection = {
      id: "direct:lan:6767",
      type: "directTcp",
      endpoint: "lan:6767",
    };
    const probeClient = makeConnectedProbeClient(5);
    const seenProbeHosts: string[] = [];
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async ({ host, connection: probedConnection }) => {
          seenProbeHosts.push(host.serverId);
          expect(probedConnection).toEqual(connection);
          return {
            client: probeClient as unknown as DaemonClient,
            serverId: "srv_real_direct",
            hostname: "mbp",
          };
        },
        getClientId: async () => "cid_test_runtime",
      },
    });

    const result = await store.probeAndUpsertConnection({ connection });

    expect(result.serverId).toBe("srv_real_direct");
    expect(result.hostname).toBe("mbp");
    expect(seenProbeHosts).toEqual([""]);
    expect(probeClient.isDisposed()).toBe(false);
    expect(store.getHosts()).toMatchObject([
      {
        serverId: "srv_real_direct",
        label: "mbp",
        connections: [connection],
      },
    ]);

    store.syncHosts([]);
  });

  it("probeAndUpsertConnection replaces a matching placeholder host with the real server id", async () => {
    const connection: HostConnection = {
      id: "direct:lan:6767",
      type: "directTcp",
      endpoint: "lan:6767",
    };
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async () => ({
          client: makeConnectedProbeClient(5) as unknown as DaemonClient,
          serverId: "srv_real_direct",
          hostname: "mbp",
        }),
        getClientId: async () => "cid_test_runtime",
      },
    });
    (
      store as unknown as {
        hosts: HostProfile[];
      }
    ).hosts = [
      makeHost({
        serverId: "local:lan:6767",
        label: "local:lan:6767",
        connections: [connection],
        preferredConnectionId: connection.id,
      }),
    ];

    await store.probeAndUpsertConnection({ connection });

    expect(store.getHosts().map((host) => host.serverId)).toEqual(["srv_real_direct"]);
    expect(store.getHosts()[0]?.label).toBe("mbp");

    store.syncHosts([]);
  });

  it("uses the advertised hostname when adding a relay host from a pairing offer", async () => {
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async ({ host }) => ({
          client: makeConnectedProbeClient(5) as unknown as DaemonClient,
          serverId: host.serverId,
          hostname: host.label ?? null,
        }),
        getClientId: async () => "cid_test_runtime",
      },
    });

    await store.upsertConnectionFromOffer(makeOffer(), "mbp");

    const pairedHost = store.getHosts().find((host) => host.serverId === "srv_offer");
    expect(pairedHost?.label).toBe("mbp");

    store.syncHosts([]);
  });

  it("stores relay TLS from a pairing offer", async () => {
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async ({ host }) => ({
          client: makeConnectedProbeClient(5) as unknown as DaemonClient,
          serverId: host.serverId,
          hostname: host.label ?? null,
        }),
        getClientId: async () => "cid_test_runtime",
      },
    });

    await store.upsertConnectionFromOffer(
      makeOffer({
        relay: {
          endpoint: "relay.example.com:443",
          useTls: true,
          protocolVersion: 3,
        },
      }),
      "tls relay",
    );

    const pairedHost = store.getHosts().find((host) => host.serverId === "srv_offer");
    expect(pairedHost?.connections).toEqual([
      {
        id: "relay:wss:relay.example.com:443",
        type: "relay",
        relayEndpoint: "relay.example.com:443",
        useTls: true,
        relayProtocolVersion: 3,
        relayToken: "rpt_valid_pairing_token_abcdefghijklmnopqrstuvwxyz",
        relayTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        pairingExpiresAt: "2099-01-01T00:00:00.000Z",
        daemonPublicKeyB64: "pk_test_offer",
      },
    ]);

    store.syncHosts([]);
  });

  it("uses TLS for v3 pairing URLs that omit relay TLS on port 443", async () => {
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async ({ host }) => ({
          client: makeConnectedProbeClient(5) as unknown as DaemonClient,
          serverId: host.serverId,
          hostname: host.label ?? null,
        }),
        getClientId: async () => "cid_test_runtime",
      },
    });
    const oldPairingUrl = encodeOfferUrl({
      v: 3,
      serverId: "srv_offer",
      daemonPublicKeyB64: "pk_test_offer",
      relay: { endpoint: "relay.thoth.seeles.ai:443", protocolVersion: 3 },
      pairingToken: "rpt_valid_pairing_token_abcdefghijklmnopqrstuvwxyz",
      pairingExpiresAt: "2099-01-01T00:00:00.000Z",
    });

    await store.upsertConnectionFromOfferUrl(oldPairingUrl, "old relay");

    const pairedHost = store.getHosts().find((host) => host.serverId === "srv_offer");
    expect(pairedHost?.connections).toEqual([
      {
        id: "relay:wss:relay.thoth.seeles.ai:443",
        type: "relay",
        relayEndpoint: "relay.thoth.seeles.ai:443",
        useTls: true,
        relayProtocolVersion: 3,
        relayToken: "rpt_valid_pairing_token_abcdefghijklmnopqrstuvwxyz",
        relayTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        pairingExpiresAt: "2099-01-01T00:00:00.000Z",
        daemonPublicKeyB64: "pk_test_offer",
      },
    ]);

    store.syncHosts([]);
  });

  it("uses the latest advertised hostname when re-pairing an existing relay host", async () => {
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async ({ host }) => ({
          client: makeConnectedProbeClient(5) as unknown as DaemonClient,
          serverId: host.serverId,
          hostname: host.label ?? null,
        }),
        getClientId: async () => "cid_test_runtime",
      },
    });

    await store.upsertRelayConnection({
      serverId: "srv_offer",
      relayEndpoint: "relay.thoth.seeles.ai:443",
      daemonPublicKeyB64: "pk_test_offer",
      label: "Custom name",
    });

    await store.upsertConnectionFromOffer(makeOffer(), "mbp");

    const pairedHost = store.getHosts().find((host) => host.serverId === "srv_offer");
    expect(pairedHost?.label).toBe("mbp");

    store.syncHosts([]);
  });
});

describe("readInitialDaemonConnectionHint", () => {
  it("returns null when no hint is present", () => {
    expect(readInitialDaemonConnectionHint({ isWebRuntime: true })).toBeNull();
  });

  it("parses a valid listen-only hint", () => {
    (globalThis as Record<string, unknown>).__THOTH_INITIAL_DAEMON_CONNECTION__ = {
      listen: "localhost:6767",
    };
    expect(readInitialDaemonConnectionHint({ isWebRuntime: true })).toEqual({
      listen: "localhost:6767",
      useTls: false,
    });
  });

  it("preserves useTls when explicitly true", () => {
    (globalThis as Record<string, unknown>).__THOTH_INITIAL_DAEMON_CONNECTION__ = {
      listen: "thoth.example.com:443",
      useTls: true,
    };
    expect(readInitialDaemonConnectionHint({ isWebRuntime: true })).toEqual({
      listen: "thoth.example.com:443",
      useTls: true,
    });
  });

  it("ignores invalid shapes", () => {
    (globalThis as Record<string, unknown>).__THOTH_INITIAL_DAEMON_CONNECTION__ = "localhost:6767";
    expect(readInitialDaemonConnectionHint({ isWebRuntime: true })).toBeNull();

    (globalThis as Record<string, unknown>).__THOTH_INITIAL_DAEMON_CONNECTION__ = {
      useTls: true,
    };
    expect(readInitialDaemonConnectionHint({ isWebRuntime: true })).toBeNull();
  });
});

describe("HostRuntimeStore initial connection hint bootstrap", () => {
  it("keeps the host registry loading until a fresh initial hint probe resolves", async () => {
    const probeStarted = createDeferred<void>();
    const releaseProbe = createDeferred<void>();
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async () => {
          probeStarted.resolve();
          await releaseProbe.promise;
          return {
            client: makeConnectedProbeClient(4) as unknown as DaemonClient,
            serverId: "srv_hint",
            hostname: "hint host",
          };
        },
        getClientId: async () => "cid_test_runtime",
        readInitialConnectionHint: () => ({
          listen: "daemon-origin:8148",
          useTls: false,
        }),
      },
      storage: createMemoryHostRuntimeStorage(),
    });

    store.boot();
    await probeStarted.promise;

    expect(store.getHostRegistryStatus()).toBe("loading");

    const hostReady = onceHostListMatches(store, () => store.getHostRegistryStatus() === "ready");
    releaseProbe.resolve();
    await hostReady;

    expect(store.getHosts()[0]?.serverId).toBe("srv_hint");
  });

  it("attempts the explicit initial connection hint before default localhost bootstrap", async () => {
    const seenProbes: { endpoint: string; useTls?: boolean }[] = [];
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async ({ connection }) => {
          if (connection.type === "directTcp") {
            seenProbes.push({ endpoint: connection.endpoint, useTls: connection.useTls });
          }
          return {
            client: makeConnectedProbeClient(5) as unknown as DaemonClient,
            serverId: "srv_hint",
            hostname: "hint host",
          };
        },
        getClientId: async () => "cid_test_runtime",
        readInitialConnectionHint: () => ({
          listen: "daemon-origin:6767",
          useTls: true,
        }),
      },
      storage: createMemoryHostRuntimeStorage(),
    });

    const hostAdded = onceHostListMatches(store, () => store.getHosts().length > 0);
    store.boot();
    await hostAdded;

    expect(seenProbes).toContainEqual({ endpoint: "daemon-origin:6767", useTls: true });
    const host = store.getHosts()[0];
    expect(host?.serverId).toBe("srv_hint");
    expect(host?.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ endpoint: "daemon-origin:6767", useTls: true }),
      ]),
    );

    store.syncHosts([]);
  });

  it("refreshes a persisted matching hint connection when the daemon server id changed", async () => {
    const hintedConnection: HostConnection = {
      id: "direct:review-host:8148",
      type: "directTcp",
      endpoint: "review-host:8148",
      useTls: false,
    };
    const staleHost = makeHost({
      serverId: "srv_stale_review",
      label: "stale review host",
      connections: [hintedConnection],
      preferredConnectionId: hintedConnection.id,
    });
    const seenProbes: Array<{ serverId: string; endpoint: string }> = [];
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async ({ host, connection }) => {
          if (connection.type === "directTcp") {
            seenProbes.push({ serverId: host.serverId, endpoint: connection.endpoint });
          }
          return {
            client: makeConnectedProbeClient(6) as unknown as DaemonClient,
            serverId: "srv_current_review",
            hostname: "current review host",
          };
        },
        getClientId: async () => "cid_test_runtime",
        readInitialConnectionHint: () => ({
          listen: "review-host:8148",
          useTls: false,
        }),
      },
      storage: createMemoryHostRuntimeStorage({
        "@thoth:daemon-registry": JSON.stringify([staleHost]),
      }),
    });

    const refreshed = onceHostListMatches(store, () =>
      store.getHosts().some((host) => host.serverId === "srv_current_review"),
    );
    store.boot();
    await refreshed;

    expect(seenProbes).toContainEqual({ serverId: "", endpoint: "review-host:8148" });
    expect(store.getHosts()).toHaveLength(1);
    expect(store.getHosts()[0]).toMatchObject({
      serverId: "srv_current_review",
      label: "current review host",
      preferredConnectionId: hintedConnection.id,
    });
    expect(store.getHosts()[0]?.connections).toEqual(
      expect.arrayContaining([expect.objectContaining(hintedConnection)]),
    );
  });

  it("does not infer window.location.host when no explicit hint is present", async () => {
    const seenProbes: { endpoint: string; useTls?: boolean }[] = [];
    const firstProbe = createDeferred<void>();
    const store = new HostRuntimeStore({
      deps: {
        createClient: () => new FakeDaemonClient() as unknown as DaemonClient,
        connectToDaemon: async ({ connection }) => {
          if (connection.type === "directTcp") {
            seenProbes.push({ endpoint: connection.endpoint, useTls: connection.useTls });
          }
          firstProbe.resolve();
          throw new Error("probe unavailable");
        },
        getClientId: async () => "cid_test_runtime",
        readInitialConnectionHint: () => null,
      },
      storage: createMemoryHostRuntimeStorage(),
    });

    (globalThis as { window?: unknown }).window = {
      location: { host: "metro-host:8081", protocol: "http:" },
    };
    store.boot();
    await firstProbe.promise;

    expect(seenProbes).not.toContainEqual(expect.objectContaining({ endpoint: "metro-host:8081" }));
    expect(store.getHosts()).toHaveLength(0);
  });
});
