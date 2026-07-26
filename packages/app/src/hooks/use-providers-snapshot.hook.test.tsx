// @vitest-environment jsdom

import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@thoth/protocol/agent-types";
import type {
  ProvidersSnapshotClient,
  ProvidersSnapshotUpdateMessage,
} from "./use-providers-snapshot";

const hostState = vi.hoisted(() => ({
  client: null as
    | (ProvidersSnapshotClient & {
        on: (
          event: "providers_snapshot_update",
          listener: (message: ProvidersSnapshotUpdateMessage) => void,
        ) => () => void;
      })
    | null,
  connected: true,
  supportsSnapshot: true,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => hostState.client,
  useHostRuntimeIsConnected: () => hostState.connected,
}));

vi.mock("@/runtime/host-features", () => ({
  useHostFeature: () => hostState.supportsSnapshot,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { useProvidersSnapshot } from "./use-providers-snapshot";

function snapshot(entries: ProviderSnapshotEntry[], generatedAt: string) {
  return {
    entries,
    generatedAt,
    requestId: generatedAt,
  };
}

function providerEntry(status: ProviderSnapshotEntry["status"]): ProviderSnapshotEntry {
  return {
    provider: "codex",
    status,
    enabled: true,
    ...(status === "ready"
      ? { models: [{ provider: "codex" as const, id: "gpt-5.4", label: "GPT-5.4" }] }
      : {}),
  };
}

function createWrapper(): React.ComponentType<{ children: ReactNode }> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useProvidersSnapshot", () => {
  beforeEach(() => {
    hostState.connected = true;
    hostState.supportsSnapshot = true;
  });

  afterEach(() => {
    hostState.client = null;
    vi.clearAllMocks();
  });

  it("recovers an initial loading snapshot by refreshing and fetching the resolved snapshot", async () => {
    const readySnapshot = snapshot([providerEntry("ready")], "2026-01-01T00:00:01.000Z");
    const getProvidersSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot([providerEntry("loading")], "2026-01-01T00:00:00.000Z"))
      .mockResolvedValue(readySnapshot);
    const refreshProvidersSnapshot = vi.fn().mockResolvedValue({
      acknowledged: true,
      requestId: "refresh-1",
    });
    const on = vi.fn(() => () => undefined);
    hostState.client = {
      getProvidersSnapshot,
      refreshProvidersSnapshot,
      on,
    };

    const { result } = renderHook(() => useProvidersSnapshot("server-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.entries?.[0]?.status).toBe("ready");
    });

    expect(refreshProvidersSnapshot).toHaveBeenCalledTimes(1);
    expect(refreshProvidersSnapshot).toHaveBeenCalledWith({});
    expect(getProvidersSnapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.entries?.[0]?.models).toHaveLength(1);
  });
});
