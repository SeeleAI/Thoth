/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionTreeDelta, DecisionTreeSnapshot } from "@thoth/protocol/clarify-authority";
import { DecisionTreeSidebar } from "./decision-tree-sidebar";

const mocks = vi.hoisted(() => ({
  compact: false,
  pendingCard: null as unknown,
  list: vi.fn(),
  get: vi.fn(),
  prioritize: vi.fn(),
  answer: vi.fn(),
  subscribe: vi.fn(),
  refreshState: vi.fn(),
  client: null as Record<string, unknown> | null,
  deltaHandler: null as ((delta: DecisionTreeDelta) => void) | null,
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 },
    borderWidth: { 1: 1 },
    borderRadius: { md: 6 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { medium: "500", semibold: "600" },
    colors: {
      foreground: "#f7f7f7",
      foregroundMuted: "#96999f",
      surface0: "#111",
      surface1: "#181818",
      surface2: "#222",
      surface3: "#292929",
      border: "#3a3a3a",
      borderAccent: "#303030",
      accentBright: "#65b889",
      statusWarning: "#e1a23c",
      statusSuccess: "#4caf72",
      statusDanger: "#d65a58",
      destructive: "#d65a58",
    },
  },
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => mocks.compact,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => mocks.client,
}));
vi.mock("@/projection/projection-context", () => ({
  useAuthorityProjection: () => ({
    agentId: "agent-1",
    revision: 9,
    lifecycle: mocks.pendingCard ? "awaiting_card" : "mapping",
    turn: { id: "turn-1" },
    pendingCard: mocks.pendingCard,
    backgroundTaskId: null,
    error: null,
  }),
  useProjectionRuntime: () => ({
    service: () => ({ refreshAgentThothState: mocks.refreshState }),
  }),
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (theme: unknown) => unknown)(mocks.theme)
        : factory,
  },
  useUnistyles: () => ({ theme: mocks.theme }),
}));
vi.mock("react-native-gesture-handler", () => {
  const gesture = () => {
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of ["minDistance", "onBegin", "onUpdate", "onEnd"]) {
      chain[name] = () => chain;
    }
    return chain;
  };
  return {
    Gesture: { Pan: gesture, Pinch: gesture, Simultaneous: (...values: unknown[]) => values },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});
vi.mock("react-native-reanimated", () => {
  return {
    default: { View: "div" },
    Easing: { cubic: "cubic", out: (value: unknown) => value },
    runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => false,
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
  };
});
vi.mock("react-native-svg", () => {
  const SvgStub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const ElementStub = () => null;
  return { default: SvgStub, Circle: ElementStub, Path: ElementStub, Rect: ElementStub };
});
vi.mock("lucide-react-native", () => {
  const Icon = () => <span data-icon="decision-tree" />;
  return {
    AlertTriangle: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    ChevronRight: Icon,
    ChevronUp: Icon,
    CircleHelp: Icon,
    Crosshair: Icon,
    GitBranch: Icon,
    Hand: Icon,
    Maximize2: Icon,
    Minus: Icon,
    Pin: Icon,
    Plus: Icon,
    Scissors: Icon,
    Search: Icon,
    Snowflake: Icon,
    X: Icon,
  };
});
vi.mock("@/components/clarify-decision-card", () => ({
  ClarifyDecisionCard: ({ onSubmit }: { onSubmit: (answer: unknown) => void }) => (
    <button
      data-testid="mock-clarify-submit"
      onClick={() =>
        onSubmit({
          intent: "recommend",
          questionCardId: "card-1",
          targetNodeId: "human",
          rawAnswer: "Use the recommendation",
        })
      }
    >
      Submit decision
    </button>
  ),
}));
vi.mock("@/components/intent-contract-card", () => ({
  IntentContractCard: () => <div data-testid="mock-contract-card" />,
}));

const NOW = "2026-07-31T00:00:00.000Z";

