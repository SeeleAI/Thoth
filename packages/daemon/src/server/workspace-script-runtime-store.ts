import { randomUUID } from "node:crypto";
import type {
  CatalogSettingRecord,
  WorkspaceCatalogStore,
} from "./workspace-authority/catalog-store.js";

export interface ScriptRuntimeEntry {
  workspaceId: string;
  scriptName: string;
  type: "script" | "service";
  lifecycle: "running" | "stopped";
  terminalId: string;
  exitCode: number | null;
}

interface RuntimeEntryKey {
  workspaceId: string;
  scriptName: string;
}

interface ScriptRuntimeReceipt {
  entry: ScriptRuntimeEntry;
  generation: string;
  revision: number;
}

export interface WorkspaceScriptRuntimeReceiptRepository {
  get(key: RuntimeEntryKey): ScriptRuntimeReceipt | null;
  list(): ScriptRuntimeReceipt[];
  put(input: {
    entry: ScriptRuntimeEntry;
    generation: string;
    expectedRevision: number | null;
  }): ScriptRuntimeReceipt | null;
  remove(input: { key: RuntimeEntryKey; expectedRevision: number }): boolean;
}

const RECEIPT_PREFIX = "workspace-script-runtime/";

function receiptKey(key: RuntimeEntryKey): string {
  return `${RECEIPT_PREFIX}${encodeURIComponent(key.workspaceId)}/${encodeURIComponent(key.scriptName)}`;
}

function parseCatalogReceipt(record: CatalogSettingRecord): ScriptRuntimeReceipt {
  const value = record.value;
  const lifecycle = value.lifecycle;
  const type = value.type;
  if (
    value.schemaVersion !== 1 ||
    typeof value.workspaceId !== "string" ||
    typeof value.scriptName !== "string" ||
    (type !== "script" && type !== "service") ||
    (lifecycle !== "running" && lifecycle !== "stopped") ||
    typeof value.terminalId !== "string" ||
    (value.exitCode !== null && typeof value.exitCode !== "number") ||
    typeof value.generation !== "string"
  ) {
    throw new Error(`Invalid Workspace script runtime receipt: ${record.key}`);
  }
  return {
    entry: {
      workspaceId: value.workspaceId,
      scriptName: value.scriptName,
      type,
      lifecycle,
      terminalId: value.terminalId,
      exitCode: value.exitCode,
    },
    generation: value.generation,
    revision: record.revision,
  };
}

export class CatalogWorkspaceScriptRuntimeReceiptRepository implements WorkspaceScriptRuntimeReceiptRepository {
  constructor(private readonly catalog: WorkspaceCatalogStore) {}

  get(key: RuntimeEntryKey): ScriptRuntimeReceipt | null {
    const record = this.catalog.getSetting(receiptKey(key));
    return record ? parseCatalogReceipt(record) : null;
  }

  list(): ScriptRuntimeReceipt[] {
    return this.catalog.listSettings(RECEIPT_PREFIX).map(parseCatalogReceipt);
  }

  put(input: {
    entry: ScriptRuntimeEntry;
    generation: string;
    expectedRevision: number | null;
  }): ScriptRuntimeReceipt | null {
    const record = this.catalog.compareAndSetSetting({
      key: receiptKey(input.entry),
      expectedRevision: input.expectedRevision,
      updatedAt: new Date().toISOString(),
      value: {
        schemaVersion: 1,
        ...input.entry,
        generation: input.generation,
      },
    });
    return record ? parseCatalogReceipt(record) : null;
  }

  remove(input: { key: RuntimeEntryKey; expectedRevision: number }): boolean {
    return this.catalog.removeSetting({
      key: receiptKey(input.key),
      expectedRevision: input.expectedRevision,
    });
  }
}

/** Test fixture repository; production bootstrap always injects the catalog-backed repository. */
class InMemoryWorkspaceScriptRuntimeReceiptRepository implements WorkspaceScriptRuntimeReceiptRepository {
  private readonly receipts = new Map<string, ScriptRuntimeReceipt>();

