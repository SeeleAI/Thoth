/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClarifySessionProjection } from "@thoth/protocol/clarify-authority";
import { ClarifyDecisionMap } from "./clarify-decision-map";

const mocks = vi.hoisted(() => ({
  compact: false,
  getSession: vi.fn(),
  prioritize: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 },
    borderWidth: { 1: 1 },
    borderRadius: { md: 6 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { medium: "500", semibold: "600" },
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface0: "#000",
      surface1: "#111",
      border: "#444",
      accentBright: "#0af",
      destructive: "#f44",
    },
  },
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => mocks.compact,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({
    getAgentClarifySession: mocks.getSession,
    prioritizeAgentClarifyNode: mocks.prioritize,
    subscribeAgentClarifySessionUpdates: mocks.subscribe,
  }),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(mocks.theme) : factory),
  },
}));
vi.mock("lucide-react-native", () => ({
  GitBranch: () => React.createElement("span", { "data-icon": "GitBranch" }),
  X: () => React.createElement("span", { "data-icon": "X" }),
}));

function session(nodeCount = 3): ClarifySessionProjection {
  const now = "2026-07-30T00:00:00.000Z";
  return {
    id: "clarify-session-1",
    workspaceId: "workspace-1",
    agentId: "agent-1",
    turnId: "turn-1",
    requestedStrength: "dive",
    effectiveStrength: "dive",
    lifecycle: "awaiting_human",
    challengerUsed: false,
    priorityNodeId: null,
    intentContract: null,
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `node-${index}`,
      parentIds: index === 0 ? [] : [`node-${Math.floor((index - 1) / 3)}`],
      title: `Decision ${index}`,
      owner: index % 3 === 0 ? ("human" as const) : ("agent" as const),
      materiality: index < 4 ? ("structural" as const) : ("material" as const),
      status: index % 3 === 0 ? ("awaiting_human" as const) : ("resolved" as const),
      resolutionRef: index % 3 === 0 ? null : `agent:resolution-${index}`,
      sourceRefs: index % 3 === 0 ? [] : ["workspace:package.json"],
      priority: nodeCount - index,
      revision: 1,
    })),
    revision: 7,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  mocks.compact = false;
  mocks.getSession.mockResolvedValue({ session: session(), error: null });
  mocks.prioritize.mockImplementation(async (input: { nodeId: string }) => ({
    session: { ...session(), priorityNodeId: input.nodeId, revision: 8 },
    conflict: false,
    duplicate: false,
    error: null,
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ClarifyDecisionMap", () => {
  it("renders the persistent tree and prioritizes only a Human-owned frontier node", async () => {
    render(<ClarifyDecisionMap serverId="server-1" agentId="agent-1" />);
    expect(await screen.findByText("Decision 0")).toBeTruthy();
    expect(screen.getByText("human | structural | awaiting_human")).toBeTruthy();
    fireEvent.click(screen.getByTestId("clarify-decision-node-node-0"));
    await waitFor(() => expect(mocks.prioritize).toHaveBeenCalledTimes(1));
    expect(mocks.prioritize).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        sessionId: "clarify-session-1",
        nodeId: "node-0",
        expectedRevision: 7,
      }),
    );
    fireEvent.click(screen.getByTestId("clarify-decision-node-node-1"));
    expect(mocks.prioritize).toHaveBeenCalledTimes(1);
  });

  it("keeps a 200-node map virtualized and exposes a full-screen compact launcher", async () => {
    mocks.compact = true;
    mocks.getSession.mockResolvedValue({ session: session(205), error: null });
    render(<ClarifyDecisionMap serverId="server-1" agentId="agent-1" />);
    const open = await screen.findByTestId("clarify-decision-map-open");
    expect(open.getAttribute("aria-label")).toBe("Open Decision Map");
    fireEvent.click(open);
    expect(await screen.findByTestId("clarify-decision-map-fullscreen")).toBeTruthy();
    expect(screen.getByText("Decision 0")).toBeTruthy();
  });
});
