import { createContext, type ReactNode, useContext, useRef } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";
import {
  ProjectionRuntime,
  type AuthorityProjection,
  type AuthorityProjectionStore,
} from "./authority-projection";
import { queryClient } from "@/query/query-client";

const ProjectionContext = createContext<ProjectionRuntime | null>(null);
export const appProjectionRuntime = new ProjectionRuntime(queryClient);

export function ProjectionProvider({ children }: { children: ReactNode }) {
  const runtimeRef = useRef<ProjectionRuntime | null>(null);
  runtimeRef.current ??= appProjectionRuntime;
  return (
    <ProjectionContext.Provider value={runtimeRef.current}>{children}</ProjectionContext.Provider>
  );
}

export function useProjectionRuntime(): ProjectionRuntime {
  const runtime = useContext(ProjectionContext);
  if (!runtime) throw new Error("ProjectionProvider is missing");
  return runtime;
}

export function useAuthorityProjection<T>(
  serverId: string,
  selector: (projection: AuthorityProjection) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const store = useProjectionRuntime().store;
  return useSyncExternalStoreWithSelector(
    store.subscribe.bind(store),
    () => store.getSnapshot(serverId),
    () => store.getSnapshot(serverId),
    selector,
    isEqual,
  );
}

export function useAuthorityProjections<T>(
  selector: (store: AuthorityProjectionStore) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const store = useProjectionRuntime().store;
  return useSyncExternalStoreWithSelector(
    store.subscribe.bind(store),
    store.getVersion.bind(store),
    store.getVersion.bind(store),
    () => selector(store),
    isEqual,
  );
}
