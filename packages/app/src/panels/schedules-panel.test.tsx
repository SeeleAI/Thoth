/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleSummary, StoredSchedule } from "@thoth/protocol/schedule/types";
import { SchedulesPanel } from "./schedules-panel";

const { clientMock, routerPush, updateSurface, theme } = vi.hoisted(() => ({
  clientMock: {
    scheduleList: vi.fn(),
    scheduleInspect: vi.fn(),
    scheduleCreate: vi.fn(),
    scheduleUpdate: vi.fn(),
    schedulePause: vi.fn(),
    scheduleResume: vi.fn(),
    scheduleRunOnce: vi.fn(),
    scheduleDelete: vi.fn(),
    fetchAgents: vi.fn(),
    listTasks: vi.fn(),
  },
  routerPush: vi.fn(),
  updateSurface: vi.fn(),
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    borderRadius: { md: 8 },
    borderWidth: { 1: 1 },
    fontSize: { sm: 13, base: 15, lg: 18, xl: 22 },
    fontWeight: { medium: "500", semibold: "600" },
    colors: {
      accentBright: "#3ddc97",
      border: "#2a2f38",
      destructive: "#ff6b6b",
      foreground: "#f7f7f7",
      foregroundMuted: "#9aa4b2",
      surface0: "#080a0f",
      surface1: "#10151f",
      surface2: "#18202d",
      surface3: "#202a38",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
}));

vi.mock("lucide-react-native", () => {
  const Icon = (props: Record<string, unknown>) => React.createElement("span", props);
  return {
    CalendarClock: Icon,
    Pause: Icon,
    Play: Icon,
    Plus: Icon,
    RefreshCw: Icon,
    Save: Icon,
    Trash2: Icon,
  };
});

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => clientMock,
}));

