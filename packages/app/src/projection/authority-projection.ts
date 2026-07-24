import type { AgentTimelineEntry } from "@thoth/protocol/agent-types";
import type {
  AgentSnapshotPayload,
  FetchAgentTimelineResponseMessage,
  ProjectPlacementPayload,
  WorkspaceDescriptorPayload,
} from "@thoth/protocol/messages";
import type { DaemonClient } from "@thoth/client";
import type { QueryClient } from "@tanstack/react-query";
import equal from "fast-deep-equal";
import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";
import { resolvePendingAgentMessages } from "./pending-agent-messages";
import type { Agent, EmptyProjectDescriptor, WorkspaceDescriptor } from "./authority-model";
import type { AgentThothState } from "@thoth/protocol/thoth/rpc-schemas";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { resolveProjectPlacement } from "@/utils/project-placement";
import { normalizeEmptyProjectDescriptor, normalizeWorkspaceDescriptor } from "./authority-model";
import { patchWorkspaceScripts } from "@/contexts/session-workspace-scripts";
import { derivePendingPermissionKey } from "@/utils/agent-snapshots";
import {
  clearWorkspaceArchivePending,
  shouldSuppressWorkspaceForLocalArchive,
} from "@/query/workspace-archive-state";
import { clearArchiveAgentPending } from "@/query/agent-archive-state";
import {
  buildLegacyDaemonWorkspaceSnapshot,
  shouldUseLegacyDaemonWorkspaceDirectory,
} from "@/workspace/legacy-daemon-workspaces";
import type { FetchAgentsEntry } from "@thoth/client/internal/daemon-client";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import { setWorkspaceRestoreStatus } from "@/query/workspace-restore-state";

type TimelinePayload = FetchAgentTimelineResponseMessage["payload"];

export interface TimelineProjection {
  epoch: string | null;
  entries: readonly AgentTimelineEntry[];
  startCursor: TimelinePayload["startCursor"];
  endCursor: TimelinePayload["endCursor"];
  hasOlder: boolean;
  hasNewer: boolean;
  loadingTail: boolean;
  loadingOlder: boolean;
}

export interface AuthorityProjection {
  agents: ReadonlyMap<string, Agent>;
  workspaces: ReadonlyMap<string, WorkspaceDescriptor>;
  emptyProjects: ReadonlyMap<string, EmptyProjectDescriptor>;
  agentThothStates: ReadonlyMap<string, AgentThothState>;
  timelines: ReadonlyMap<string, TimelineProjection>;
  hydration: {
    agents: ProjectionHydration;
    workspaces: ProjectionHydration;
  };
}

export type ProjectionHydration = "idle" | "loading" | "ready" | "error";

export type ProjectionDelta =
  | { type: "timeline_page"; agentId: string; page: TimelinePayload }
  | { type: "timeline_loading_tail"; agentId: string; loading: boolean }
  | { type: "timeline_loading_older"; agentId: string; loading: boolean }
  | { type: "agents_replace"; agents: ReadonlyMap<string, Agent> }
  | { type: "agent_upsert"; agent: Agent }
  | { type: "agent_remove"; agentId: string }
  | { type: "agent_thoth_state"; state: AgentThothState }
  | { type: "workspaces_replace"; workspaces: ReadonlyMap<string, WorkspaceDescriptor> }
  | { type: "workspace_upsert"; workspace: WorkspaceDescriptor }
  | { type: "workspace_remove"; workspaceId: string }
  | { type: "empty_projects_replace"; projects: ReadonlyMap<string, EmptyProjectDescriptor> }
  | { type: "empty_project_upsert"; project: EmptyProjectDescriptor }
  | { type: "empty_project_remove"; projectId: string }
  | { type: "hydration"; target: "agents" | "workspaces"; status: ProjectionHydration };

const EMPTY_TIMELINE: TimelineProjection = {
  epoch: null,
  entries: [],
  startCursor: null,
  endCursor: null,
  hasOlder: false,
  hasNewer: false,
  loadingTail: false,
  loadingOlder: false,
};

const EMPTY_PROJECTION: AuthorityProjection = {
  agents: new Map(),
  workspaces: new Map(),
  emptyProjects: new Map(),
  agentThothStates: new Map(),
  timelines: new Map(),
  hydration: { agents: "idle", workspaces: "idle" },
};