function snapshot(
  revision = 7,
  sessionId = "decision-session-1",
  createdAt = NOW,
): DecisionTreeSnapshot {
  return {
    session: {
      id: sessionId,
      workspaceId: "workspace-1",
      agentId: "agent-1",
      originTurnId: "turn-1",
      activeTurnId: "turn-1",
      requestedStrength: "dive",
      effectiveStrength: "dive",
      lifecycle: "awaiting_human",
      challengerUsed: false,
      rootNodeId: "root",
      priorityNodeId: null,
      activeCardId: mocks.pendingCard ? "card-1" : null,
      intentContract: null,
      taskId: null,
      activity: {
        state: mocks.pendingCard ? "awaiting_human" : "expanding",
        activeNodeId: "human",
        summary: "Resolving the product boundary",
        startedAt: NOW,
        updatedAt: NOW,
      },
      revision,
      createdAt,
      updatedAt: NOW,
      frozenAt: null,
    },
    nodes: [
      {
        id: "root",
        parentId: null,
        crossLinkIds: [],
        title: "Objective",
        summary: "Build the confirmed product",
        owner: "human",
        materiality: "structural",
        status: "resolved",
        resolutionRef: "turn:turn-1",
        sourceRefs: ["turn:turn-1"],
        priority: 3,
        revision: 1,
      },
      {
        id: "human",
        parentId: "root",
        crossLinkIds: ["evidence"],
        title: "Delivery boundary",
        summary: "Choose the product delivery boundary",
        owner: "human",
        materiality: "structural",
        status: "awaiting_human",
        resolutionRef: null,
        sourceRefs: [],
        priority: 2,
        revision: 1,
      },
      {
        id: "evidence",
        parentId: "root",
        crossLinkIds: [],
        title: "Workspace runtime",
        summary: "Resolved from package.json",
        owner: "evidence",
        materiality: "material",
        status: "resolved",
        resolutionRef: "evidence:package-json",
        sourceRefs: ["workspace:package.json"],
        priority: 1,
        revision: 1,
      },
    ],
    cardReceipts: [],
    revision,
  };
}

function delta(baseRevision = 7): DecisionTreeDelta {
  const current = snapshot(baseRevision + 1);
  return {
    workspaceId: "workspace-1",
    agentId: "agent-1",
    sessionId: current.session.id,
    baseRevision,
    revision: baseRevision + 1,
    session: current.session,
    nodeUpserts: [
      {
        id: "new-branch",
        parentId: "human",
        crossLinkIds: [],
        title: "New material branch",
        summary: "Added by an ordered authority delta",
        owner: "agent",
        materiality: "material",
        status: "resolved",
        resolutionRef: "agent:new-branch",
        sourceRefs: [],
        priority: 1,
        revision: 1,
      },
    ],
    removedNodeIds: [],
    cardReceipts: [],
    emittedAt: NOW,
  };
}

function pendingCard() {
  return {
    kind: "clarify_card" as const,
    status: "pending" as const,
    createdAt: NOW,
    card: {
      id: "card-1",
      sessionId: "decision-session-1",
      roundIndex: 1,
      submitted: false,
      card: {
        title: "Choose delivery",
        whyNow: "This changes the product boundary",
        publicSummary: "Waiting for delivery",
        questions: [],
        allowChoiceNotes: true,
        allowNoteOnly: true,
        allowSingleNodeRecommendation: true,
        allowSubtreeDelegation: true,
      },
    },
  };
}

