import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CatalogWorkspaceScriptRuntimeReceiptRepository,
  WorkspaceScriptRuntimeStore,
  type ScriptRuntimeEntry,
} from "./workspace-script-runtime-store.js";
import { WorkspaceCatalogStore } from "./workspace-authority/catalog-store.js";

const temporaryHomes: string[] = [];

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function createEntry(overrides: Partial<ScriptRuntimeEntry> = {}): ScriptRuntimeEntry {
  return {
    workspaceId: "workspace-101",
    scriptName: "web",
    type: "service",
    lifecycle: "running",
    terminalId: "terminal-1",
    exitCode: null,
    ...overrides,
  };
}

describe("WorkspaceScriptRuntimeStore", () => {
  it("persists receipts in Host catalog SQLite and marks stale running state stopped on restart", () => {
    const home = mkdtempSync(join(tmpdir(), "thoth-script-runtime-"));
    temporaryHomes.push(home);
    const firstCatalog = new WorkspaceCatalogStore(home);
    const first = new WorkspaceScriptRuntimeStore(
      new CatalogWorkspaceScriptRuntimeReceiptRepository(firstCatalog),
    );
    first.set(createEntry());
    firstCatalog.close();

    const reopenedCatalog = new WorkspaceCatalogStore(home);
    const reopened = new WorkspaceScriptRuntimeStore(
      new CatalogWorkspaceScriptRuntimeReceiptRepository(reopenedCatalog),
    );
    expect(reopened.get({ workspaceId: "workspace-101", scriptName: "web" })).toEqual(
      createEntry(),
    );
    expect(reopened.reconcileStaleRunningEntries()).toEqual([
      createEntry({ lifecycle: "stopped" }),
    ]);
    expect(reopened.get({ workspaceId: "workspace-101", scriptName: "web" })).toEqual(
      createEntry({ lifecycle: "stopped" }),
    );
    reopenedCatalog.close();
  });

  it("stores and returns entries by workspace and script name", () => {
    const store = new WorkspaceScriptRuntimeStore();
    const entry = createEntry();

    store.set(entry);

    expect(store.get({ workspaceId: "workspace-101", scriptName: "web" })).toEqual(entry);
    expect(store.listForWorkspace("workspace-101")).toEqual([entry]);
  });

  it("preserves whether the runtime entry is a plain script or service", () => {
    const store = new WorkspaceScriptRuntimeStore();
    const entry = createEntry({
      scriptName: "typecheck",
      type: "script",
    });

    store.set(entry);

    expect(store.get({ workspaceId: "workspace-101", scriptName: "typecheck" })).toEqual(entry);
  });

  it("reports whether a script is currently running", () => {
    const store = new WorkspaceScriptRuntimeStore();
    store.set(createEntry());
    store.set(
      createEntry({
        workspaceId: "workspace-101",
        scriptName: "typecheck",
        lifecycle: "stopped",
        terminalId: "terminal-2",
        exitCode: 0,
      }),
    );

    expect(store.isRunning({ workspaceId: "workspace-101", scriptName: "web" })).toBe(true);
    expect(store.isRunning({ workspaceId: "workspace-101", scriptName: "typecheck" })).toBe(false);
    expect(store.isRunning({ workspaceId: "workspace-101", scriptName: "missing" })).toBe(false);
  });

  it("serializes lifecycle operations per Workspace and script without becoming runtime truth", async () => {
    const store = new WorkspaceScriptRuntimeStore();
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const key = { workspaceId: "workspace-101", scriptName: "web" };
    const first = store.runExclusiveOperation(key, async () => {
      await firstBlocked;
      return "first";
    });
    await Promise.resolve();

    await expect(store.runExclusiveOperation(key, async () => "duplicate")).resolves.toEqual({
      acquired: false,
    });
    await expect(
      store.runExclusiveOperation(
        { workspaceId: "workspace-101", scriptName: "api" },
        async () => "independent",
      ),
    ).resolves.toEqual({ acquired: true, value: "independent" });

    releaseFirst();
    await expect(first).resolves.toEqual({ acquired: true, value: "first" });
    await expect(store.runExclusiveOperation(key, async () => "next")).resolves.toEqual({
      acquired: true,
      value: "next",
    });
  });

  it("removes individual entries", () => {
    const store = new WorkspaceScriptRuntimeStore();
    store.set(createEntry());

    store.remove({ workspaceId: "workspace-101", scriptName: "web" });

    expect(store.get({ workspaceId: "workspace-101", scriptName: "web" })).toBeNull();
    expect(store.listForWorkspace("workspace-101")).toEqual([]);
  });

  it("removes all entries for a workspace without touching others", () => {
    const store = new WorkspaceScriptRuntimeStore();
    store.set(createEntry());
    store.set(
      createEntry({
        workspaceId: "workspace-101",
        scriptName: "api",
        terminalId: "terminal-2",
      }),
    );
    store.set(
      createEntry({
        workspaceId: "workspace-202",
        scriptName: "docs",
        terminalId: "terminal-3",
      }),
    );

    store.removeForWorkspace("workspace-101");

    expect(store.listForWorkspace("workspace-101")).toEqual([]);
    expect(store.listForWorkspace("workspace-202")).toEqual([
      createEntry({
        workspaceId: "workspace-202",
        scriptName: "docs",
        terminalId: "terminal-3",
      }),
    ]);
  });
});
