import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface BackgroundTasksSurfaceState {
  open: boolean;
  closedByUser?: boolean;
  activeTab?: "tasks" | "schedules";
  sidebarWidth?: number;
  taskListWidth?: number;
  selectedTaskId: string | null;
  selectedScheduleId?: string | null;
  selectedGoalId: string | null;
  selectedExecutionId: string | null;
}

interface BackgroundTasksSurfaceStore {
  byWorkspaceKey: Record<string, BackgroundTasksSurfaceState>;
  openSurface: (input: { serverId: string; workspaceId: string }) => void;
  closeSurface: (input: { serverId: string; workspaceId: string }) => void;
  updateSurface: (
    input: { serverId: string; workspaceId: string } & Partial<BackgroundTasksSurfaceState>,
  ) => void;
}

const DEFAULT_STATE: BackgroundTasksSurfaceState = {
  open: false,
  closedByUser: false,
  activeTab: "tasks",
  sidebarWidth: undefined,
  selectedTaskId: null,
  selectedScheduleId: null,
  selectedGoalId: null,
  selectedExecutionId: null,
};

export const BACKGROUND_TASKS_LIST_DEFAULT_WIDTH = 300;
export const BACKGROUND_TASKS_LIST_MIN_WIDTH = 220;
export const BACKGROUND_TASKS_LIST_MAX_WIDTH = 520;
const BACKGROUND_TASKS_DETAIL_MIN_WIDTH = 360;
const BACKGROUND_TASKS_SURFACE_ABSOLUTE_MIN_WIDTH = 360;
const BACKGROUND_TASKS_SURFACE_MIN_LIVE_WIDTH = 420;

// The nested list and detail panes must both stay readable when arranged side
// by side. Persisted widths below this threshold use the stacked layout.
export const BACKGROUND_TASKS_SURFACE_MIN_WIDTH =
  BACKGROUND_TASKS_LIST_MIN_WIDTH + BACKGROUND_TASKS_DETAIL_MIN_WIDTH;
export const BACKGROUND_TASKS_SURFACE_DEFAULT_WIDTH =
  BACKGROUND_TASKS_LIST_DEFAULT_WIDTH + BACKGROUND_TASKS_DETAIL_MIN_WIDTH;
export const BACKGROUND_TASKS_SURFACE_MAX_WIDTH = 1400;

export function resolveBackgroundTasksSurfaceOpen(
  state: BackgroundTasksSurfaceState | null | undefined,
  defaultOpen: boolean,
): boolean {
  if (state?.open) {
    return true;
  }
  if (state?.closedByUser) {
    return false;
  }
  return defaultOpen;
}

export function clampBackgroundTasksSurfaceWidth(
  width: number | null | undefined,
  containerWidth?: number | null,
): number {
  const fallback = BACKGROUND_TASKS_SURFACE_DEFAULT_WIDTH;
  const candidate = Number.isFinite(width) ? Number(width) : fallback;
  const containerMax =
    typeof containerWidth === "number" && containerWidth > 0
      ? Math.max(
          BACKGROUND_TASKS_SURFACE_ABSOLUTE_MIN_WIDTH,
          containerWidth - BACKGROUND_TASKS_SURFACE_MIN_LIVE_WIDTH,
        )
      : BACKGROUND_TASKS_SURFACE_MAX_WIDTH;
  const maxWidth = Math.max(
    BACKGROUND_TASKS_SURFACE_ABSOLUTE_MIN_WIDTH,
    Math.min(BACKGROUND_TASKS_SURFACE_MAX_WIDTH, containerMax),
  );
  const minWidth = Math.min(BACKGROUND_TASKS_SURFACE_MIN_WIDTH, maxWidth);
  return Math.round(Math.min(maxWidth, Math.max(minWidth, candidate)));
}

export function shouldStackBackgroundTasksSurface(input: {
  isCompact: boolean;
  surfaceWidth: number;
}): boolean {
  return (
    input.isCompact ||
    (input.surfaceWidth > 0 && input.surfaceWidth < BACKGROUND_TASKS_SURFACE_MIN_WIDTH)
  );
}

export function clampBackgroundTasksListWidth(
  width: number | null | undefined,
  containerWidth?: number | null,
): number {
  const candidate = Number.isFinite(width) ? Number(width) : BACKGROUND_TASKS_LIST_DEFAULT_WIDTH;
  const containerMax =
    typeof containerWidth === "number" && containerWidth > 0
      ? Math.max(
          BACKGROUND_TASKS_LIST_MIN_WIDTH,
          containerWidth - BACKGROUND_TASKS_DETAIL_MIN_WIDTH,
        )
      : BACKGROUND_TASKS_LIST_MAX_WIDTH;
  const maxWidth = Math.max(
    BACKGROUND_TASKS_LIST_MIN_WIDTH,
    Math.min(BACKGROUND_TASKS_LIST_MAX_WIDTH, containerMax),
  );
  return Math.round(Math.min(maxWidth, Math.max(BACKGROUND_TASKS_LIST_MIN_WIDTH, candidate)));
}

export function buildBackgroundTasksSurfaceKey(input: {
  serverId: string;
  workspaceId: string;
}): string {
  return `${input.serverId}:${input.workspaceId}`;
}

export const useBackgroundTasksSurfaceStore = create<BackgroundTasksSurfaceStore>()(
  persist(
    (set) => ({
      byWorkspaceKey: {},
      openSurface: (input) =>
        set((state) => {
          const key = buildBackgroundTasksSurfaceKey(input);
          const current = state.byWorkspaceKey[key] ?? DEFAULT_STATE;
          return {
            byWorkspaceKey: {
              ...state.byWorkspaceKey,
              [key]: { ...current, open: true, closedByUser: false },
            },
          };
        }),
      closeSurface: (input) =>
        set((state) => {
          const key = buildBackgroundTasksSurfaceKey(input);
          const current = state.byWorkspaceKey[key] ?? DEFAULT_STATE;
          return {
            byWorkspaceKey: {
              ...state.byWorkspaceKey,
              [key]: { ...current, open: false, closedByUser: true },
            },
          };
        }),
      updateSurface: (input) =>
        set((state) => {
          const key = buildBackgroundTasksSurfaceKey(input);
          const current = state.byWorkspaceKey[key] ?? DEFAULT_STATE;
          const { serverId: _serverId, workspaceId: _workspaceId, ...patch } = input;
          const closedByUser =
            patch.open === true ? false : patch.open === false ? true : current.closedByUser;
          return {
            byWorkspaceKey: {
              ...state.byWorkspaceKey,
              [key]: { ...current, ...patch, closedByUser },
            },
          };
        }),
    }),
    {
      name: "thoth.background-tasks-surface.v2",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
