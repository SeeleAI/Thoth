/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionProjection, TaskProjection } from "@thoth/protocol/task-authority";
import {
  buildBackgroundTasksSurfaceKey,
  useBackgroundTasksSurfaceStore,
} from "@/stores/background-tasks-surface-store";
import { TasksSurface, shouldForwardLoopPhaseTimelineWheel } from "./background-tasks-panel";

const { clientMock, authorityListeners, routerPush, theme } = vi.hoisted(() => ({
  authorityListeners: new Set<(payload: any) => void>(),
  clientMock: {
    listTasks: vi.fn(),
    getTask: vi.fn(),
    commandTask: vi.fn(),
    answerTaskDecision: vi.fn(),
    resolveExecutionApproval: vi.fn(),
    getExecutionTimeline: vi.fn(),
    subscribeWorkspaceAuthorityUpdates: vi.fn((listener: (payload: any) => void) => {
      authorityListeners.add(listener);
      return () => authorityListeners.delete(listener);
    }),
  },
  routerPush: vi.fn(),
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 },
    borderRadius: { md: 8 },
    borderWidth: { 1: 1 },
    fontSize: { xs: 11, sm: 13, base: 15, lg: 18 },
    fontWeight: { medium: "500", semibold: "600" },
    colors: {
      accentBright: "#3ddc97",
      border: "#2a2f38",
      borderAccent: "#66d9ef",
      destructive: "#ff6b6b",
      foreground: "#f7f7f7",
      foregroundMuted: "#9aa4b2",
      surface0: "#080a0f",
      surface1: "#10151f",
      surface2: "#18202d",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  withUnistyles: (Component: React.ComponentType<any>) =>
    function ThemedIcon(props: Record<string, unknown>) {
      const { uniProps: _uniProps, ...rest } = props;
      return React.createElement(Component, rest);
    },
  useUnistyles: () => ({ theme, rt: { breakpoint: "lg" } }),
}));

vi.mock("lucide-react-native", () => {
  const Icon = (props: Record<string, unknown>) => React.createElement("span", props);
  return {
    CheckCircle2: Icon,
    CalendarClock: Icon,
    Clock3: Icon,
    ListTodo: Icon,
    Pause: Icon,
    Play: Icon,
    RefreshCw: Icon,
    Square: Icon,
    XCircle: Icon,
  };
});

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => clientMock,
}));

vi.mock("expo-router", () => ({ router: { push: routerPush } }));

vi.mock("@/components/resize-handle", () => ({
  ResizeHandle: () => React.createElement("div", { "data-testid": "resize-handle" }),
}));