vi.mock("@/stores/background-tasks-surface-store", () => {
  const state = {
    byWorkspaceKey: {},
    updateSurface,
  };
  return {
    buildBackgroundTasksSurfaceKey: ({ serverId, workspaceId }: Record<string, string>) =>
      `${serverId}:${workspaceId}`,
    useBackgroundTasksSurfaceStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

vi.mock("expo-router", () => ({ router: { push: routerPush } }));

const AGENT_ID = "11111111-1111-4111-8111-111111111111";

function schedule(overrides: Partial<StoredSchedule> = {}): StoredSchedule {
  return {
    id: "schedule-1",
    name: "Nightly verification",
    prompt: "Run the complete verification.",
    intentContractId: "contract-1",
    cadence: { type: "every", everyMs: 3_600_000 },
    target: {
      type: "new-agent",
      config: {
        provider: "codex",
        model: "gpt-5",
        modeId: "default",
        isolation: "same-workspace",
      },
    },
    status: "active",
    createdAt: "2026-07-28T08:00:00.000Z",
    updatedAt: "2026-07-28T08:00:00.000Z",
    nextRunAt: "2026-07-29T08:00:00.000Z",
    lastRunAt: "2026-07-28T08:00:00.000Z",
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    runs: [
      {
        id: "run-current",
        workspaceId: "workspace-execution",
        taskId: "task-scheduled",
        executionId: "execution-scheduled",
        scheduledFor: "2026-07-28T08:00:00.000Z",
        startedAt: "2026-07-28T08:00:01.000Z",
        endedAt: "2026-07-28T08:00:10.000Z",
        status: "succeeded",
        agentId: AGENT_ID,
        output: "All checks passed.",
        error: null,
      },
      {
        id: "run-legacy",
        workspaceId: null,
        taskId: "task-legacy",
        executionId: "execution-legacy",
        scheduledFor: "2026-07-27T08:00:00.000Z",
        startedAt: "2026-07-27T08:00:01.000Z",
        endedAt: "2026-07-27T08:00:02.000Z",
        status: "failed",
        agentId: null,
        output: null,
        error: "Legacy execution workspace is unknown.",
      },
    ],
    ...overrides,
  };
}

function summary(value: StoredSchedule): ScheduleSummary {
  const { runs: _runs, ...scheduleSummary } = value;
  return scheduleSummary;
}

function installResponses(value = schedule()): void {
  clientMock.scheduleList.mockResolvedValue({
    requestId: "list-1",
    schedules: [summary(value)],
    error: null,
  });
  clientMock.scheduleInspect.mockResolvedValue({
    requestId: "inspect-1",
    schedule: value,
    error: null,
  });
  clientMock.fetchAgents.mockResolvedValue({
    entries: [
      {
        agent: {
          id: AGENT_ID,
          workspaceId: "workspace-1",
          title: "Existing Agent",
          archivedAt: null,
        },
      },
    ],
  });
  clientMock.listTasks.mockResolvedValue({
    requestId: "tasks-1",
    tasks: [
      {
        intentContract: {
          id: "contract-1",
          title: "Verified schedule contract",
          objective: "Run the complete verification.",
          status: "confirmed",
        },
      },
    ],
    error: null,
  });
  clientMock.scheduleCreate.mockResolvedValue({
    requestId: "create-1",
    schedule: summary(value),
    error: null,
  });
  clientMock.scheduleUpdate.mockResolvedValue({
    requestId: "update-1",
    schedule: value,
    error: null,
  });
  clientMock.schedulePause.mockResolvedValue({
    requestId: "pause-1",
    schedule: summary({ ...value, status: "paused" }),
    error: null,
  });
  clientMock.scheduleResume.mockResolvedValue({
    requestId: "resume-1",
    schedule: summary({ ...value, status: "active" }),
    error: null,
  });
  clientMock.scheduleRunOnce.mockResolvedValue({
    requestId: "run-1",
    schedule: value,
    error: null,
  });
  clientMock.scheduleDelete.mockResolvedValue({
    requestId: "delete-1",
    scheduleId: value.id,
    error: null,
  });
}

function change(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  installResponses();
});

afterEach(() => cleanup());

describe("SchedulesPanel", () => {
  it("creates a cron Schedule for a new Agent with worktree isolation and execution limits", async () => {
    clientMock.scheduleList.mockResolvedValue({
      requestId: "list-empty",
      schedules: [],
      error: null,
    });
    render(<SchedulesPanel serverId="server-1" workspaceId="workspace-1" />);

    fireEvent.click(await screen.findByTestId("schedule-create-open"));
    change("schedule-name", "Weekly audit");
    change("schedule-prompt", "Audit the Workspace every week.");
    fireEvent.click(screen.getByTestId("schedule-intent-contract-contract-1"));
    fireEvent.click(screen.getByTestId("schedule-cadence-cron"));
    change("schedule-cron", "30 9 * * 1");
    change("schedule-timezone", "America/New_York");
    change("schedule-provider", "codex");
    change("schedule-model", "gpt-5");
    change("schedule-mode", "default");
    fireEvent.click(screen.getByTestId("schedule-isolation-worktree"));
    change("schedule-max-runs", "8");
    change("schedule-expires-at", "2027-01-01T00:00:00.000Z");
    fireEvent.click(screen.getByTestId("schedule-create-submit"));

    await waitFor(() =>
      expect(clientMock.scheduleCreate).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        name: "Weekly audit",
        prompt: "Audit the Workspace every week.",
        intentContractId: "contract-1",
        cadence: {
          type: "cron",
          expression: "30 9 * * 1",
          timezone: "America/New_York",
        },
        target: {
          type: "new-agent",
          config: {
            provider: "codex",
            model: "gpt-5",
            modeId: "default",
            isolation: "worktree",
          },
        },
        maxRuns: 8,
        expiresAt: "2027-01-01T00:00:00.000Z",
        runOnCreate: true,
      }),
    );
  });

  it("creates an interval Schedule targeting an existing Workspace Agent", async () => {
    clientMock.scheduleList.mockResolvedValue({
      requestId: "list-empty",
      schedules: [],
      error: null,
    });
    render(<SchedulesPanel serverId="server-1" workspaceId="workspace-1" />);

    fireEvent.click(await screen.findByTestId("schedule-create-open"));
    change("schedule-prompt", "Continue the existing Agent every 15 minutes.");
    fireEvent.click(screen.getByTestId("schedule-intent-contract-contract-1"));
    change("schedule-every-minutes", "15");
    fireEvent.click(screen.getByTestId("schedule-target-existing-agent"));
    fireEvent.click(screen.getByTestId(`schedule-agent-${AGENT_ID}`));
    fireEvent.click(screen.getByTestId("schedule-create-submit"));

    await waitFor(() =>
      expect(clientMock.scheduleCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          intentContractId: "contract-1",
          cadence: { type: "every", everyMs: 900_000 },
          target: { type: "agent", agentId: AGENT_ID },
          runOnCreate: true,
        }),
      ),
    );
  });

  it("edits a new-Agent Schedule through the semantic Client", async () => {
    render(<SchedulesPanel serverId="server-1" workspaceId="workspace-1" />);
    fireEvent.click(await screen.findByTestId("schedule-edit-open"));
    change("schedule-prompt", "Run the updated verification.");
    fireEvent.click(screen.getByTestId("schedule-isolation-worktree"));
    change("schedule-max-runs", "3");
    fireEvent.click(screen.getByTestId("schedule-edit-submit"));

    await waitFor(() =>
      expect(clientMock.scheduleUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          id: "schedule-1",
          prompt: "Run the updated verification.",
          intentContractId: "contract-1",
          newAgentConfig: expect.objectContaining({
            provider: "codex",
            isolation: "worktree",
          }),
          maxRuns: 3,
        }),
      ),
    );
  });

  it("pauses, runs immediately, and deletes only after explicit confirmation", async () => {
    render(<SchedulesPanel serverId="server-1" workspaceId="workspace-1" />);
    await screen.findByTestId("schedule-detail");

    fireEvent.click(screen.getByTestId("schedule-pause"));
    await waitFor(() =>
      expect(clientMock.schedulePause).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        id: "schedule-1",
      }),
    );
    await waitFor(() => expect(clientMock.scheduleInspect.mock.calls.length).toBeGreaterThan(1));

    fireEvent.click(screen.getByTestId("schedule-run-now"));
    await waitFor(() =>
      expect(clientMock.scheduleRunOnce).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        id: "schedule-1",
      }),
    );
    await waitFor(() => expect(clientMock.scheduleInspect.mock.calls.length).toBeGreaterThan(2));

    fireEvent.click(screen.getByTestId("schedule-delete"));
    expect(clientMock.scheduleDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Confirm delete")).toBeTruthy();
    fireEvent.click(screen.getByTestId("schedule-delete"));
    await waitFor(() =>
      expect(clientMock.scheduleDelete).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        id: "schedule-1",
      }),
    );
  });

  it("resumes a paused Schedule", async () => {
    const paused = schedule({ status: "paused", pausedAt: "2026-07-28T09:00:00.000Z" });
    installResponses(paused);
    render(<SchedulesPanel serverId="server-1" workspaceId="workspace-1" />);

    fireEvent.click(await screen.findByTestId("schedule-resume"));
    await waitFor(() =>
      expect(clientMock.scheduleResume).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        id: "schedule-1",
      }),
    );
  });

  it("renders run output/error and navigates only when execution Workspace authority is known", async () => {
    render(<SchedulesPanel serverId="server-1" workspaceId="workspace-1" />);

    expect(await screen.findByText("All checks passed.")).toBeTruthy();
    expect(screen.getByText("Legacy execution workspace is unknown.")).toBeTruthy();
    expect(screen.getByText("Legacy Task unavailable")).toBeTruthy();
    fireEvent.click(screen.getByTestId("schedule-open-task-run-current"));

    expect(updateSurface).toHaveBeenCalledWith({
      serverId: "server-1",
      workspaceId: "workspace-execution",
      open: true,
      activeTab: "tasks",
      selectedTaskId: "task-scheduled",
      selectedExecutionId: "execution-scheduled",
    });
    expect(routerPush).toHaveBeenCalledWith("/h/server-1/workspace/workspace-execution/tasks");
  });
});
