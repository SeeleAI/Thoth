import path from "node:path";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";
import { WorkspaceCatalogStore } from "./catalog-store.js";
import {
  WorkspaceAuthorityStore,
  type WorkspaceAuthorityUpdate,
} from "./workspace-authority-store.js";
import type { DecisionTreeDelta } from "@thoth/protocol/clarify-authority";
import type { ForegroundAuthorityUpdateReason } from "./foreground-authority-types.js";
import type { AgentThothState } from "@thoth/protocol/thoth/rpc-schemas";
import type { TaskContextEnvelope } from "@thoth/protocol/task-authority";

type WorkspaceAuthorityManagerSubscriber = (update: WorkspaceAuthorityUpdate) => void;
type WorkspaceDecisionTreeSubscriber = (update: DecisionTreeDelta) => void;
type WorkspaceForegroundSubscriber = (
  state: AgentThothState,
  reason: ForegroundAuthorityUpdateReason,
) => void;

export class WorkspaceAuthorityManager {
  readonly catalog: WorkspaceCatalogStore;

  private readonly thothHome: string;
  private readonly stores = new Map<string, WorkspaceAuthorityStore>();
  private readonly storeUnsubscribers = new Map<string, () => void>();
  private readonly foregroundStoreUnsubscribers = new Map<string, () => void>();
  private readonly decisionTreeStoreUnsubscribers = new Map<string, () => void>();
  private readonly subscribers = new Set<WorkspaceAuthorityManagerSubscriber>();
  private readonly foregroundSubscribers = new Set<WorkspaceForegroundSubscriber>();
  private readonly decisionTreeSubscribers = new Set<WorkspaceDecisionTreeSubscriber>();

  constructor(thothHome: string) {
    this.thothHome = thothHome;
    this.catalog = new WorkspaceCatalogStore(thothHome);
  }

  registerWorkspace(workspace: PersistedWorkspaceRecord): WorkspaceAuthorityStore {
    const now = new Date().toISOString();
    this.catalog.upsertWorkspace({
      id: workspace.workspaceId,
      canonicalPath: path.resolve(workspace.cwd),
      displayName: workspace.title ?? workspace.displayName,
      kind: workspace.kind === "worktree" ? "worktree" : "workspace",
      parentWorkspaceId: null,
      archivedAt: workspace.archivedAt ?? null,
      createdAt: workspace.createdAt ?? now,
      updatedAt: workspace.updatedAt ?? now,
    });
    return this.forWorkspace(workspace.workspaceId);
  }

  forWorkspace(workspaceId: string): WorkspaceAuthorityStore {
    const existing = this.stores.get(workspaceId);
    if (existing) {
      return existing;
    }
    if (!this.catalog.getWorkspace(workspaceId)) {
      throw new Error(`Workspace ${workspaceId} is not registered in the authority catalog`);
    }
    const store = new WorkspaceAuthorityStore({
      thothHome: this.thothHome,
      workspaceId,
      catalog: this.catalog,
    });
    this.storeUnsubscribers.set(
      workspaceId,
      store.subscribe((update) => {
        for (const subscriber of this.subscribers) {
          subscriber(update);
        }
      }),
    );
    this.foregroundStoreUnsubscribers.set(
      workspaceId,
      store.subscribeForeground((state, reason) => {
        for (const subscriber of this.foregroundSubscribers) {
          subscriber(state, reason);
        }
      }),
    );
    this.decisionTreeStoreUnsubscribers.set(
      workspaceId,
      store.subscribeDecisionTree((update) => {
        for (const subscriber of this.decisionTreeSubscribers) subscriber(update);
      }),
    );
    this.stores.set(workspaceId, store);
    return store;
  }

  subscribe(subscriber: WorkspaceAuthorityManagerSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  subscribeForeground(subscriber: WorkspaceForegroundSubscriber): () => void {
    this.foregroundSubscribers.add(subscriber);
    return () => this.foregroundSubscribers.delete(subscriber);
  }

  subscribeDecisionTree(subscriber: WorkspaceDecisionTreeSubscriber): () => void {
    this.decisionTreeSubscribers.add(subscriber);
    return () => this.decisionTreeSubscribers.delete(subscriber);
  }

  forAgent(agentId: string): WorkspaceAuthorityStore | null {
    const workspaceId = this.catalog.locateAgent(agentId);
    return workspaceId ? this.forWorkspace(workspaceId) : null;
  }

  forTurn(turnId: string): WorkspaceAuthorityStore | null {
    const workspaceId = this.catalog.locateTurn(turnId);
    return workspaceId ? this.forWorkspace(workspaceId) : null;
  }

  forCard(cardId: string): WorkspaceAuthorityStore | null {
    const workspaceId = this.catalog.locateCard(cardId);
    return workspaceId ? this.forWorkspace(workspaceId) : null;
  }

  getTaskContext(
    workspaceId: string,
    taskId: string,
    revision?: number,
  ): TaskContextEnvelope | null {
    const context = this.forWorkspace(workspaceId).getTaskContext(taskId, revision);
    if (!context) return null;
    const decisions = new Map(context.decisions.map((decision) => [decision.id, decision]));
    const sourceStore = this.forWorkspace(context.task.sourceAgentWorkspaceId);
    for (const decisionId of context.task.intentContract.humanDecisionRefs) {
      const decision = decisions.get(decisionId) ?? sourceStore.getDecision(decisionId);
      if (decision) decisions.set(decision.id, decision);
    }
    return { ...context, decisions: [...decisions.values()] };
  }

  listLatestTurnTaskContexts(turnId: string): TaskContextEnvelope[] {
    const turnStore = this.forTurn(turnId);
    if (!turnStore) return [];
    return turnStore.listTurnTaskContextReferences(turnId).map((reference) => {
      const context = this.getTaskContext(reference.workspaceId, reference.taskId);
      if (!context) {
        throw new Error(
          `Bound Task ${reference.taskId} is no longer available in Workspace ${reference.workspaceId}`,
        );
      }
      return context;
    });
  }

  close(): void {
    for (const unsubscribe of this.storeUnsubscribers.values()) {
      unsubscribe();
    }
    this.storeUnsubscribers.clear();
    for (const unsubscribe of this.foregroundStoreUnsubscribers.values()) {
      unsubscribe();
    }
    this.foregroundStoreUnsubscribers.clear();
    for (const unsubscribe of this.decisionTreeStoreUnsubscribers.values()) unsubscribe();
    this.decisionTreeStoreUnsubscribers.clear();
    for (const store of this.stores.values()) {
      store.close();
    }
    this.stores.clear();
    this.subscribers.clear();
    this.foregroundSubscribers.clear();
    this.decisionTreeSubscribers.clear();
    this.catalog.close();
  }
}
