import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface SidebarWorkspacePinsState {
  pinnedWorkspaceKeys: string[];
  pinnedSectionCollapsed: boolean;
  toggle: (workspaceKey: string) => void;
  isPinned: (workspaceKey: string) => boolean;
  togglePinnedSectionCollapsed: () => void;
}

export function selectPinnedWorkspaces<T extends { workspaceKey: string }>(
  workspaces: readonly T[],
  pinnedWorkspaceKeys: readonly string[],
): T[] {
  const workspaceByKey = new Map(
    workspaces.map((workspace) => [workspace.workspaceKey, workspace]),
  );
  return pinnedWorkspaceKeys.flatMap((workspaceKey) => {
    const workspace = workspaceByKey.get(workspaceKey);
    return workspace ? [workspace] : [];
  });
}

export const useSidebarWorkspacePinsStore = create<SidebarWorkspacePinsState>()(
  persist(
    (set, get) => ({
      pinnedWorkspaceKeys: [],
      pinnedSectionCollapsed: false,
      toggle: (workspaceKey) =>
        set((state) => {
          const exists = state.pinnedWorkspaceKeys.includes(workspaceKey);
          return {
            pinnedWorkspaceKeys: exists
              ? state.pinnedWorkspaceKeys.filter((key) => key !== workspaceKey)
              : [...state.pinnedWorkspaceKeys, workspaceKey],
          };
        }),
      isPinned: (workspaceKey) => get().pinnedWorkspaceKeys.includes(workspaceKey),
      togglePinnedSectionCollapsed: () =>
        set((state) => ({ pinnedSectionCollapsed: !state.pinnedSectionCollapsed })),
    }),
    {
      name: "sidebar-workspace-pins",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        pinnedWorkspaceKeys: state.pinnedWorkspaceKeys,
        pinnedSectionCollapsed: state.pinnedSectionCollapsed,
      }),
    },
  ),
);
