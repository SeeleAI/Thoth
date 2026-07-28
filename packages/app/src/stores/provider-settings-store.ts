import { create } from "zustand";

interface ProviderSettingsTarget {
  serverId: string;
  provider: string;
  overlayParentLayer?: number;
}

interface ProviderSettingsStoreState {
  serverId: string | null;
  provider: string | null;
  visible: boolean;
  overlayParentLayer: number;
  open: (target: ProviderSettingsTarget) => void;
  close: () => void;
}

export const useProviderSettingsStore = create<ProviderSettingsStoreState>()((set) => ({
  serverId: null,
  provider: null,
  visible: false,
  overlayParentLayer: 0,
  open: ({ serverId, provider, overlayParentLayer = 0 }) => {
    set({ serverId, provider, visible: true, overlayParentLayer });
  },
  close: () => {
    set({ visible: false });
  },
}));
