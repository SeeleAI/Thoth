import { useMemo, useSyncExternalStore } from "react";
import {
  getHostRuntimeStore,
  type HostServerInfo,
  useHostRuntimeServerInfo,
} from "@/runtime/host-runtime";

export type HostFeatureName = keyof NonNullable<HostServerInfo["features"]>;

export function hostSupportsFeature(
  serverInfo: HostServerInfo | null | undefined,
  feature: HostFeatureName,
): boolean {
  return serverInfo?.features?.[feature] === true;
}

export function useHostFeature(
  serverId: string | null | undefined,
  feature: HostFeatureName,
): boolean {
  const normalizedServerId = serverId?.trim() ?? "";
  return hostSupportsFeature(useHostRuntimeServerInfo(normalizedServerId), feature);
}

export function useHostFeatureMap(
  serverIds: readonly string[],
  feature: HostFeatureName,
): ReadonlyMap<string, boolean> {
  const store = getHostRuntimeStore();
  const version = useSyncExternalStore(
    (onStoreChange) => store.subscribeAll(onStoreChange),
    () => store.getVersion(),
    () => store.getVersion(),
  );

  return useMemo(() => {
    void version;
    return new Map(
      serverIds.map(
        (serverId) =>
          [
            serverId,
            hostSupportsFeature(store.getSnapshot(serverId)?.serverInfo, feature),
          ] as const,
      ),
    );
  }, [feature, serverIds, store, version]);
}
