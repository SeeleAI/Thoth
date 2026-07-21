/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionProjection, TaskProjection } from "@thoth/protocol/task-authority";
import {
  BackgroundTasksSurface,
  shouldForwardLoopPhaseTimelineWheel,
} from "./background-tasks-panel";

const { clientMock, authorityListeners, theme } = vi.hoisted(() => ({
  authorityListeners: new Set<(payload: any) => void>(),
  clientMock: {
    listTasks: vi.fn(),
    getTask: vi.fn(),
    commandTask: vi.fn(),
    answerTaskDecision: vi.fn(),
    getExecutionTimeline: vi.fn(),
    subscribeWorkspaceAuthorityUpdates: vi.fn((listener: (payload: any) => void) => {
      authorityListeners.add(listener);
      return () => authorityListeners.delete(listener);
    }),
  },
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

vi.mock("@/components/resize-handle", () => ({
  ResizeHandle: () => React.createElement("div", { "data-testid": "resize-handle" }),
}));

function task(overrides: Partial<TaskProjection> = {}): TaskProjection {
  return {
    id: "task-1",
    workspaceId: "workspace-1",
    sourceAgentId: "agent-1",
    mode: "loop",
    title: "Verified task",
    goal: "Complete the approved work.",
    constraints: ["Keep authority durable."],
    acceptance: ["Review passes."],
    status: "running",
    summary: "PlanExec is running.",
    currentGoalId: "goal-1",
    currentExecutionId: "execution-1",
    goals: [
      {
        id: "goal-1",
        order: 1,
        title: "Implement",
        goal: "Implement the approved contract.",
        constraints: [],
        acceptance: ["Tests pass."],
        status: "running",
        revision: 1,
      },
    ],
    latestReviewDirection: null,
    pendingDecision: null,
    budget: {
      strength: "light",
      usedFailedReviews: 0,
      maxFailedReviews: 5,
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
    goalId: "goal-1",
    phaseRunId: "phase-1",
    phase: "planexec",
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
  installResponses();
});

afterEach(() => cleanup());

describe("BackgroundTasksSurface", () => {
  it("renders Task and Execution projections with the RuntimeBundle receipt", async () => {
    render(<BackgroundTasksSurface serverId="server-1" workspaceId="workspace-1" />);

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

    render(<BackgroundTasksSurface serverId="server-1" workspaceId="workspace-1" />);
    const stop = await screen.findByTestId("background-task-stop");
    fireEvent.click(stop);

    await waitFor(() => expect(clientMock.commandTask).toHaveBeenCalled());
    expect(screen.getAllByText("Canceling").length).toBeGreaterThan(0);
  });

  it("answers a pending Task decision through the authority API", async () => {
    const awaiting = task({
      status: "awaiting_user",
      currentExecutionId: null,
      pendingDecision: {
        id: "decision-1",
        title: "Choose target",
        question: "Which target should the task use?",
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

    render(<BackgroundTasksSurface serverId="server-1" workspaceId="workspace-1" />);
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
    render(<BackgroundTasksSurface serverId="server-1" workspaceId="workspace-1" />);
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
