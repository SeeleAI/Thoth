import { create } from "zustand";

interface UiPreferencesState {
  focusedAgentByServer: Map<string, string | null>;
  focusedTerminalByServer: Map<string, string | null>;
  focusAgent(serverId: string, agentId: string | null): void;
  focusTerminal(serverId: string, terminalId: string | null): void;
  clearServer(serverId: string): void;
}

export const useUiPreferencesStore = create<UiPreferencesState>()((set) => ({
  focusedAgentByServer: new Map(),
  focusedTerminalByServer: new Map(),
  focusAgent: (serverId, agentId) =>
    set((state) => {
      if (state.focusedAgentByServer.get(serverId) === agentId) return state;
      return {
        focusedAgentByServer: new Map(state.focusedAgentByServer).set(serverId, agentId),
      };
    }),
  focusTerminal: (serverId, terminalId) =>
    set((state) => {
      if (state.focusedTerminalByServer.get(serverId) === terminalId) return state;
      return {
        focusedTerminalByServer: new Map(state.focusedTerminalByServer).set(serverId, terminalId),
      };
    }),
  clearServer: (serverId) =>
    set((state) => {
      if (
        !state.focusedAgentByServer.has(serverId) &&
        !state.focusedTerminalByServer.has(serverId)
      ) {
        return state;
      }
      const focusedAgentByServer = new Map(state.focusedAgentByServer);
      const focusedTerminalByServer = new Map(state.focusedTerminalByServer);
      focusedAgentByServer.delete(serverId);
      focusedTerminalByServer.delete(serverId);
      return { focusedAgentByServer, focusedTerminalByServer };
    }),
}));
