import { describe, expect, test } from "vitest";
import { THOTH_BROWSER_PROFILE_PARTITION } from "../browser-profile.js";
import {
  getThothBrowserIdForWebContents,
  getThothBrowserWorkspaceId,
  isThothBrowserWebviewAttach,
  prepareThothBrowserWebContents,
  registerAttachedThothBrowser,
  unregisterThothBrowser,
  unregisterThothBrowserFromHost,
} from "./index.js";

class FakeRenderer {
  public constructor(public readonly id: number) {}

  public isDestroyed(): boolean {
    return false;
  }
}

class FakeBrowserGuest {
  public readonly backgroundThrottlingCalls: boolean[] = [];
  private destroyedListener: (() => void) | null = null;
  private destroyed = false;

  public constructor(
    public readonly id: number,
    public readonly hostWebContents: FakeRenderer,
    public readonly session: object,
  ) {}

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public setBackgroundThrottling(allowed: boolean): void {
    this.backgroundThrottlingCalls.push(allowed);
  }

  public once(event: "destroyed", listener: () => void): void {
    expect(event).toBe("destroyed");
    this.destroyedListener = listener;
  }

  public destroy(): void {
    this.destroyed = true;
    this.destroyedListener?.();
  }
}

describe("browser webview attachment", () => {
  test("accepts only allowed URLs on the shared profile partition", () => {
    expect(
      isThothBrowserWebviewAttach({
        src: "https://example.com",
        partition: THOTH_BROWSER_PROFILE_PARTITION,
      }),
    ).toBe(true);
    expect(
      isThothBrowserWebviewAttach({
        src: "https://example.com",
        partition: "persist:thoth-browser-tab-a",
      }),
    ).toBe(false);
    expect(
      isThothBrowserWebviewAttach({ src: "https://example.com", partition: "persist:foreign" }),
    ).toBe(false);
  });

  test("binds explicit browser identity to the renderer that hosts the guest", () => {
    const profileSession = {};
    const renderer = new FakeRenderer(1);
    const guest = new FakeBrowserGuest(101, renderer, profileSession);

    const registered = registerAttachedThothBrowser({
      browserId: "browser-a",
      workspaceId: "workspace-a",
      webContentsId: guest.id,
      sender: renderer,
      profileSession,
      findWebContents: () => guest,
    });

    expect(registered).toBe(true);
    expect(getThothBrowserIdForWebContents(guest)).toBe("browser-a");
    expect(getThothBrowserWorkspaceId("browser-a")).toBe("workspace-a");
    unregisterThothBrowser("browser-a");
  });

  test("rejects a guest hosted by another renderer", () => {
    const profileSession = {};
    const owner = new FakeRenderer(1);
    const claimant = new FakeRenderer(2);
    const guest = new FakeBrowserGuest(201, owner, profileSession);

    const registered = registerAttachedThothBrowser({
      browserId: "browser-rejected-owner",
      workspaceId: "workspace-a",
      webContentsId: guest.id,
      sender: claimant,
      profileSession,
      findWebContents: () => guest,
    });

    expect(registered).toBe(false);
    expect(getThothBrowserIdForWebContents(guest)).toBeNull();
  });

  test("rejects a guest outside the shared profile", () => {
    const profileSession = {};
    const renderer = new FakeRenderer(1);
    const guest = new FakeBrowserGuest(301, renderer, {});

    const registered = registerAttachedThothBrowser({
      browserId: "browser-rejected-profile",
      workspaceId: "workspace-a",
      webContentsId: guest.id,
      sender: renderer,
      profileSession,
      findWebContents: () => guest,
    });

    expect(registered).toBe(false);
    expect(getThothBrowserIdForWebContents(guest)).toBeNull();
  });

  test("concurrent windows cannot swap browser identities", () => {
    const profileSession = {};
    const firstRenderer = new FakeRenderer(1);
    const secondRenderer = new FakeRenderer(2);
    const firstGuest = new FakeBrowserGuest(401, firstRenderer, profileSession);
    const secondGuest = new FakeBrowserGuest(402, secondRenderer, profileSession);
    const guests = new Map([
      [firstGuest.id, firstGuest],
      [secondGuest.id, secondGuest],
    ]);

    registerAttachedThothBrowser({
      browserId: "browser-second",
      workspaceId: "workspace-second",
      webContentsId: secondGuest.id,
      sender: secondRenderer,
      profileSession,
      findWebContents: (id) => guests.get(id) ?? null,
    });
    registerAttachedThothBrowser({
      browserId: "browser-first",
      workspaceId: "workspace-first",
      webContentsId: firstGuest.id,
      sender: firstRenderer,
      profileSession,
      findWebContents: (id) => guests.get(id) ?? null,
    });

    expect(getThothBrowserIdForWebContents(firstGuest)).toBe("browser-first");
    expect(getThothBrowserIdForWebContents(secondGuest)).toBe("browser-second");
    unregisterThothBrowser("browser-first");
    unregisterThothBrowser("browser-second");
  });

  test("rejects cross-workspace rebinding of an existing browser identity", () => {
    const profileSession = {};
    const firstRenderer = new FakeRenderer(7);
    const secondRenderer = new FakeRenderer(8);
    const firstGuest = new FakeBrowserGuest(451, firstRenderer, profileSession);
    const secondGuest = new FakeBrowserGuest(452, secondRenderer, profileSession);

    expect(
      registerAttachedThothBrowser({
        browserId: "browser-workspace-scoped",
        workspaceId: "workspace-a",
        webContentsId: firstGuest.id,
        sender: firstRenderer,
        profileSession,
        findWebContents: () => firstGuest,
      }),
    ).toBe(true);
    expect(
      registerAttachedThothBrowser({
        browserId: "browser-workspace-scoped",
        workspaceId: "workspace-b",
        webContentsId: secondGuest.id,
        sender: secondRenderer,
        profileSession,
        findWebContents: () => secondGuest,
      }),
    ).toBe(false);

    expect(getThothBrowserWorkspaceId("browser-workspace-scoped")).toBe("workspace-a");
    expect(getThothBrowserIdForWebContents(firstGuest)).toBe("browser-workspace-scoped");
    expect(getThothBrowserIdForWebContents(secondGuest)).toBeNull();
    unregisterThothBrowser("browser-workspace-scoped");
  });

  test("unregisters the same browser only from its requesting host", () => {
    const profileSession = {};
    const firstRenderer = new FakeRenderer(11);
    const secondRenderer = new FakeRenderer(22);
    const firstGuest = new FakeBrowserGuest(501, firstRenderer, profileSession);
    const secondGuest = new FakeBrowserGuest(502, secondRenderer, profileSession);

    for (const [renderer, guest] of [
      [firstRenderer, firstGuest],
      [secondRenderer, secondGuest],
    ] as const) {
      registerAttachedThothBrowser({
        browserId: "browser-shared-hosts",
        workspaceId: "workspace-shared",
        webContentsId: guest.id,
        sender: renderer,
        profileSession,
        findWebContents: () => guest,
      });
    }

    unregisterThothBrowserFromHost(firstRenderer.id, "browser-shared-hosts");

    expect(getThothBrowserIdForWebContents(firstGuest)).toBeNull();
    expect(getThothBrowserIdForWebContents(secondGuest)).toBe("browser-shared-hosts");
    expect(getThothBrowserWorkspaceId("browser-shared-hosts")).toBe("workspace-shared");
    unregisterThothBrowser("browser-shared-hosts");
  });

  test("prepares throttling once and removes registration when the guest is destroyed", () => {
    const profileSession = {};
    const renderer = new FakeRenderer(31);
    const guest = new FakeBrowserGuest(601, renderer, profileSession);
    prepareThothBrowserWebContents(guest);
    registerAttachedThothBrowser({
      browserId: "browser-cleanup",
      workspaceId: "workspace-cleanup",
      webContentsId: guest.id,
      sender: renderer,
      profileSession,
      findWebContents: () => guest,
    });

    expect(guest.backgroundThrottlingCalls).toEqual([false]);
    expect(getThothBrowserIdForWebContents(guest)).toBe("browser-cleanup");

    guest.destroy();

    expect(getThothBrowserIdForWebContents(guest)).toBeNull();
    expect(guest.backgroundThrottlingCalls).toEqual([false]);
  });
});