beforeEach(() => {
  mocks.compact = false;
  mocks.pendingCard = null;
  mocks.deltaHandler = null;
  mocks.client ??= {
    listAgentDecisionSessions: mocks.list,
    getAgentDecisionSession: mocks.get,
    prioritizeAgentDecisionNode: mocks.prioritize,
    answerAgentThothCard: mocks.answer,
    subscribeAgentDecisionTreeDeltas: mocks.subscribe,
  };
  mocks.subscribe.mockImplementation((handler: (next: DecisionTreeDelta) => void) => {
    mocks.deltaHandler = handler;
    return () => undefined;
  });
  mocks.list.mockResolvedValue({
    sessions: [snapshot().session],
    activeSessionId: "decision-session-1",
    error: null,
  });
  mocks.get.mockResolvedValue({ snapshot: snapshot(), error: null });
  mocks.prioritize.mockResolvedValue({
    delta: null,
    conflict: false,
    duplicate: false,
    error: null,
  });
  mocks.answer.mockResolvedValue({
    accepted: true,
    conflict: false,
    state: null,
    card: null,
    decisionTreeDelta: null,
    error: null,
  });
  mocks.refreshState.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DecisionTreeSidebar", () => {
  it("renders a real hierarchy and prioritizes only through the explicit inspector command", async () => {
    render(<DecisionTreeSidebar agentId="agent-1" serverId="server-1" />);
    fireEvent.click(await screen.findByTestId("decision-tree-node-human"));
    expect(mocks.prioritize).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("decision-tree-prioritize"));
    await waitFor(() => expect(mocks.prioritize).toHaveBeenCalledTimes(1));
    expect(mocks.prioritize).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        sessionId: "decision-session-1",
        nodeId: "human",
        expectedRevision: 7,
      }),
    );
  });

  it("applies contiguous deltas locally and refetches only after a revision gap", async () => {
    render(<DecisionTreeSidebar agentId="agent-1" serverId="server-1" />);
    await screen.findByTestId("decision-tree-node-human");
    const initialGets = mocks.get.mock.calls.length;
    act(() => mocks.deltaHandler?.(delta()));
    expect(await screen.findByTestId("decision-tree-node-new-branch")).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(initialGets);
    act(() => mocks.deltaHandler?.(delta(10)));
    await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(initialGets));
  });

  it("keeps a historical Decision Session selected while the active tree receives deltas", async () => {
    const earlier = snapshot(5, "decision-session-1", "2026-07-31T00:00:00.000Z");
    const active = snapshot(7, "decision-session-2", "2026-07-31T00:01:00.000Z");
    mocks.list.mockResolvedValue({
      sessions: [active.session, earlier.session],
      activeSessionId: active.session.id,
      error: null,
    });
    mocks.get.mockImplementation(({ sessionId }: { sessionId?: string }) =>
      Promise.resolve({
        snapshot: sessionId === earlier.session.id ? earlier : active,
        error: null,
      }),
    );
    render(<DecisionTreeSidebar agentId="agent-1" serverId="server-1" />);
    fireEvent.click(await screen.findByLabelText("Previous decision"));
    await waitFor(() =>
      expect(mocks.get).toHaveBeenLastCalledWith({
        agentId: "agent-1",
        sessionId: earlier.session.id,
      }),
    );
    const callsBeforeDelta = mocks.get.mock.calls.length;
    act(() =>
      mocks.deltaHandler?.({
        ...delta(),
        sessionId: active.session.id,
        session: { ...active.session, revision: 8 },
      }),
    );
    expect(mocks.get).toHaveBeenCalledTimes(callsBeforeDelta);
  });

  it("navigates the visible tree with arrow keys", async () => {
    render(<DecisionTreeSidebar agentId="agent-1" serverId="server-1" />);
    const human = await screen.findByTestId("decision-tree-node-human");
    fireEvent.keyDown(human, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(
        within(screen.getByTestId("decision-tree-inspector")).getByText("Objective"),
      ).toBeTruthy(),
    );
  });

  it("keeps the only actionable Card in the tree inspector and replaces it with a receipt", async () => {
    mocks.pendingCard = pendingCard();
    mocks.get.mockResolvedValue({ snapshot: snapshot(), error: null });
    render(<DecisionTreeSidebar agentId="agent-1" serverId="server-1" />);
    fireEvent.click(await screen.findByTestId("mock-clarify-submit"));
    await waitFor(() => expect(mocks.answer).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("decision-tree-card-receipt")).toBeTruthy();
    expect(screen.queryByTestId("mock-clarify-submit")).toBeNull();
  });

  it("opens the full-screen tree automatically when a compact client needs a decision", async () => {
    mocks.compact = true;
    mocks.pendingCard = pendingCard();
    render(<DecisionTreeSidebar agentId="agent-1" serverId="server-1" />);
    expect(await screen.findByTestId("decision-tree-fullscreen")).toBeTruthy();
    expect(screen.getByText("Decision needed")).toBeTruthy();
  });
});