export class AuthorityProjectionStore {
  private readonly projections = new Map<string, AuthorityProjection>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  replaceSnapshot(serverId: string, snapshot: AuthorityProjection): void {
    this.projections.set(serverId, snapshot);
    this.emit();
  }

  applyProjectionDelta(serverId: string, delta: ProjectionDelta): void {
    const projection = this.getSnapshot(serverId);
    if (
      delta.type !== "timeline_page" &&
      delta.type !== "timeline_loading_tail" &&
      delta.type !== "timeline_loading_older"
    ) {
      const next = applyAuthorityDelta(projection, delta);
      if (next === projection) return;
      this.projections.set(serverId, next);
      this.emit();
      return;
    }
    const current = projection.timelines.get(delta.agentId) ?? EMPTY_TIMELINE;
    let next: TimelineProjection;
    if (delta.type === "timeline_page") {
      next = applyTimelinePage(current, delta.page);
    } else if (delta.type === "timeline_loading_tail") {
      next =
        current.loadingTail === delta.loading
          ? current
          : { ...current, loadingTail: delta.loading };
    } else {
      next =
        current.loadingOlder === delta.loading
          ? current
          : { ...current, loadingOlder: delta.loading };
    }
    if (next === current) return;
    const timelines = new Map(projection.timelines);
    timelines.set(delta.agentId, next);
    this.projections.set(serverId, { ...projection, timelines });
    this.emit();
  }

  resetEpoch(serverId: string, epoch: string): void {
    const projection = this.getSnapshot(serverId);
    let changed = false;
    const timelines = new Map<string, TimelineProjection>();
    for (const [agentId, timeline] of projection.timelines) {
      if (timeline.epoch === epoch) {
        timelines.set(agentId, timeline);
        continue;
      }
      changed = true;
      timelines.set(agentId, { ...EMPTY_TIMELINE, epoch });
    }
    if (!changed) return;
    this.projections.set(serverId, { ...projection, timelines });
    this.emit();
  }

