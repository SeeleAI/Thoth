export interface TerminalFocusClaimState {
  claimedKey: string | null;
  requestedKey: string | null;
}

export const EMPTY_TERMINAL_FOCUS_CLAIM: TerminalFocusClaimState = {
  claimedKey: null,
  requestedKey: null,
};

export function canRequestTerminalFocusClaim(input: {
  isWorkspaceFocused: boolean;
  isAppVisible: boolean;
  isClientReady: boolean;
  isConnected: boolean;
  isRendererReady: boolean;
}): boolean {
  return (
    input.isWorkspaceFocused &&
    input.isAppVisible &&
    input.isClientReady &&
    input.isConnected &&
    input.isRendererReady
  );
}

export function reconcileTerminalFocusClaim(
  state: TerminalFocusClaimState,
  input: { key: string | null; canRequest: boolean },
): { state: TerminalFocusClaimState; shouldRequest: boolean } {
  if (input.key === null) {
    return { state: EMPTY_TERMINAL_FOCUS_CLAIM, shouldRequest: false };
  }
  if (state.claimedKey === input.key) {
    return {
      state: { claimedKey: input.key, requestedKey: null },
      shouldRequest: false,
    };
  }
  if (!input.canRequest) {
    return {
      state: { claimedKey: state.claimedKey, requestedKey: null },
      shouldRequest: false,
    };
  }
  if (state.requestedKey === input.key) {
    return { state, shouldRequest: false };
  }
  return {
    state: { claimedKey: state.claimedKey, requestedKey: input.key },
    shouldRequest: true,
  };
}

export function settleTerminalFocusClaim(
  state: TerminalFocusClaimState,
  input: { key: string; sent: boolean },
): TerminalFocusClaimState {
  if (state.requestedKey !== input.key) return state;
  return {
    claimedKey: input.sent ? input.key : state.claimedKey,
    requestedKey: null,
  };
}
