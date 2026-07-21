/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  BACKGROUND_TASKS_SURFACE_DEFAULT_WIDTH,
  BACKGROUND_TASKS_SURFACE_MAX_WIDTH,
  BACKGROUND_TASKS_SURFACE_MIN_WIDTH,
  BACKGROUND_TASKS_LIST_DEFAULT_WIDTH,
  BACKGROUND_TASKS_LIST_MAX_WIDTH,
  BACKGROUND_TASKS_LIST_MIN_WIDTH,
  buildBackgroundTasksSurfaceKey,
  clampBackgroundTasksListWidth,
  clampBackgroundTasksSurfaceWidth,
  resolveBackgroundTasksSurfaceOpen,
  shouldStackBackgroundTasksSurface,
  useBackgroundTasksSurfaceStore,
} from "./background-tasks-surface-store";

describe("background tasks surface state helpers", () => {
  it("opens by default unless the user explicitly closed the surface", () => {
    expect(resolveBackgroundTasksSurfaceOpen(undefined, true)).toBe(true);
    expect(resolveBackgroundTasksSurfaceOpen({ open: false } as never, true)).toBe(true);
    expect(
      resolveBackgroundTasksSurfaceOpen({ open: false, closedByUser: true } as never, true),
    ).toBe(false);
    expect(
      resolveBackgroundTasksSurfaceOpen({ open: true, closedByUser: true } as never, true),
    ).toBe(true);
  });

  it("keeps mobile or compact defaults closed when requested by the caller", () => {
    expect(resolveBackgroundTasksSurfaceOpen(undefined, false)).toBe(false);
    expect(resolveBackgroundTasksSurfaceOpen({ open: false } as never, false)).toBe(false);
  });

  it("clamps persisted sidebar width to stable desktop bounds", () => {
    expect(clampBackgroundTasksSurfaceWidth(undefined, 1400)).toBe(
      BACKGROUND_TASKS_SURFACE_DEFAULT_WIDTH,
    );
    expect(clampBackgroundTasksSurfaceWidth(100, 1400)).toBe(BACKGROUND_TASKS_SURFACE_MIN_WIDTH);
    expect(clampBackgroundTasksSurfaceWidth(1800, 2400)).toBe(BACKGROUND_TASKS_SURFACE_MAX_WIDTH);
  });

  it("repairs a persisted narrow panel width when desktop capacity can show both task panes", () => {
    expect(clampBackgroundTasksSurfaceWidth(500, 1400)).toBe(BACKGROUND_TASKS_SURFACE_MIN_WIDTH);
    expect(clampBackgroundTasksSurfaceWidth(undefined, 1400)).toBe(
      BACKGROUND_TASKS_SURFACE_DEFAULT_WIDTH,
    );
  });

  it("preserves enough live session width while resizing the right surface", () => {
    expect(clampBackgroundTasksSurfaceWidth(900, 1000)).toBe(580);
  });

  it("lets wide desktops pull the control plane substantially farther left", () => {
    expect(clampBackgroundTasksSurfaceWidth(1300, 1800)).toBe(1300);
  });

  it("clamps the nested task list while preserving usable task detail width", () => {
    expect(clampBackgroundTasksListWidth(undefined, 1000)).toBe(
      BACKGROUND_TASKS_LIST_DEFAULT_WIDTH,
    );
    expect(clampBackgroundTasksListWidth(100, 1000)).toBe(BACKGROUND_TASKS_LIST_MIN_WIDTH);
    expect(clampBackgroundTasksListWidth(700, 1000)).toBe(BACKGROUND_TASKS_LIST_MAX_WIDTH);
    expect(clampBackgroundTasksListWidth(500, 640)).toBe(280);
  });

  it("stacks the nested task list and detail whenever they cannot fit side by side", () => {
    expect(shouldStackBackgroundTasksSurface({ isCompact: false, surfaceWidth: 0 })).toBe(false);
    expect(shouldStackBackgroundTasksSurface({ isCompact: false, surfaceWidth: 500 })).toBe(true);
    expect(
      shouldStackBackgroundTasksSurface({
        isCompact: false,
        surfaceWidth: BACKGROUND_TASKS_SURFACE_MIN_WIDTH,
      }),
    ).toBe(false);
    expect(shouldStackBackgroundTasksSurface({ isCompact: true, surfaceWidth: 1200 })).toBe(true);
  });
});

describe("background tasks surface store", () => {
  const input = { serverId: "server-1", workspaceId: "workspace-1" };
  const key = buildBackgroundTasksSurfaceKey(input);

  afterEach(() => {
    useBackgroundTasksSurfaceStore.setState({ byWorkspaceKey: {} });
  });

  it("remembers an explicit close without changing task selection state", () => {
    useBackgroundTasksSurfaceStore.getState().updateSurface({
      ...input,
      selectedTaskId: "task-1",
      selectedGoalId: "goal-1",
      selectedExecutionId: "execution-1",
    });

    useBackgroundTasksSurfaceStore.getState().closeSurface(input);

    expect(useBackgroundTasksSurfaceStore.getState().byWorkspaceKey[key]).toMatchObject({
      open: false,
      closedByUser: true,
      selectedTaskId: "task-1",
      selectedGoalId: "goal-1",
      selectedExecutionId: "execution-1",
    });
  });

  it("reopens the workspace surface and clears the explicit close marker", () => {
    useBackgroundTasksSurfaceStore.getState().closeSurface(input);
    useBackgroundTasksSurfaceStore.getState().openSurface(input);

    expect(useBackgroundTasksSurfaceStore.getState().byWorkspaceKey[key]).toMatchObject({
      open: true,
      closedByUser: false,
    });
  });

  it("persists sidebar width without marking the surface as user-closed", () => {
    useBackgroundTasksSurfaceStore.getState().updateSurface({
      ...input,
      sidebarWidth: 640,
      taskListWidth: 280,
    });

    expect(useBackgroundTasksSurfaceStore.getState().byWorkspaceKey[key]).toMatchObject({
      closedByUser: false,
      sidebarWidth: 640,
      taskListWidth: 280,
    });
  });
});
