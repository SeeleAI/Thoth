import { skipToken, useQuery } from "@tanstack/react-query";
import type { CheckoutCommit } from "@thoth/protocol/messages";
import { checkoutCommitsQueryKey } from "@/git/query-keys";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

const CHECKOUT_COMMITS_STALE_TIME = 30_000;

export interface ClassifiedCheckoutCommit extends CheckoutCommit {
  isOnBase: boolean;
}

export interface CheckoutCommitsData {
  baseRef: string | null;
  commits: ClassifiedCheckoutCommit[];
}

export type CheckoutCommitsQueryResult =
  | { status: "unsupported" }
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "loaded"; data: CheckoutCommitsData };

export function resolveCheckoutCommitsQueryResult(input: {
  enabled: boolean;
  capabilityPresent: boolean;
  canFetch: boolean;
  data: CheckoutCommitsData | undefined;
  error: Error | null;
}): CheckoutCommitsQueryResult {
  if (!input.capabilityPresent) return { status: "unsupported" };
  if (input.data) return { status: "loaded", data: input.data };
  if (!input.enabled) return { status: "idle" };
  if (!input.canFetch) return { status: "connecting" };
  if (input.error) return { status: "error", error: input.error };
  return { status: "loading" };
}

export function classifyCheckoutCommits(input: {
  baseRef: string | null;
  commits: CheckoutCommit[];
}): CheckoutCommitsData {
  return {
    baseRef: input.baseRef,
    commits: input.commits.map((commit) => {
      if (commit.isOnBase === undefined) {
        throw new Error("Host omitted commit base classification");
      }
      return { ...commit, isOnBase: commit.isOnBase };
    }),
  };
}

export function useCheckoutCommitsQuery(options: {
  serverId: string;
  cwd: string;
  enabled?: boolean;
}): CheckoutCommitsQueryResult {
  const { serverId, cwd, enabled = true } = options;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const capabilityPresent =
    useHostFeature(serverId, "commitsList") && useHostFeature(serverId, "commitBaseClassification");
  const canFetch = Boolean(cwd) && Boolean(client) && isConnected;
  const shouldFetch = enabled && capabilityPresent && canFetch;
  const query = useQuery<CheckoutCommitsData, Error>({
    queryKey: checkoutCommitsQueryKey(serverId, cwd),
    queryFn:
      shouldFetch && client
        ? async () => classifyCheckoutCommits(await client.listCheckoutCommits(cwd))
        : skipToken,
    staleTime: CHECKOUT_COMMITS_STALE_TIME,
  });

  return resolveCheckoutCommitsQueryResult({
    enabled,
    capabilityPresent,
    canFetch,
    data: query.data,
    error: query.error,
  });
}
