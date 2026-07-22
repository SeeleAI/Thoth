import { describe, expect, it, vi } from "vitest";
import type { DesktopHostBridge } from "@/desktop/host";
import { i18n } from "@/i18n/i18next";
import {
  createDesktopPermissions,
  type DesktopPermissionEnvironment,
  type NotificationConstructorLike,
} from "./desktop-permissions";

interface FakeEnvironmentInput {
  isWeb?: boolean;
  desktopHost?: DesktopHostBridge | null;
  notification?: NotificationConstructorLike | null;
}

function fakeEnvironment(input: FakeEnvironmentInput = {}): DesktopPermissionEnvironment {
  return {
    isWeb: input.isWeb ?? true,
    getDesktopHost: () => input.desktopHost ?? null,
    getNotification: () => input.notification ?? null,
  };
}

describe("desktop-permissions", () => {
  it("shows section only in desktop web runtime", () => {
    expect(
      createDesktopPermissions(
        fakeEnvironment({ isWeb: false }),
      ).shouldShowDesktopPermissionSection(),
    ).toBe(false);

    expect(
      createDesktopPermissions(
        fakeEnvironment({ isWeb: true, desktopHost: null }),
      ).shouldShowDesktopPermissionSection(),
    ).toBe(false);

    expect(
      createDesktopPermissions(
        fakeEnvironment({ isWeb: true, desktopHost: {} as DesktopHostBridge }),
      ).shouldShowDesktopPermissionSection(),
    ).toBe(true);
  });

  it("reads notification status", async () => {
    const permissions = createDesktopPermissions(
      fakeEnvironment({
        notification: { permission: "default" },
      }),
    );

    const snapshot = await permissions.getDesktopPermissionSnapshot();

    expect(snapshot.notifications.state).toBe("prompt");
    expect(snapshot.checkedAt).toBeTypeOf("number");
  });

  it("requests notification permission via the browser Notification API", async () => {
    const fakeNotification: NotificationConstructorLike = {
      permission: "default",
      requestPermission: vi.fn(async () => "granted"),
    };

    const permissions = createDesktopPermissions(
      fakeEnvironment({ notification: fakeNotification }),
    );
    const result = await permissions.requestDesktopPermission({ kind: "notifications" });

    expect(result.state).toBe("granted");
    expect(fakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("reads browser Notification permission when available", async () => {
    const permissions = createDesktopPermissions(
      fakeEnvironment({
        notification: { permission: "denied" },
      }),
    );

    const snapshot = await permissions.getDesktopPermissionSnapshot();

    expect(snapshot.notifications.state).toBe("denied");
  });

  it("uses the active app language for local status details", async () => {
    await i18n.changeLanguage("zh-CN");
    try {
      const permissions = createDesktopPermissions(
        fakeEnvironment({
          notification: { permission: "granted" },
        }),
      );

      const snapshot = await permissions.getDesktopPermissionSnapshot();

      expect(snapshot.notifications.detail).toBe("系统已允许通知。");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