  getSnapshot(serverId: string): AuthorityProjection {
    return this.projections.get(serverId) ?? EMPTY_PROJECTION;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getVersion(): number {
    return this.version;
  }

  getServerIds(): readonly string[] {
    return [...this.projections.keys()];
  }

  clear(serverId: string): void {
    if (!this.projections.delete(serverId)) return;
    this.emit();
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

function applyAuthorityDelta(
  projection: AuthorityProjection,
  delta: Exclude<
    ProjectionDelta,
    { type: "timeline_page" | "timeline_loading_tail" | "timeline_loading_older" }
  >,
): AuthorityProjection {
  switch (delta.type) {
    case "agents_replace": {
      const agents = reconcileAgentMap(projection.agents, delta.agents);
      return agents === projection.agents ? projection : { ...projection, agents };
    }
    case "agent_upsert": {
      const current = projection.agents.get(delta.agent.id);
      const agent = reconcileAgentSnapshot(current, delta.agent);
      if (current === agent) return projection;
      return { ...projection, agents: new Map(projection.agents).set(delta.agent.id, agent) };
    }
    case "agent_remove": {
      if (!projection.agents.has(delta.agentId)) return projection;
      const agents = new Map(projection.agents);
      agents.delete(delta.agentId);
      const agentThothStates = new Map(projection.agentThothStates);
      agentThothStates.delete(delta.agentId);
      const timelines = new Map(projection.timelines);
      timelines.delete(delta.agentId);
      return { ...projection, agents, agentThothStates, timelines };
    }
    case "agent_thoth_state": {
      const current = projection.agentThothStates.get(delta.state.agentId);
      if (current && current.revision >= delta.state.revision) return projection;
      return {
        ...projection,
        agentThothStates: new Map(projection.agentThothStates).set(
          delta.state.agentId,
          delta.state,
        ),
      };
    }
    case "workspaces_replace": {
      const workspaces = reconcileMap(projection.workspaces, delta.workspaces);
      return workspaces === projection.workspaces ? projection : { ...projection, workspaces };
    }
    case "workspace_upsert": {
      const current = projection.workspaces.get(delta.workspace.id);
      if (current && equal(current, delta.workspace)) return projection;
      return {
        ...projection,
        workspaces: new Map(projection.workspaces).set(delta.workspace.id, delta.workspace),
      };
    }
    case "workspace_remove": {
      if (!projection.workspaces.has(delta.workspaceId)) return projection;
      const workspaces = new Map(projection.workspaces);
      workspaces.delete(delta.workspaceId);
      return { ...projection, workspaces };
    }
    case "empty_projects_replace": {
      const emptyProjects = reconcileMap(projection.emptyProjects, delta.projects);
      return emptyProjects === projection.emptyProjects
        ? projection
        : { ...projection, emptyProjects };
    }
    case "empty_project_upsert": {
      const current = projection.emptyProjects.get(delta.project.projectId);
      if (current && equal(current, delta.project)) return projection;
      return {
        ...projection,
        emptyProjects: new Map(projection.emptyProjects).set(
          delta.project.projectId,
          delta.project,
        ),
      };
    }
    case "empty_project_remove": {
      if (!projection.emptyProjects.has(delta.projectId)) return projection;
      const emptyProjects = new Map(projection.emptyProjects);
      emptyProjects.delete(delta.projectId);
      return { ...projection, emptyProjects };
    }
    case "hydration":
      return projection.hydration[delta.target] === delta.status
        ? projection
        : {
            ...projection,
            hydration: { ...projection.hydration, [delta.target]: delta.status },
          };
  }
}

function reconcileMap<K, V>(
  current: ReadonlyMap<K, V>,
  incoming: ReadonlyMap<K, V>,
): ReadonlyMap<K, V> {
  if (current === incoming) return current;
  let changed = current.size !== incoming.size;
  const next = new Map<K, V>();
  for (const [key, value] of incoming) {
    const existing = current.get(key);
    if (existing !== undefined && equal(existing, value)) {
      next.set(key, existing);
    } else {
      next.set(key, value);
      changed = true;
    }
  }
  return changed ? next : current;
}

function reconcileAgentMap(
  current: ReadonlyMap<string, Agent>,
  incoming: ReadonlyMap<string, Agent>,
): ReadonlyMap<string, Agent> {
  if (current === incoming) return current;
  let changed = current.size !== incoming.size;
  const next = new Map<string, Agent>();
  for (const [id, value] of incoming) {
    const existing = current.get(id);
    const reconciled = reconcileAgentSnapshot(existing, value);
    next.set(id, reconciled);
    if (reconciled !== existing) changed = true;
  }
  return changed ? next : current;
}

function hasAgentUsageChanged(
  incoming: Agent["lastUsage"] | undefined,
  current: Agent["lastUsage"] | undefined,
): boolean {
  return !equal(incoming ?? null, current ?? null);
}

function reconcileAgentSnapshot(current: Agent | undefined, incoming: Agent): Agent {
  if (!current) return incoming;
  if (incoming.updatedAt.getTime() < current.updatedAt.getTime()) {
    return hasAgentUsageChanged(incoming.lastUsage, current.lastUsage)
      ? { ...current, lastUsage: incoming.lastUsage }
      : current;
  }
  const next =
    incoming.projectPlacement == null && current.projectPlacement != null
      ? { ...incoming, projectPlacement: current.projectPlacement }
      : incoming;
  return equal(current, next) ? current : next;
}

function upsertAgentPermission(agent: Agent, request: Agent["pendingPermissions"][number]): Agent {
  const key = derivePendingPermissionKey(agent.id, request);
  const next = agent.pendingPermissions.filter(
    (item) => derivePendingPermissionKey(agent.id, item) !== key,
  );
  next.push(request);
  return equal(next, agent.pendingPermissions) ? agent : { ...agent, pendingPermissions: next };
}

function resolveAgentPermission(agent: Agent, requestId: string): Agent {
  const key = `${agent.id}:${requestId}`;
  const next = agent.pendingPermissions.filter(
    (item) => item.id !== requestId && derivePendingPermissionKey(agent.id, item) !== key,
  );
  return next.length === agent.pendingPermissions.length
    ? agent
    : { ...agent, pendingPermissions: next };
}

export class DaemonProjectionService {
  private client: DaemonClient | null = null;
  private serverId: string | null = null;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly activeAgents = new Set<string>();
  private readonly catchUpTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly catchUpRequests = new Map<string, Promise<unknown>>();
  private lastAgentEntries: FetchAgentsEntry[] = [];
  private generation = 0;

  constructor(
    private readonly store: AuthorityProjectionStore,
    private readonly queryClient?: QueryClient,
  ) {}

  start(client: DaemonClient, serverId: string): void {
    this.stop();
    this.generation += 1;
    this.client = client;
    this.serverId = serverId;
    this.unsubscribers.push(
      client.on("agent_update", (message) => {
        if (message.type !== "agent_update") return;
        if (message.payload.kind === "remove") {
          this.store.applyProjectionDelta(serverId, {
            type: "agent_remove",
            agentId: message.payload.agentId,
          });
          return;
        }
        const snapshot = message.payload.agent;
        if (snapshot.internal === true || snapshot.labels.surface === "thoth-loop") {
          this.store.applyProjectionDelta(serverId, {
            type: "agent_remove",
            agentId: snapshot.id,
          });
          return;
        }
        const current = this.store.getSnapshot(serverId).agents.get(snapshot.id);
        const agent = normalizeAgentSnapshot(snapshot, serverId);
        this.store.applyProjectionDelta(serverId, {
          type: "agent_upsert",
          agent: {
            ...agent,
            projectPlacement:
              resolveProjectPlacement({
                projectPlacement: message.payload.project,
                cwd: agent.cwd,
              }) ?? current?.projectPlacement,
          },
        });
      }),
      client.subscribeAgentThothStateUpdates(({ state }) => {
        this.store.applyProjectionDelta(serverId, { type: "agent_thoth_state", state });
      }),
      client.on("workspace_update", (message) => {
        if (message.type !== "workspace_update") return;
        if (message.payload.kind === "remove") {
          if (this.queryClient) {
            clearWorkspaceArchivePending({
              queryClient: this.queryClient,
              serverId,
              workspaceId: message.payload.id,
            });
          }
          this.store.applyProjectionDelta(serverId, {
            type: "workspace_remove",
            workspaceId: message.payload.id,
          });
          if (message.payload.emptyProject) {
            this.store.applyProjectionDelta(serverId, {
              type: "empty_project_upsert",
              project: normalizeEmptyProjectDescriptor(message.payload.emptyProject),
            });
          }
          if (message.payload.removedProjectId) {
            this.store.applyProjectionDelta(serverId, {
              type: "empty_project_remove",
              projectId: message.payload.removedProjectId,
            });
          }
          return;
        }
        const workspace = normalizeWorkspaceDescriptor(message.payload.workspace);
        if (
          this.queryClient &&
          shouldSuppressWorkspaceForLocalArchive({
            queryClient: this.queryClient,
            serverId,
            workspace,
          })
        ) {
          return;
        }
        if (this.queryClient) {
          setWorkspaceRestoreStatus(this.queryClient, serverId, workspace.id, null);
        }
        this.store.applyProjectionDelta(serverId, {
          type: "workspace_upsert",
          workspace,
        });
      }),
      client.on("script_status_update", (message) => {
        if (message.type !== "script_status_update") return;
        const projection = this.store.getSnapshot(serverId);
        this.store.applyProjectionDelta(serverId, {
          type: "workspaces_replace",
          workspaces: patchWorkspaceScripts(new Map(projection.workspaces), message.payload),
        });
      }),
      client.on("agent_permission_request", (message) => {
        if (message.type !== "agent_permission_request") return;
        const agent = this.store.getSnapshot(serverId).agents.get(message.payload.agentId);
        if (!agent) return;
        this.store.applyProjectionDelta(serverId, {
          type: "agent_upsert",
          agent: upsertAgentPermission(agent, message.payload.request),
        });
      }),
      client.on("agent_permission_resolved", (message) => {
        if (message.type !== "agent_permission_resolved") return;
        const agent = this.store.getSnapshot(serverId).agents.get(message.payload.agentId);
        if (!agent) return;
        this.store.applyProjectionDelta(serverId, {
          type: "agent_upsert",
          agent: resolveAgentPermission(agent, message.payload.requestId),
        });
      }),
      client.on("agent_deleted", (message) => {
        if (message.type !== "agent_deleted") return;
        if (this.queryClient) {
          clearArchiveAgentPending({
            queryClient: this.queryClient,
            serverId,
            agentId: message.payload.agentId,
          });
        }
        this.store.applyProjectionDelta(serverId, {
          type: "agent_remove",
          agentId: message.payload.agentId,
        });
      }),
      client.on("agent_archived", (message) => {
        if (message.type !== "agent_archived") return;
        if (this.queryClient) {
          clearArchiveAgentPending({
            queryClient: this.queryClient,
            serverId,
            agentId: message.payload.agentId,
          });
        }
        const agent = this.store.getSnapshot(serverId).agents.get(message.payload.agentId);
        if (!agent) return;
        this.store.applyProjectionDelta(serverId, {
          type: "agent_upsert",
          agent: { ...agent, archivedAt: new Date(message.payload.archivedAt) },
        });
      }),
      client.on("fetch_agent_timeline_response", (message) => {
        if (message.type !== "fetch_agent_timeline_response") return;
        const page = message.payload;
        if (page.agent?.internal === true || page.agent?.labels.surface === "thoth-loop") return;
        this.activeAgents.add(page.agentId);
        if (page.agent) {
          const current = this.store.getSnapshot(serverId).agents.get(page.agentId);
          const agent = normalizeAgentSnapshot(page.agent, serverId);
          this.store.applyProjectionDelta(serverId, {
            type: "agent_upsert",
            agent: {
              ...agent,
              projectPlacement: current?.projectPlacement,
            },
          });
        }
        if (page.gap || page.staleCursor) {
          void this.fetchTail(page.agentId).catch((error) =>
            console.warn("[Projection] failed to reset AgentTimeline", page.agentId, error),
          );
          return;
        }
        this.store.applyProjectionDelta(serverId, {
          type: "timeline_page",
          agentId: page.agentId,
          page,
        });
        if (this.queryClient) {
          resolvePendingAgentMessages(
            this.queryClient,
            serverId,
            page.agentId,
            new Set(
              page.entries.flatMap((entry) =>
                entry.item.type === "user_message" && entry.item.messageId
                  ? [entry.item.messageId]
                  : [],
              ),
            ),
          );
        }
        if (page.hasNewer) this.scheduleCatchUp(page.agentId);
      }),
      client.on("agent_stream", (message) => {
        if (message.type !== "agent_stream" || message.payload.internal === true) return;
        if (message.payload.event.type !== "timeline") return;
        this.activeAgents.add(message.payload.agentId);
        this.scheduleCatchUp(message.payload.agentId);
      }),
    );
  }

  stop(): void {
    this.generation += 1;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    for (const timer of this.catchUpTimers.values()) clearTimeout(timer);
    this.catchUpTimers.clear();
    this.catchUpRequests.clear();
    this.activeAgents.clear();
    this.lastAgentEntries = [];
    this.client = null;
    this.serverId = null;
  }

  async revalidate(): Promise<void> {
    await this.refreshAgents();
    await Promise.all([
      this.refreshWorkspaces(),
      ...[...this.activeAgents].map((agentId) => this.fetchTail(agentId)),
    ]);
  }

  async refreshAgents(): Promise<void> {
    const client = this.client;
    const serverId = this.serverId;
    const generation = this.generation;
    if (!client || !serverId) return;
    this.store.applyProjectionDelta(serverId, {
      type: "hydration",
      target: "agents",
      status: "loading",
    });
    try {
      const entries: FetchAgentsEntry[] = [];
      let cursor: string | null = null;
      let subscribe = true;
      while (true) {
        const page = await client.fetchAgents({
          scope: "active",
          sort: [{ key: "updated_at", direction: "desc" }],
          ...(subscribe ? { subscribe: { subscriptionId: `app:${serverId}` } } : {}),
          page: cursor ? { limit: 200, cursor } : { limit: 200 },
        });
        if (!this.isCurrent(client, serverId, generation)) return;
        entries.push(...page.entries);
        subscribe = false;
        if (!readHasMore(page.pageInfo)) break;
        cursor = readNextCursor(page.pageInfo);
        if (!cursor) break;
      }

      this.lastAgentEntries = entries;
      const serverInfo = client.getLastServerInfoMessage();
      if (shouldUseLegacyDaemonWorkspaceDirectory(serverInfo)) {
        const legacy = buildLegacyDaemonWorkspaceSnapshot({ serverId, entries });
        this.store.applyProjectionDelta(serverId, {
          type: "agents_replace",
          agents: legacy.agents,
        });
        this.store.applyProjectionDelta(serverId, {
          type: "workspaces_replace",
          workspaces: legacy.workspaces,
        });
        this.store.applyProjectionDelta(serverId, {
          type: "empty_projects_replace",
          projects: new Map(),
        });
        this.store.applyProjectionDelta(serverId, {
          type: "hydration",
          target: "workspaces",
          status: "ready",
        });
      } else {
        this.store.applyProjectionDelta(serverId, {
          type: "agents_replace",
          agents: normalizeAgentEntries(serverId, entries),
        });
      }
      this.store.applyProjectionDelta(serverId, {
        type: "hydration",
        target: "agents",
        status: "ready",
      });
    } catch (error) {
      if (!this.isCurrent(client, serverId, generation)) return;
      this.store.applyProjectionDelta(serverId, {
        type: "hydration",
        target: "agents",
        status: "error",
      });
      throw error;
    }
  }

  async refreshWorkspaces(): Promise<void> {
    const client = this.client;
    const serverId = this.serverId;
    const generation = this.generation;
    if (!client || !serverId) return;
    const serverInfo = client.getLastServerInfoMessage();
    if (shouldUseLegacyDaemonWorkspaceDirectory(serverInfo)) return;
    this.store.applyProjectionDelta(serverId, {
      type: "hydration",
      target: "workspaces",
      status: "loading",
    });
    try {
      const workspaces = new Map<string, WorkspaceDescriptor>();
      const emptyProjects = new Map<string, EmptyProjectDescriptor>();
      let cursor: string | null = null;
      let subscribe = true;
      while (true) {
        const page = await client.fetchWorkspaces({
          sort: [{ key: "activity_at", direction: "desc" }],
          ...(subscribe ? { subscribe: {} } : {}),
          page: cursor ? { limit: 200, cursor } : { limit: 200 },
        });
        if (!this.isCurrent(client, serverId, generation)) return;
        for (const payload of page.entries) {
          const workspace = normalizeWorkspaceDescriptor(payload);
          if (
            !this.queryClient ||
            !shouldSuppressWorkspaceForLocalArchive({
              queryClient: this.queryClient,
              serverId,
              workspace,
            })
          ) {
            workspaces.set(workspace.id, workspace);
            if (this.queryClient) {
              setWorkspaceRestoreStatus(this.queryClient, serverId, workspace.id, null);
            }
          }
        }
        for (const payload of page.emptyProjects ?? []) {
          const project = normalizeEmptyProjectDescriptor(payload);
          emptyProjects.set(project.projectId, project);
        }
        subscribe = false;
        if (!page.pageInfo.hasMore || !page.pageInfo.nextCursor) break;
        cursor = page.pageInfo.nextCursor;
      }
      if (
        workspaces.size === 0 &&
        emptyProjects.size === 0 &&
        serverInfo?.features?.workspaceMultiplicity !== true &&
        this.lastAgentEntries.length > 0
      ) {
        const legacy = buildLegacyDaemonWorkspaceSnapshot({
          serverId,
          entries: this.lastAgentEntries,
        });
        this.store.applyProjectionDelta(serverId, {
          type: "agents_replace",
          agents: legacy.agents,
        });
        for (const [workspaceId, workspace] of legacy.workspaces) {
          workspaces.set(workspaceId, workspace);
        }
      }
      this.store.applyProjectionDelta(serverId, {
        type: "workspaces_replace",
        workspaces,
      });
      this.store.applyProjectionDelta(serverId, {
        type: "empty_projects_replace",
        projects: emptyProjects,
      });
      this.store.applyProjectionDelta(serverId, {
        type: "hydration",
        target: "workspaces",
        status: "ready",
      });
    } catch (error) {
      if (!this.isCurrent(client, serverId, generation)) return;
      this.store.applyProjectionDelta(serverId, {
        type: "hydration",
        target: "workspaces",
        status: "error",
      });
      throw error;
    }
  }

  async fetchTail(agentId: string): Promise<void> {
    this.setAgentTimelineLoading(agentId, true);
    try {
      await this.requestTimeline(agentId, { direction: "tail", projection: "projected" });
    } finally {
      this.setAgentTimelineLoading(agentId, false);
    }
  }

  setAgentTimelineLoading(agentId: string, loading: boolean): void {
    if (!this.serverId) return;
    this.store.applyProjectionDelta(this.serverId, {
      type: "timeline_loading_tail",
      agentId,
      loading,
    });
  }

  async refreshAgentThothState(agentId: string): Promise<void> {
    const client = this.client;
    const serverId = this.serverId;
    const generation = this.generation;
    if (!client || !serverId) return;
    const payload = await client.getAgentThothState(agentId);
    if (payload.error || !this.isCurrent(client, serverId, generation)) return;
    this.store.applyProjectionDelta(serverId, {
      type: "agent_thoth_state",
      state: payload.state,
    });
  }

  acceptAgentSnapshot(snapshot: AgentSnapshotPayload, project?: ProjectPlacementPayload): Agent {
    const serverId = this.serverId;
    if (!serverId) throw new Error("Projection service is not attached");
    const current = this.store.getSnapshot(serverId).agents.get(snapshot.id);
    const normalized = normalizeAgentSnapshot(snapshot, serverId);
    const workspaces = this.store.getSnapshot(serverId).workspaces;
    const legacyWorkspaceId =
      !normalized.workspaceId &&
      shouldUseLegacyDaemonWorkspaceDirectory(this.client?.getLastServerInfoMessage())
        ? resolveWorkspaceIdByDirectory(workspaces, normalized.cwd)
        : null;
    const agent = {
      ...normalized,
      ...(legacyWorkspaceId ? { workspaceId: legacyWorkspaceId } : {}),
      projectPlacement:
        resolveProjectPlacement({ projectPlacement: project, cwd: normalized.cwd }) ??
        current?.projectPlacement,
    };
    this.store.applyProjectionDelta(serverId, { type: "agent_upsert", agent });
    return agent;
  }

  acceptWorkspaceSnapshot(payload: WorkspaceDescriptorPayload): WorkspaceDescriptor {
    const serverId = this.serverId;
    if (!serverId) throw new Error("Projection service is not attached");
    const workspace = normalizeWorkspaceDescriptor(payload);
    if (
      !this.queryClient ||
      !shouldSuppressWorkspaceForLocalArchive({
        queryClient: this.queryClient,
        serverId,
        workspace,
      })
    ) {
      this.store.applyProjectionDelta(serverId, { type: "workspace_upsert", workspace });
      if (this.queryClient) {
        setWorkspaceRestoreStatus(this.queryClient, serverId, workspace.id, null);
      }
    }
    this.store.applyProjectionDelta(serverId, {
      type: "hydration",
      target: "workspaces",
      status: "ready",
    });
    return workspace;
  }

  async fetchOlder(agentId: string): Promise<void> {
    const serverId = this.serverId;
    if (!serverId) return;
    const timeline = this.store.getSnapshot(serverId).timelines.get(agentId);
    if (!timeline?.startCursor || !timeline.hasOlder || timeline.loadingOlder) return;
    this.store.applyProjectionDelta(serverId, {
      type: "timeline_loading_older",
      agentId,
      loading: true,
    });
    try {
      await this.requestTimeline(agentId, {
        direction: "before",
        cursor: timeline.startCursor,
        limit: TIMELINE_FETCH_PAGE_SIZE,
        projection: "projected",
      });
    } finally {
      this.store.applyProjectionDelta(serverId, {
        type: "timeline_loading_older",
        agentId,
        loading: false,
      });
    }
  }

  private scheduleCatchUp(agentId: string): void {
    if (this.catchUpTimers.has(agentId)) return;
    const timer = setTimeout(() => {
      this.catchUpTimers.delete(agentId);
      const serverId = this.serverId;
      if (!serverId) return;
      const cursor = this.store.getSnapshot(serverId).timelines.get(agentId)?.endCursor;
      void this.requestTimeline(agentId, {
        direction: cursor ? "after" : "tail",
        ...(cursor ? { cursor } : {}),
        projection: "projected",
      }).catch((error) =>
        console.warn("[Projection] failed to synchronize AgentTimeline", agentId, error),
      );
    }, 16);
    this.catchUpTimers.set(agentId, timer);
  }

  private requestTimeline(
    agentId: string,
    options: Parameters<DaemonClient["fetchAgentTimeline"]>[1],
  ): Promise<unknown> {
    const client = this.client;
    if (!client) return Promise.resolve();
    const existing = this.catchUpRequests.get(agentId);
    if (existing) return existing;
    const request = client
      .fetchAgentTimeline(agentId, options)
      .finally(() => this.catchUpRequests.delete(agentId));
    this.catchUpRequests.set(agentId, request);
    return request;
  }

  private isCurrent(client: DaemonClient, serverId: string, generation: number): boolean {
    return this.client === client && this.serverId === serverId && this.generation === generation;
  }
}

export class ProjectionRuntime {
  readonly store = new AuthorityProjectionStore();
  private readonly services = new Map<string, DaemonProjectionService>();

  constructor(private readonly queryClient?: QueryClient) {}

  attach(client: DaemonClient, serverId: string): () => void {
    this.detach(serverId);
    const service = new DaemonProjectionService(this.store, this.queryClient);
    service.start(client, serverId);
    this.services.set(serverId, service);
    return () => {
      if (this.services.get(serverId) === service) this.detach(serverId);
    };
  }

  service(serverId: string): DaemonProjectionService | null {
    return this.services.get(serverId) ?? null;
  }

  detach(serverId: string): void {
    this.services.get(serverId)?.stop();
    this.services.delete(serverId);
    this.store.clear(serverId);
  }
}

function resolveWorkspaceIdByDirectory(
  workspaces: ReadonlyMap<string, WorkspaceDescriptor>,
  directory: string,
): string | null {
  const normalized = normalizeWorkspacePath(directory);
  if (!normalized) return null;
  for (const workspace of workspaces.values()) {
    if (normalizeWorkspacePath(workspace.workspaceDirectory) === normalized) return workspace.id;
  }
  return normalized;
}

function normalizeAgentEntries(
  serverId: string,
  entries: readonly FetchAgentsEntry[],
): Map<string, Agent> {
  const agents = new Map<string, Agent>();
  for (const entry of entries) {
    if (entry.agent.internal === true || entry.agent.labels.surface === "thoth-loop") continue;
    const agent = normalizeAgentSnapshot(entry.agent, serverId);
    agents.set(agent.id, {
      ...agent,
      projectPlacement: resolveProjectPlacement({
        projectPlacement: entry.project,
        cwd: agent.cwd,
      }),
    });
  }
  return agents;
}

function readHasMore(pageInfo: unknown): boolean {
  if (!pageInfo || typeof pageInfo !== "object") return false;
  const page = pageInfo as { hasMore?: boolean; hasMoreAfter?: boolean };
  return page.hasMore ?? page.hasMoreAfter ?? false;
}

function readNextCursor(pageInfo: unknown): string | null {
  if (!pageInfo || typeof pageInfo !== "object") return null;
  const page = pageInfo as { nextCursor?: string | null; afterCursor?: string | null };
  return page.nextCursor ?? page.afterCursor ?? null;
}

function applyTimelinePage(current: TimelineProjection, page: TimelinePayload): TimelineProjection {
  const replace =
    page.reset ||
    current.epoch === null ||
    current.epoch !== page.epoch ||
    page.direction === "tail";
  const entries = replace ? page.entries : mergeTimelineEntries(current.entries, page.entries);
  const startCursor =
    replace || page.direction === "before"
      ? (page.startCursor ?? (replace ? null : current.startCursor))
      : current.startCursor;
  const endCursor =
    replace || page.direction === "after"
      ? (page.endCursor ?? (replace ? null : current.endCursor))
      : current.endCursor;
  return {
    epoch: page.epoch,
    entries,
    startCursor,
    endCursor,
    hasOlder: replace || page.direction === "before" ? page.hasOlder : current.hasOlder,
    hasNewer: replace || page.direction === "after" ? page.hasNewer : current.hasNewer,
    loadingTail: current.loadingTail,
    loadingOlder: current.loadingOlder,
  };
}

function mergeTimelineEntries(
  current: readonly AgentTimelineEntry[],
  incoming: readonly AgentTimelineEntry[],
): readonly AgentTimelineEntry[] {
  if (incoming.length === 0) return current;
  const incomingRanges = incoming.flatMap((entry) => entry.sourceSeqRanges);
  const kept = current.filter(
    (entry) =>
      !entry.sourceSeqRanges.some((range) => incomingRanges.some((next) => overlaps(range, next))),
  );
  return [...kept, ...incoming].sort(
    (left, right) => left.seqStart - right.seqStart || left.seqEnd - right.seqEnd,
  );
}

function overlaps(
  left: AgentTimelineEntry["sourceSeqRanges"][number],
  right: AgentTimelineEntry["sourceSeqRanges"][number],
): boolean {
  return left.startSeq <= right.endSeq && right.startSeq <= left.endSeq;
}
