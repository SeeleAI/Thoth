import { appProjectionRuntime } from "@/projection/projection-context";
import type { AuthorityProjection } from "@/projection/authority-projection";

export function createTestProjection(
  patch: Partial<AuthorityProjection> = {},
): AuthorityProjection {
  return {
    agents: new Map(),
    workspaces: new Map(),
    emptyProjects: new Map(),
    agentThothStates: new Map(),
    timelines: new Map(),
    hydration: { agents: "idle", workspaces: "idle" },
    ...patch,
  };
}

export function setTestProjection(
  serverId: string,
  patch: Partial<AuthorityProjection>,
): AuthorityProjection {
  const projection = createTestProjection(patch);
  appProjectionRuntime.store.replaceSnapshot(serverId, projection);
  return projection;
}

export function patchTestProjection(
  serverId: string,
  patch: Partial<AuthorityProjection>,
): AuthorityProjection {
  const projection = { ...appProjectionRuntime.store.getSnapshot(serverId), ...patch };
  appProjectionRuntime.store.replaceSnapshot(serverId, projection);
  return projection;
}

export function clearTestProjections(): void {
  for (const serverId of appProjectionRuntime.store.getServerIds()) {
    appProjectionRuntime.detach(serverId);
    appProjectionRuntime.store.clear(serverId);
  }
}
