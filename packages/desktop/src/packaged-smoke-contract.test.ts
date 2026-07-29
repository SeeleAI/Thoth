import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(sourceRoot, "..");
const require = createRequire(import.meta.url);

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

  it("waits for a newly created pid lock to contain complete JSON", async () => {
    const directory = mkdtempSync(join(tmpdir(), "thoth-packaged-pid-json-"));
    const pidPath = join(directory, "thoth.pid");
    const { waitForJsonFile } = require(
      join(packageRoot, "scripts", "smoke-packaged-desktop-app.cjs"),
    ) as {
      waitForJsonFile: (
        filePath: string,
        label: string,
        options: { timeoutMs: number; pollIntervalMs: number },
      ) => Promise<unknown>;
    };

    let completeWrite: ReturnType<typeof setTimeout> | null = null;
    try {
      writeFileSync(pidPath, "{");
      completeWrite = setTimeout(() => {
        writeFileSync(pidPath, JSON.stringify({ pid: 42, instanceId: "packaged-smoke" }));
      }, 30);

      await expect(
        waitForJsonFile(pidPath, "partial pid lock", {
          timeoutMs: 1_000,
          pollIntervalMs: 5,
        }),
      ).resolves.toEqual({ pid: 42, instanceId: "packaged-smoke" });
    } finally {
      if (completeWrite !== null) clearTimeout(completeWrite);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
