import { type DesktopHostBridge, getDesktopHost } from "@/desktop/host";
import { isNative, isWeb } from "@/constants/platform";
import { i18n } from "@/i18n/i18next";

export type DesktopPermissionKind = "notifications";

export type DesktopPermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | "not-granted"
  | "unavailable"
  | "unknown";

export interface DesktopPermissionStatus {
  state: DesktopPermissionState;
  detail: string;
}

export interface DesktopPermissionSnapshot {
  checkedAt: number;
  notifications: DesktopPermissionStatus;
}

export interface NotificationConstructorLike {
  permission?: string;
  requestPermission?: () => Promise<string>;
}

export interface DesktopPermissionEnvironment {
  isWeb: boolean;
  getDesktopHost: () => DesktopHostBridge | null;
  getNotification: () => NotificationConstructorLike | null;
}

export interface DesktopPermissions {
  shouldShowDesktopPermissionSection: () => boolean;
  getDesktopPermissionSnapshot: () => Promise<DesktopPermissionSnapshot>;
  requestDesktopPermission: (input: {
    kind: DesktopPermissionKind;
  }) => Promise<DesktopPermissionStatus>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapNotificationPermission(permission: string): DesktopPermissionStatus {
  if (permission === "granted") {
    return {
      state: "granted",
      detail: i18n.t("desktop.permissions.notifications.allowed"),
    };
  }
  if (permission === "denied") {
    return {
      state: "denied",
      detail: i18n.t("desktop.permissions.notifications.denied"),
    };
  }
  if (permission === "default") {
    return {
      state: "prompt",
      detail: i18n.t("desktop.permissions.notifications.notGranted"),
    };
  }
  return {
    state: "unknown",
    detail: i18n.t("desktop.permissions.notifications.unexpectedState", { state: permission }),
  };
}

export function createDesktopPermissions(env: DesktopPermissionEnvironment): DesktopPermissions {
  function shouldShowDesktopPermissionSection(): boolean {
    return env.isWeb && env.getDesktopHost() !== null;
  }

  async function getNotificationPermissionStatus(): Promise<DesktopPermissionStatus> {
    if (!env.isWeb) {
      return {
        state: "unavailable",
        detail: i18n.t("desktop.permissions.notifications.webOnly"),
      };
    }

    const desktopHost = env.getDesktopHost();
    if (desktopHost && typeof desktopHost.notification?.isSupported === "function") {
      try {
        const supported = await desktopHost.notification.isSupported();
        return {
          state: supported ? "granted" : "unavailable",
          detail: supported
            ? i18n.t("desktop.permissions.notifications.supported")
            : i18n.t("desktop.permissions.notifications.unsupported"),
        };
      } catch {
        // Fall through to the Web Notification API.
      }
    }

    const NotificationConstructor = env.getNotification();
    if (NotificationConstructor && typeof NotificationConstructor.permission === "string") {
      return mapNotificationPermission(NotificationConstructor.permission);
    }

    return {
      state: "unavailable",
      detail: i18n.t("desktop.permissions.notifications.apiUnavailable"),
    };
  }

  async function requestDesktopPermission(): Promise<DesktopPermissionStatus> {
    if (!env.isWeb) {
      return {
        state: "unavailable",
        detail: i18n.t("desktop.permissions.notifications.requestsWebOnly"),
      };
    }

    const NotificationConstructor = env.getNotification();
    if (NotificationConstructor?.requestPermission) {
      try {
        return mapNotificationPermission(await NotificationConstructor.requestPermission());
      } catch (error) {
        return {
          state: "unknown",
          detail: i18n.t("desktop.permissions.notifications.requestFailed", {
            message: getErrorMessage(error),
          }),
        };
      }
    }

    return {
      state: "unavailable",
      detail: i18n.t("desktop.permissions.notifications.requestUnavailable"),
    };
  }

  async function getDesktopPermissionSnapshot(): Promise<DesktopPermissionSnapshot> {
    return {
      checkedAt: Date.now(),
      notifications: await getNotificationPermissionStatus(),
    };
  }

  return {
    shouldShowDesktopPermissionSection,
    getDesktopPermissionSnapshot,
    requestDesktopPermission,
  };
}

function getRealNotification(): NotificationConstructorLike | null {
  if (isNative) return null;
  const value = (globalThis as { Notification?: unknown }).Notification;
  if (value === null || value === undefined) return null;
  if (typeof value !== "function" && typeof value !== "object") return null;
  return value as NotificationConstructorLike;
}

const realDesktopPermissions = createDesktopPermissions({
  isWeb,
  getDesktopHost,
  getNotification: getRealNotification,
});

export const shouldShowDesktopPermissionSection =
  realDesktopPermissions.shouldShowDesktopPermissionSection;
export const getDesktopPermissionSnapshot = realDesktopPermissions.getDesktopPermissionSnapshot;
export const requestDesktopPermission = realDesktopPermissions.requestDesktopPermission;
