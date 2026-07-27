import { describe, expect, it } from "vitest";

import {
  canRequestTerminalFocusClaim,
  EMPTY_TERMINAL_FOCUS_CLAIM,
  reconcileTerminalFocusClaim,
  settleTerminalFocusClaim,
} from "./terminal-pane-focus-claim";

describe("terminal pane focus claim", () => {
  it("waits for the host, connection and renderer before requesting a resize claim", () => {
    expect(
      canRequestTerminalFocusClaim({
        isWorkspaceFocused: true,
        isAppVisible: true,
        isClientReady: true,
        isConnected: false,
        isRendererReady: true,
      }),
    ).toBe(false);
    expect(
      canRequestTerminalFocusClaim({
        isWorkspaceFocused: true,
        isAppVisible: true,
        isClientReady: true,
        isConnected: true,
        isRendererReady: true,
      }),
    ).toBe(true);
  });

  it("claims once per continuous pane focus after a resize is sent", () => {
    const requested = reconcileTerminalFocusClaim(EMPTY_TERMINAL_FOCUS_CLAIM, {
      key: "workspace:terminal-1",
      canRequest: true,
    });
    const settled = settleTerminalFocusClaim(requested.state, {
      key: "workspace:terminal-1",
      sent: true,
    });
    expect(
      reconcileTerminalFocusClaim(settled, {
        key: "workspace:terminal-1",
        canRequest: true,
      }).shouldRequest,
    ).toBe(false);
  });

  it("retries when readiness changes or the resize could not be sent", () => {
    const requested = reconcileTerminalFocusClaim(EMPTY_TERMINAL_FOCUS_CLAIM, {
      key: "workspace:terminal-1",
      canRequest: true,
    });
    const hidden = reconcileTerminalFocusClaim(requested.state, {
      key: "workspace:terminal-1",
      canRequest: false,
    });
    expect(
      reconcileTerminalFocusClaim(hidden.state, {
        key: "workspace:terminal-1",
        canRequest: true,
      }).shouldRequest,
    ).toBe(true);

    const dropped = settleTerminalFocusClaim(requested.state, {
      key: "workspace:terminal-1",
      sent: false,
    });
    expect(
      reconcileTerminalFocusClaim(dropped, {
        key: "workspace:terminal-1",
        canRequest: true,
      }).shouldRequest,
    ).toBe(true);
  });

  it("re-arms after pane blur or terminal replacement", () => {
    const requested = reconcileTerminalFocusClaim(EMPTY_TERMINAL_FOCUS_CLAIM, {
      key: "workspace:terminal-1",
      canRequest: true,
    });
    const settled = settleTerminalFocusClaim(requested.state, {
      key: "workspace:terminal-1",
      sent: true,
    });
    const blurred = reconcileTerminalFocusClaim(settled, { key: null, canRequest: true });
    expect(
      reconcileTerminalFocusClaim(blurred.state, {
        key: "workspace:terminal-1",
        canRequest: true,
      }).shouldRequest,
    ).toBe(true);
    expect(
      reconcileTerminalFocusClaim(settled, {
        key: "workspace:terminal-2",
        canRequest: true,
      }).shouldRequest,
    ).toBe(true);
  });
});
