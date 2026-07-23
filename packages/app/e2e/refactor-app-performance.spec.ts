import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures";
import { expectComposerVisible } from "./helpers/composer";
import { gotoWorkspace } from "./helpers/launcher";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sampleCount = 7;

const viewport = { width: 1440, height: 960 };

test("records bounded App workspace performance", async ({ withWorkspace, newIsolatedPage }) => {
  test.setTimeout(120_000);
  const workspace = await withWorkspace({ prefix: "refactor-app-perf-" });

  await measureIsolated(newIsolatedPage, workspace.workspaceId);
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    samples.push(await measureIsolated(newIsolatedPage, workspace.workspaceId));
  }

  const outputSetting =
    process.env.THOTH_REFACTOR_APP_PERF_OUTPUT ?? ".dev/refactor-app-performance-current.json";
  const outputPath = isAbsolute(outputSetting) ? outputSetting : resolve(repoRoot, outputSetting);
  const result = {
    schemaVersion: 1,
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim(),
    sampleCount,
    measurement: {
      viewport,
      warmupSampleCount: 1,
      isolation: "fresh browser context per sample with stable daemon reconnect identity",
      workspaceInteractiveReady: "workspace tab bar and Message agent textbox visible",
      interaction: "Settings button click to settings route",
      heap: "CDP Runtime.getHeapUsage.usedSize after forced GC and workspace interactive",
    },
    samples,
    summary: {
      workspaceInteractiveMs: summarize(samples.map((sample) => sample.workspaceInteractiveMs)),
      jsHeapBytes: summarize(samples.map((sample) => sample.jsHeapBytes)),
      settingsNavigationMs: summarize(samples.map((sample) => sample.settingsNavigationMs)),
    },
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
});

async function measureIsolated(
  newIsolatedPage: (options: {
    viewport: { width: number; height: number };
    clientId?: string;
  }) => Promise<Parameters<typeof gotoWorkspace>[0]>,
  workspaceId: string,
) {
  const page = await newIsolatedPage({
    viewport,
    clientId: "cid_refactor_app_performance",
  });
  try {
    return await measureOnce(page, workspaceId);
  } finally {
    await page.context().close();
  }
}

async function measureOnce(page: Parameters<typeof gotoWorkspace>[0], workspaceId: string) {
  const navigationStartedAt = performance.now();
  await gotoWorkspace(page, workspaceId);
  await expectComposerVisible(page, { timeout: 30_000 });
  const workspaceInteractiveMs = performance.now() - navigationStartedAt;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize: jsHeapBytes } = await cdp.send("Runtime.getHeapUsage");
  await cdp.detach();
  expect(jsHeapBytes).toBeGreaterThan(0);

  const settingsStartedAt = performance.now();
  await page.getByTestId("sidebar-settings").click();
  await expect(page).toHaveURL(/\/settings(?:\/|$)/, { timeout: 30_000 });
  const settingsNavigationMs = performance.now() - settingsStartedAt;
  return { workspaceInteractiveMs, jsHeapBytes, settingsNavigationMs };
}

function summarize(values: number[]) {
  const median = percentile(values, 0.5);
  return {
    median,
    p95: percentile(values, 0.95),
    mad: percentile(
      values.map((value) => Math.abs(value - median)),
      0.5,
    ),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index]!;
}
