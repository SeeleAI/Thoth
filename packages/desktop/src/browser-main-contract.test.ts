import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));

describe("desktop browser host contract", () => {
  it("uses one shared profile and explicit renderer attachment identity", () => {
    const source = readFileSync(join(sourceRoot, "main.ts"), "utf8");

    expect(source).toContain("isThothBrowserWebviewAttach(params)");
    expect(source).toContain("registerAttachedThothBrowser({");
    expect(source).toContain("profileSession: getThothBrowserProfileSession(session)");
    expect(source).toContain("hostWebContentsId: event.sender.id");
    expect(source).toContain("unregisterThothBrowserHost(webContentsId)");
    expect(source).not.toContain("pendingBrowserWebviewIds");
    expect(source).not.toContain("readBrowserIdFromWebviewAttach");
    expect(source).not.toContain("persist:thoth-browser-${");
    expect(source).not.toContain("thoth:browser:clear-partition");
  });

  it("preserves popup browser contracts and registers automation once", () => {
    const source = readFileSync(join(sourceRoot, "main.ts"), "utf8");

    expect(source).toContain("decideBrowserWindowOpenRequest({");
    expect(source).toContain("hasPostBody: postBody !== undefined && postBody !== null");
    expect(source).toContain(
      "overrideBrowserWindowOptions: getBrowserPopupWindowOptions(mainWindow)",
    );
    expect(source).toContain("pendingBrowserWindowOpenRequests.add(sourceContents.id");
    expect(source).toContain("registerBrowserAutomationIpc()");
  });
});
