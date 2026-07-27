import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(sourceRoot, "..");

describe("packaged desktop smoke contract", () => {
  it("boots the normal Desktop path instead of a smoke-only main-process branch", () => {
    const mainSource = readFileSync(join(sourceRoot, "main.ts"), "utf8");

    expect(mainSource).not.toContain("THOTH_DESKTOP_SMOKE");
    expect(mainSource).not.toContain("runDesktopSmokeIfRequested");
    expect(mainSource).not.toContain("thoth-smoke-stop");
  });

  it("proves the real renderer, sandboxed preload bridge, and renderer-managed daemon", () => {
    const smokeSource = readFileSync(
      join(packageRoot, "scripts", "smoke-packaged-desktop-app.cjs"),
      "utf8",
    );

    expect(smokeSource).toContain('require("playwright")');
    expect(smokeSource).toContain("chromium.connectOverCDP");
    expect(smokeSource).toContain("window.thothDesktop");
    expect(smokeSource).toContain("real app renderer and preload bridge loaded");
    expect(smokeSource).toContain('invoke("desktop_daemon_status")');
    expect(smokeSource).not.toContain('THOTH_DESKTOP_SMOKE: "1"');
    expect(smokeSource).not.toContain("thoth-smoke-stop");
  });
});
