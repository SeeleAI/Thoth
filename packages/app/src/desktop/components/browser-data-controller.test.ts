import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { clearDesktopBrowserData } from "./browser-data-controller";

describe("clearDesktopBrowserData", () => {
  it("does not touch the profile when confirmation is cancelled", async () => {
    const clearProfile = vi.fn(async () => undefined);

    await expect(
      clearDesktopBrowserData({
        confirm: async () => false,
        clearProfile,
        browserIds: ["browser-a"],
      }),
    ).resolves.toBe("cancelled");
    expect(clearProfile).not.toHaveBeenCalled();
  });

  it("passes every current browser id to the shared-profile migration cleanup", async () => {
    const clearProfile = vi.fn(async () => undefined);

    await expect(
      clearDesktopBrowserData({
        confirm: async () => true,
        clearProfile,
        browserIds: ["browser-a", "browser-b"],
      }),
    ).resolves.toBe("cleared");
    expect(clearProfile).toHaveBeenCalledWith(["browser-a", "browser-b"]);
  });

  it("fails honestly when the Electron profile bridge is unavailable", async () => {
    await expect(
      clearDesktopBrowserData({
        confirm: async () => true,
        browserIds: [],
      }),
    ).rejects.toThrow("Electron browser profile bridge is unavailable");
  });

  it("mounts the control only in the Desktop general settings route", () => {
    const sourceRoot = dirname(fileURLToPath(import.meta.url));
    const settingsSource = readFileSync(
      join(sourceRoot, "..", "..", "screens", "settings-screen.tsx"),
      "utf8",
    );

    expect(settingsSource).toContain(
      'import { BrowserDataSection } from "@/desktop/components/browser-data-section"',
    );
    expect(settingsSource).toContain("{isDesktopApp ? <BrowserDataSection /> : null}");
  });
});