function task(overrides: Partial<TaskProjection> = {}): TaskProjection {
  const now = "2026-07-21T10:00:00.000Z";
  return {
    id: "task-1",
    workspaceId: "workspace-1",
    sourceAgentWorkspaceId: "workspace-1",
    sourceAgentId: "agent-1",
    mode: "loop",
    title: "Verified task",
    intentContract: {
      id: "contract-1",
      workspaceId: "workspace-1",
      sourceAgentId: "agent-1",
      taskId: "task-1",
      title: "Verified task",
      objective: "Complete the approved work.",
      nonGoals: [],
      invariants: ["Keep authority durable."],
      acceptanceClaims: [
        {
          id: "claim-1",
          statement: "Review passes.",
          status: "open",
          evidenceRefs: [],
          revision: 1,
        },
      ],
      riskBoundary: [],
      humanDecisionRefs: ["decision-contract"],
      escalationPolicy: { returnToHumanWhen: [], finalConfirmation: "automatic" },
      status: "confirmed",
      revision: 1,
      confirmedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    status: "running",
    summary: "Execute is running.",
    currentExecutionId: "execution-1",
    currentWorkUnitId: "work-unit-1",
    workingSet: {
      taskId: "task-1",
      activeGap: "Implement the approved contract.",
      currentUnderstanding: "The durable authority is ready.",
      currentHypothesis: "One focused implementation closes the gap.",
      nextMove: "Implement and collect evidence.",
      relevantEvidenceRefs: [],
      rejectedRoutes: [],
      blockers: [],
      latestReviewDecisionId: null,
      noProgressCount: 0,
      revision: 1,
      updatedAt: now,
    },
    workUnits: [
      {
        id: "work-unit-1",
        taskId: "task-1",
        cycleId: "cycle-1",
        title: "Implement",
        activeGap: "Implement the approved contract.",
        progressClaim: "Implementation started.",
        unresolvedGap: "Tests have not run.",
        evidenceRefs: [],
        status: "active",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    latestReview: null,
    completionAuthority: "none",
    origin: null,
    pendingDecision: null,
    budget: {
      strength: "light",
      usedNonCompleteReviews: 0,
      maxNonCompleteReviews: 5,
      activeDurationMs: 0,
      tokenCount: 0,
      toolCallCount: 0,
    },
    pendingControl: null,
    revision: 3,
    createdAt: "2026-07-21T10:00:00.000Z",
    updatedAt: "2026-07-21T10:01:00.000Z",
    ...overrides,
  };
}

function execution(overrides: Partial<ExecutionProjection> = {}): ExecutionProjection {
  return {
    id: "execution-1",
    taskId: "task-1",
    workUnitId: "work-unit-1",
    cycleId: "cycle-1",
    phase: "execute",
    providerThreadId: "thread-1",
    status: "awaiting_provider",
    generation: "generation-1",
    attachment: {
      id: "attachment-1",
      bundleId: "thoth.loop",
      bundleDigest: "sha256-loop",
      status: "attached",
      attachedAt: "2026-07-21T10:00:00.000Z",
    },
    startedAt: "2026-07-21T10:00:00.000Z",
    lastActivityAt: "2026-07-21T10:00:02.000Z",
    completedAt: null,
    summary: null,
    revision: 2,
    ...overrides,
    runModeReceipt: overrides.runModeReceipt ?? null,
    pendingApproval: overrides.pendingApproval ?? null,
  };
}

function installResponses(currentTask = task(), currentExecution = execution()): void {
  clientMock.listTasks.mockResolvedValue({
    requestId: "list-1",
    tasks: [currentTask],
    error: null,
  });
  clientMock.getTask.mockResolvedValue({
    requestId: "get-1",
    task: currentTask,
    executions: [currentExecution],
    decisions: [],
    reviews: [],
    evidence: [],
    error: null,
  });
  clientMock.getExecutionTimeline.mockResolvedValue({
    requestId: "timeline-1",
    execution: currentExecution,
    entries: [
      {
        seq: 1,
        occurredAt: "2026-07-21T10:00:01.000Z",
        item: { text: "Provider started PlanExec." },
      },
    ],
    nextBeforeSeq: null,
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authorityListeners.clear();
  useBackgroundTasksSurfaceStore.setState({ byWorkspaceKey: {} });
  installResponses();
});

afterEach(() => cleanup());

describe("TasksSurface", () => {
  it("renders Task and Execution projections with the RuntimeBundle receipt", async () => {
    render(<TasksSurface serverId="server-1" workspaceId="workspace-1" />);

    expect(await screen.findByText("Verified task")).toBeTruthy();
    expect(await screen.findByText(/thoth\.loop.*attached.*sha256-loop/)).toBeTruthy();
    expect(await screen.findByText("Provider started PlanExec.")).toBeTruthy();
    expect(clientMock.listTasks).toHaveBeenCalledWith("workspace-1");
    expect(clientMock.getTask).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      taskId: "task-1",
    });
  });

  it("renders cancel_requested as Canceling without a running spinner", async () => {
    const stoppingTask = task({
      status: "stopping",
      summary: "Stop requested.",
      revision: 4,
    });
    const cancelingExecution = execution({ status: "cancel_requested", revision: 3 });
    clientMock.commandTask.mockResolvedValue({
      requestId: "command-1",
      task: stoppingTask,
      execution: cancelingExecution,
      conflict: false,
      duplicate: false,
      error: null,
    });

    render(<TasksSurface serverId="server-1" workspaceId="workspace-1" />);
    const stop = await screen.findByTestId("background-task-stop");
    fireEvent.click(stop);

    await waitFor(() => expect(clientMock.commandTask).toHaveBeenCalled());
    expect(screen.getAllByText("Canceling").length).toBeGreaterThan(0);
  });

  it("renders the approval deadline and resolves Implement through Task authority", async () => {
    const pendingApproval = {
      id: "approval-1",
      taskId: "task-1",
      executionId: "execution-1",
      kind: "implement" as const,
      title: "Implement native Plan",
      description: "Review the provider-native Plan before implementation.",
      displayed: { plan: "Inspect, implement, verify." },
      deadlineAt: new Date(Date.now() + 20_000).toISOString(),
      status: "pending" as const,
      resolution: null,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const awaiting = execution({
      status: "awaiting_implementation",
      pendingApproval,
      latestApproval: pendingApproval,
    });
    installResponses(task(), awaiting);
    clientMock.resolveExecutionApproval.mockResolvedValue({
      requestId: "approval-response-1",
      task: task({ revision: 4 }),
      execution: execution({ status: "implementing", revision: 3 }),
      approval: { ...pendingApproval, status: "allowed", revision: 2 },
      conflict: false,
      duplicate: false,
      error: null,
    });

    render(<TasksSurface serverId="server-1" workspaceId="workspace-1" />);
    expect(await screen.findByText("Implement native Plan")).toBeTruthy();
    expect(screen.getByTestId("background-execution-approval-countdown").textContent).toMatch(
      /Automatic approval in (19|20)s/,
    );
    fireEvent.click(screen.getByTestId("background-execution-approval-accept"));

    await waitFor(() =>
      expect(clientMock.resolveExecutionApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          taskId: "task-1",
          executionId: "execution-1",
          approvalId: "approval-1",
          decision: "implement",
          expectedRevision: 1,
        }),
      ),
    );
  });

  it("shows the daemon as the actor for a timeout approval", async () => {
    const approved = {
      id: "approval-auto",
      taskId: "task-1",
      executionId: "execution-1",
      kind: "command" as const,
      title: "Run validation",
      description: null,
      displayed: { command: "npm test" },
      deadlineAt: "2026-07-22T00:00:20.000Z",
      status: "allowed" as const,
      resolution: {
        decision: "allow" as const,
        actorId: "daemon:auto-approval-timeout",
        resolvedAt: "2026-07-22T00:00:20.000Z",
      },
      revision: 2,
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:20.000Z",
    };
    installResponses(task(), execution({ latestApproval: approved }));

    render(<TasksSurface serverId="server-1" workspaceId="workspace-1" />);

    expect((await screen.findByTestId("background-execution-approval-result")).textContent).toBe(
      "Last approval: allow by daemon:auto-approval-timeout",
    );
  });

  it("answers a pending Task decision through the authority API", async () => {
    const awaiting = task({
      status: "awaiting_user",
      currentExecutionId: null,
      pendingDecision: {
        id: "decision-1",
        kind: "contract_change",
        title: "Choose target",
        question: "Which target should the task use?",
        affectedContractFields: ["objective"],
        options: [
          { id: "a", label: "Target A" },
          { id: "b", label: "Target B" },
        ],
        createdAt: "2026-07-21T10:02:00.000Z",
      },
      revision: 5,
    });
    installResponses(awaiting, execution({ status: "succeeded" }));
    clientMock.answerTaskDecision.mockResolvedValue({
      requestId: "answer-1",
      task: task({ status: "queued", revision: 6 }),
      decision: null,
      conflict: false,
      duplicate: false,
      error: null,
    });

    render(<TasksSurface serverId="server-1" workspaceId="workspace-1" />);
    fireEvent.click(await screen.findByTestId("loop-user-decision-option-b"));
    fireEvent.click(screen.getByTestId("loop-user-decision-submit"));

    await waitFor(() =>
      expect(clientMock.answerTaskDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          taskId: "task-1",
          decisionId: "decision-1",
          optionId: "b",
          expectedRevision: 5,
        }),
      ),
    );
  });

  it("ignores authority updates from another Workspace", async () => {
    render(<TasksSurface serverId="server-1" workspaceId="workspace-1" />);
    await screen.findAllByText("Verified task");
    clientMock.listTasks.mockClear();

    for (const listener of authorityListeners) {
      listener({
        workspaceId: "workspace-2",
        seq: 2,
        changedTaskIds: ["task-1"],
        changedExecutionIds: [],
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(clientMock.listTasks).not.toHaveBeenCalled();
  });

  it("navigates a scheduled Task back to its owner Workspace Schedule", async () => {
    const scheduled = task({
      origin: {
        type: "schedule",
        ownerWorkspaceId: "workspace-owner",
        scheduleId: "schedule-1",
        runId: "run-1",
      },
    });
    installResponses(scheduled, execution());

    render(<TasksSurface serverId="server-1" workspaceId="workspace-execution" />);
    fireEvent.click(await screen.findByTestId("background-task-open-schedule"));

    const key = buildBackgroundTasksSurfaceKey({
      serverId: "server-1",
      workspaceId: "workspace-owner",
    });
    expect(useBackgroundTasksSurfaceStore.getState().byWorkspaceKey[key]).toEqual(
      expect.objectContaining({
        open: true,
        activeTab: "schedules",
        selectedScheduleId: "schedule-1",
      }),
    );
    expect(routerPush).toHaveBeenCalledWith("/h/server-1/workspace/workspace-owner/tasks");
  });
});

describe("phase timeline wheel forwarding", () => {
  it("forwards only after the inner timeline reaches its edge", () => {
    expect(
      shouldForwardLoopPhaseTimelineWheel({
        deltaY: 120,
        inner: { clientHeight: 100, scrollHeight: 400, scrollTop: 100 },
        outer: { clientHeight: 500, scrollHeight: 1200, scrollTop: 200 },
      }),
    ).toBe(false);
    expect(
      shouldForwardLoopPhaseTimelineWheel({
        deltaY: 120,
        inner: { clientHeight: 100, scrollHeight: 400, scrollTop: 300 },
        outer: { clientHeight: 500, scrollHeight: 1200, scrollTop: 200 },
      }),
    ).toBe(true);
  });
});
