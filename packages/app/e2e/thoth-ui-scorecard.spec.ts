import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TestInfo } from "@playwright/test";
import { expect, test, type Page } from "./fixtures";
import { buildSettingsSectionRoute } from "../src/utils/host-routes";
import { gotoAppShell, selectModel, selectProvider } from "./helpers/app";
import { expectComposerVisible } from "./helpers/composer";
import { openChangesPanel } from "./helpers/branch-switcher";
import { expectExplorerEntryVisible, openFileFromExplorer } from "./helpers/file-explorer";
import {
  clickNewChat,
  clickNewTerminal,
  gotoWorkspace,
  terminalSurfaceLocator,
} from "./helpers/launcher";
import { getServerId } from "./helpers/server-id";

const captureDirectory =
  process.env.THOTH_UI_REVIEW_CAPTURE_DIR ??
  "/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-paseo-surface";

const forbiddenVisiblePatterns = [
  /Paseo/i,
  /WORKSPACE SECRETARY/i,
  /Workspace Secretary/i,
  /当前需求收敛/,
  /Quick 前台/,
  /真实 provider 已连接/,
  /Quick 和 Loop 都会通过真实 provider 结果写入历史/,
  /当前秘书话题/,
  /新秘书话题/,
  /provider-backed clean UI model/i,
  /C_DIRECT|C_ASK/,
  /\bpacket\b/i,
  /\brepair\b/i,
  /\bschema\b/i,
  /raw JSON/i,
  /provider role/i,
  /request_user_input/i,
  /AskUserQuestion/i,
  /127\.0\.0\.1:6767/,
  /localhost:6767/,
  /offer=/,
  /#offer=/,
  /pairingToken/,
  /credential/i,
];

const forbiddenToyTestIds = [
  "thoth-loop2-shell",
  "workspace-secretary-view",
  "thoth-main-navigation",
  "thoth-view-background-tasks",
  "background-tasks-view",
  "secretary-new-topic",
];