  get(key: RuntimeEntryKey): ScriptRuntimeReceipt | null {
    const receipt = this.receipts.get(receiptKey(key));
    return receipt ? structuredClone(receipt) : null;
  }

  list(): ScriptRuntimeReceipt[] {
    return Array.from(this.receipts.values(), (receipt) => structuredClone(receipt));
  }

  put(input: {
    entry: ScriptRuntimeEntry;
    generation: string;
    expectedRevision: number | null;
  }): ScriptRuntimeReceipt | null {
    const key = receiptKey(input.entry);
    const current = this.receipts.get(key);
    if ((current?.revision ?? null) !== input.expectedRevision) return null;
    const receipt = {
      entry: { ...input.entry },
      generation: input.generation,
      revision: (current?.revision ?? -1) + 1,
    };
    this.receipts.set(key, receipt);
    return structuredClone(receipt);
  }

  remove(input: { key: RuntimeEntryKey; expectedRevision: number }): boolean {
    const key = receiptKey(input.key);
    if (this.receipts.get(key)?.revision !== input.expectedRevision) return false;
    return this.receipts.delete(key);
  }
}

export class WorkspaceScriptRuntimeStore {
  /** Process-handle coordination only; durable runtime truth remains in receipts. */
  private readonly operationLeases = new Map<string, symbol>();

  constructor(
    private readonly receipts: WorkspaceScriptRuntimeReceiptRepository = new InMemoryWorkspaceScriptRuntimeReceiptRepository(),
  ) {}

  get(key: RuntimeEntryKey): ScriptRuntimeEntry | null {
    const receipt = this.receipts.get(key);
    return receipt ? { ...receipt.entry } : null;
  }

  set(entry: ScriptRuntimeEntry): void {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = this.receipts.get(entry);
      const sameRuntime = current?.entry.terminalId === entry.terminalId;
      const generation = sameRuntime ? current.generation : randomUUID();
      if (
        this.receipts.put({
          entry,
          generation,
          expectedRevision: current?.revision ?? null,
        })
      ) {
        return;
      }
    }
    throw new Error(
      `Workspace script runtime receipt changed concurrently: ${entry.workspaceId}/${entry.scriptName}`,
    );
  }

  remove(key: RuntimeEntryKey): void {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = this.receipts.get(key);
      if (!current || this.receipts.remove({ key, expectedRevision: current.revision })) return;
    }
    throw new Error(
      `Workspace script runtime receipt could not be removed: ${key.workspaceId}/${key.scriptName}`,
    );
  }

  listForWorkspace(workspaceId: string): ScriptRuntimeEntry[] {
    return this.receipts
      .list()
      .filter((receipt) => receipt.entry.workspaceId === workspaceId)
      .map((receipt) => ({ ...receipt.entry }));
  }

  removeForWorkspace(workspaceId: string): void {
    for (const entry of this.listForWorkspace(workspaceId)) {
      this.remove(entry);
    }
  }

  isRunning(key: RuntimeEntryKey): boolean {
    return this.get(key)?.lifecycle === "running";
  }

  async runExclusiveOperation<T>(
    key: RuntimeEntryKey,
    operation: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    const encodedKey = receiptKey(key);
    if (this.operationLeases.has(encodedKey)) return { acquired: false };
    const generation = Symbol(encodedKey);
    this.operationLeases.set(encodedKey, generation);
    try {
      return { acquired: true, value: await operation() };
    } finally {
      if (this.operationLeases.get(encodedKey) === generation) {
        this.operationLeases.delete(encodedKey);
      }
    }
  }

  reconcileStaleRunningEntries(): ScriptRuntimeEntry[] {
    const reconciled: ScriptRuntimeEntry[] = [];
    for (const receipt of this.receipts.list()) {
      if (receipt.entry.lifecycle !== "running") continue;
      const stopped = { ...receipt.entry, lifecycle: "stopped" as const, exitCode: null };
      this.set(stopped);
      reconciled.push(stopped);
    }
    return reconciled;
  }
}