test.describe("Loop-2 restored Paseo surface scorecard", () => {
  test.beforeAll(() => {
    mkdirSync(captureDirectory, { recursive: true });
  });

  test("keeps the original open-project tile surface and removes toy shell entrypoints", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 960 });
    await gotoAppShell(page);

    await expect(page.getByTestId("open-project-submit")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("open-project-import-session")).toBeVisible();
    await expect(page.getByTestId("open-project-setup-providers")).toBeVisible();
    await expect(page.getByText("Add a project", { exact: true })).toBeVisible();
    await expect(page.getByText("Task control plane", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Preview surface", { exact: true })).toHaveCount(0);
    await expectNoToyShell(page);
    await expectHealthySurface(page);
    await capture(page, testInfo, "desktop-open-project-paseo-layout.png");
    await expect(
      `${JSON.stringify(
        { tree: normalizeTranscript(await page.locator("body").ariaSnapshot()) },
        null,
        2,
      )}\n`,
    ).toMatchSnapshot("welcome-accessibility-tree.json");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("open-project-submit")).toBeVisible({ timeout: 10_000 });
    await expectHealthySurface(page);
    await capture(page, testInfo, "mobile-open-project-paseo-layout.png");

    expect(pageErrors).toEqual([]);
  });

  test("retains workspace composer, provider controls, attachments and settings main path", async ({
    page,
    withWorkspace,
  }, testInfo) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const workspace = await withWorkspace({ prefix: "loop2-surface-" });
    await page.setViewportSize({ width: 1440, height: 960 });
    await gotoWorkspace(page, workspace.workspaceId);
    await expect(page.getByTestId("sidebar-sessions")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`),
    ).toBeVisible();
    await expect(
      page.getByTestId("workspace-tabs-row").filter({ visible: true }).first(),
    ).toBeVisible();
    await clickNewChat(page);
    await expectComposerVisible(page, { timeout: 30_000 });
    await selectProvider(page, "Codex");
    await selectModel(page, "gpt-5.4-mini");
    await page.keyboard.press("Escape");
    await expect(page.getByText("Select agent provider", { exact: true })).not.toBeVisible({
      timeout: 10_000,
    });
    const thothSwitch = page.getByRole("switch", { name: "Enable Thoth mode" });
    if (!(await thothSwitch.isChecked())) {
      await thothSwitch.click();
    }

    await expect(
      page.getByTestId("message-input-root").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("message-input-attach-button").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: /Select agent provider/i })
        .filter({ visible: true })
        .first(),
    ).toContainText(/gpt-5\.4-mini/i, { timeout: 30_000 });
    await expect(
      page.getByText("Provider", { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("thoth-clarify-control").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("thoth-mode-control").filter({ visible: true }).first(),
    ).toBeVisible();
    await page.getByTestId("thoth-clarify-control").filter({ visible: true }).first().click();
    await page.getByTestId("thoth-clarify-menu-light").click();
    await expect(
      page.getByTestId("thoth-clarify-control").filter({ visible: true }).first(),
    ).toContainText("Light");
    await page.getByTestId("thoth-mode-control").filter({ visible: true }).first().click();
    await page.getByTestId("thoth-mode-menu-loop").click();
    await expect(
      page.getByTestId("thoth-mode-control").filter({ visible: true }).first(),
    ).toContainText("Loop");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("thoth-mode-menu-backdrop")).not.toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message agent..." }).first()).toBeVisible();
    await expectNoToyShell(page);
    await expectHealthySurface(page);
    await capture(page, testInfo, "desktop-workspace-composer-paseo-surface.png");
    await capture(page, testInfo, "desktop-composer-provider-clarify-mode.png");

    const interactionTranscript = [await recordFocus(page, "before-composer-focus")];
    const composer = page.getByRole("textbox", { name: "Message agent..." }).first();
    await composer.focus();
    interactionTranscript.push(await recordFocus(page, "composer-focused"));
    await page.keyboard.press("Tab");
    interactionTranscript.push(await recordFocus(page, "composer-tab-forward"));
    await page.keyboard.press("Shift+Tab");
    interactionTranscript.push(await recordFocus(page, "composer-tab-back"));
    const desktopResponsive = await responsiveTranscript(page, "desktop");
    const desktopAccessibility = await workspaceAccessibilityTranscript(page);
    await expect(
      `${JSON.stringify(
        {
          keyboardAndFocus: interactionTranscript,
          responsive: desktopResponsive,
        },
        null,
        2,
      )}\n`,
    ).toMatchSnapshot("workspace-desktop-interaction-transcript.json");
    await expect(
      normalizeTranscript(
        `${JSON.stringify({ desktop: desktopAccessibility }, null, 2)}\n`,
        workspace,
      ),
    ).toMatchSnapshot("workspace-desktop-accessibility-tree.json");

    writeFileSync(
      path.join(workspace.repoPath, "README.md"),
      "# Refactor baseline\n\nThis file protects the real Git and file-pane surface.\n",
      "utf8",
    );
    await openChangesPanel(page);
    await page.getByTestId("changes-refresh").filter({ visible: true }).first().click();
    await expect(page.getByText("README.md", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await capture(page, testInfo, "desktop-git-diff-paseo-surface.png");

    await page.getByTestId("explorer-tab-files").filter({ visible: true }).first().click();
    await expectExplorerEntryVisible(page, "README.md");
    await openFileFromExplorer(page, "README.md");
    await expect(page.getByTestId("workspace-file-pane")).toBeVisible({ timeout: 30_000 });
    await capture(page, testInfo, "desktop-file-pane-paseo-surface.png");

    await clickNewTerminal(page);
    await expect(terminalSurfaceLocator(page)).toBeVisible({ timeout: 30_000 });
    await capture(page, testInfo, "desktop-terminal-pane-paseo-surface.png");

    await page.goto(buildSettingsSectionRoute("general"));
    await expect(page.getByTestId("settings-sidebar").or(page.getByText("Settings"))).toBeVisible({
      timeout: 30_000,
    });
    await expectHealthySurface(page);
    await capture(page, testInfo, "desktop-settings-paseo-surface.png");

    expect(pageErrors).toEqual([]);
  });

  test("retains the compact workspace composer and responsive accessibility surface", async ({
    page,
    withWorkspace,
  }, testInfo) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const workspace = await withWorkspace({ prefix: "loop2-mobile-surface-" });
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWorkspace(page, workspace.workspaceId);
    await expectComposerVisible(page, { timeout: 30_000 });
    await expect(
      page.getByTestId("message-input-root").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("message-input-attach-button").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("thoth-clarify-control").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("thoth-mode-control").filter({ visible: true }).first(),
    ).toBeVisible();
    await expectNoToyShell(page);
    await expectHealthySurface(page);
    await capture(page, testInfo, "mobile-workspace-composer-paseo-surface.png");

    const mobileResponsive = await responsiveTranscript(page, "mobile");
    const mobileAccessibility = await workspaceAccessibilityTranscript(page);
    await expect(`${JSON.stringify({ responsive: mobileResponsive }, null, 2)}\n`).toMatchSnapshot(
      "workspace-mobile-responsive-transcript.json",
    );
    await expect(
      normalizeTranscript(
        `${JSON.stringify({ mobile: mobileAccessibility }, null, 2)}\n`,
        workspace,
      ),
    ).toMatchSnapshot("workspace-mobile-accessibility-tree.json");

    expect(pageErrors).toEqual([]);
  });
});

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = path.join(captureDirectory, name);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    maxDiffPixelRatio: 0.001,
  });
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

async function expectNoToyShell(page: Page) {
  for (const testId of forbiddenToyTestIds) {
    await expect(page.getByTestId(testId)).toHaveCount(0);
  }
}

async function expectHealthySurface(page: Page) {
  await expect
    .poll(
      async () => {
        const text = await page
          .locator("body")
          .innerText()
          .catch(() => "");
        return text.trim().length;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(40);

  const visibleText = await page.locator("body").innerText();
  for (const pattern of forbiddenVisiblePatterns) {
    expect(visibleText).not.toMatch(pattern);
  }
  expect(page.url()).not.toMatch(/6767|offer=|#offer=|pairingToken/);
}

async function recordFocus(page: Page, step: string) {
  return await page.evaluate((currentStep) => {
    const element = document.activeElement as HTMLElement | null;
    return {
      step: currentStep,
      tag: element?.tagName.toLowerCase() ?? null,
      role: element?.getAttribute("role") ?? null,
      name:
        element?.getAttribute("aria-label") ??
        element?.getAttribute("placeholder") ??
        element?.textContent?.replace(/\s+/gu, " ").trim().slice(0, 80) ??
        null,
      testId: element?.getAttribute("data-testid") ?? null,
    };
  }, step);
}

async function responsiveTranscript(page: Page, layout: "desktop" | "mobile") {
  return {
    layout,
    viewport: page.viewportSize(),
    sidebarVisible: await page
      .getByTestId("sidebar-sessions")
      .isVisible()
      .catch(() => false),
    tabRowVisible: await page
      .getByTestId("workspace-tabs-row")
      .filter({ visible: true })
      .first()
      .isVisible()
      .catch(() => false),
    composerVisible: await page
      .getByTestId("message-input-root")
      .filter({ visible: true })
      .first()
      .isVisible()
      .catch(() => false),
    providerVisible: await page
      .getByRole("button", { name: /Select agent provider/i })
      .filter({ visible: true })
      .first()
      .isVisible()
      .catch(() => false),
    clarifyVisible: await page
      .getByTestId("thoth-clarify-control")
      .filter({ visible: true })
      .first()
      .isVisible()
      .catch(() => false),
    modeVisible: await page
      .getByTestId("thoth-mode-control")
      .filter({ visible: true })
      .first()
      .isVisible()
      .catch(() => false),
  };
}

async function workspaceAccessibilityTranscript(page: Page) {
  return {
    tabs: await page
      .getByTestId("workspace-tabs-row")
      .filter({ visible: true })
      .first()
      .ariaSnapshot(),
    composer: await page
      .getByTestId("message-input-root")
      .filter({ visible: true })
      .first()
      .ariaSnapshot(),
  };
}

function normalizeTranscript(
  value: string,
  workspace?: { workspaceId: string; repoPath: string },
): string {
  let normalized = value;
  if (workspace) {
    normalized = normalized
      .replaceAll(workspace.workspaceId, "<workspace-id>")
      .replaceAll(workspace.repoPath, "<workspace-path>");
  }
  return normalized
    .replace(/wks_[a-z0-9]+/giu, "<workspace-id>")
    .replace(/loop2-surface-[A-Za-z0-9_-]+/gu, "<workspace-name>")
    .replace(/\/tmp\/[A-Za-z0-9._/-]+/gu, "<temporary-path>")
    .replace(/[ \t]+$/gmu, "")
    .trimEnd()
    .concat("\n");
}
