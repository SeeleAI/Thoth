import type { SessionInboundMessage, SessionOutboundMessage } from "@thoth/protocol/messages";
import { getDesktopHost, type DesktopHostBridge } from "@/desktop/host";
import {
  ensureResidentBrowserWebview as ensureResidentBrowserWebviewDefault,
  removeResidentBrowserWebview,
  resizeResidentBrowserWebview,
} from "@/components/browser-webview-resident";
import { createWorkspaceBrowser, getBrowserRecord, useBrowserStore } from "@/stores/browser-store";
import {
  buildWorkspaceTabPersistenceKey,
  collectAllTabs,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";

type BrowserAutomationExecuteRequest = Extract<
  SessionOutboundMessage,
  { type: "browser.automation.execute.request" }
>;
type BrowserAutomationExecuteResponse = Extract<
  SessionInboundMessage,
  { type: "browser.automation.execute.response" }
>;
type BrowserAutomationResponsePayload = BrowserAutomationExecuteResponse["payload"];
type BrowserAutomationFailurePayload = Extract<BrowserAutomationResponsePayload, { ok: false }>;
type BrowserAutomationErrorCode = BrowserAutomationFailurePayload["error"]["code"];

interface BrowserAutomationClient {
  on(
    type: "browser.automation.execute.request",
    handler: (message: BrowserAutomationExecuteRequest) => void,
  ): () => void;
  sendBrowserAutomationExecuteResponse(response: BrowserAutomationExecuteResponse): boolean | void;
}

type BrowserAutomationResponseSender = (
  response: BrowserAutomationExecuteResponse,
) => boolean | void;

interface CoordinatedBrowserAutomationRequest {
  fingerprint: string;
  response: BrowserAutomationExecuteResponse | null;
  completedAt: number | null;
}

const DEFAULT_COORDINATOR_RETENTION_MS = 30_000;
const DEFAULT_COORDINATOR_MAX_ENTRIES = 256;

export class BrowserAutomationRequestCoordinator {
  private readonly entries = new Map<string, CoordinatedBrowserAutomationRequest>();
  private readonly senderByScope = new Map<
    string,
    { token: symbol; sender: BrowserAutomationResponseSender }
  >();

  public constructor(
    private readonly options: {
      now?: () => number;
      retentionMs?: number;
      maxEntries?: number;
    } = {},
  ) {}

  public registerSender(scope: string, sender: BrowserAutomationResponseSender): () => void {
    this.prune();
    const token = Symbol(scope);
    this.senderByScope.set(scope, { token, sender });
    for (const [key, entry] of this.entries) {
      if (this.scopeFromKey(key) === scope && entry.response) {
        this.deliver(scope, entry.response);
      }
    }
    return () => {
      if (this.senderByScope.get(scope)?.token === token) {
        this.senderByScope.delete(scope);
      }
    };
  }

  public execute(input: {
    scope: string;
    request: BrowserAutomationExecuteRequest;
    run: () => Promise<BrowserAutomationResponsePayload>;
  }): void {
    this.prune();
    const key = this.key(input.scope, input.request.requestId);
    const fingerprint = JSON.stringify(input.request);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        this.deliver(
          input.scope,
          toBrowserAutomationResponse(
            browserAutomationFailure({
              requestId: input.request.requestId,
              code: "browser_scope_mismatch",
              message: "Browser automation request ID was reused with different scope or input.",
            }),
          ),
        );
      } else if (existing.response) {
        this.deliver(input.scope, existing.response);
      }
      return;
    }

    const entry: CoordinatedBrowserAutomationRequest = {
      fingerprint,
      response: null,
      completedAt: null,
    };
    this.entries.set(key, entry);
    void input
      .run()
      .catch((error) => normalizeThrownBridgeError(input.request.requestId, error))
      .then((payload) => {
        entry.response = toBrowserAutomationResponse(payload);
        entry.completedAt = this.now();
        this.deliver(input.scope, entry.response);
        this.prune();
      });
  }

  private deliver(scope: string, response: BrowserAutomationExecuteResponse): void {
    const sender = this.senderByScope.get(scope)?.sender;
    if (!sender) {
      return;
    }
    try {
      sender(response);
    } catch {
      // The response remains cached for the replacement logical client.
    }
  }

  private prune(): void {
    const retentionMs = this.options.retentionMs ?? DEFAULT_COORDINATOR_RETENTION_MS;
    const cutoff = this.now() - retentionMs;
    for (const [key, entry] of this.entries) {
      if (entry.completedAt !== null && entry.completedAt < cutoff) {
        this.entries.delete(key);
      }
    }
    const maxEntries = this.options.maxEntries ?? DEFAULT_COORDINATOR_MAX_ENTRIES;
    if (this.entries.size <= maxEntries) {
      return;
    }
    const completed = Array.from(this.entries.entries())
      .filter((entry): entry is [string, CoordinatedBrowserAutomationRequest] => {
        return entry[1].completedAt !== null;
      })
      .sort((left, right) => (left[1].completedAt ?? 0) - (right[1].completedAt ?? 0));
    for (const [key] of completed) {
      if (this.entries.size <= maxEntries) {
        return;
      }
      this.entries.delete(key);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private key(scope: string, requestId: string): string {
    return `${scope}\u0000${requestId}`;
  }

  private scopeFromKey(key: string): string {
    return key.slice(0, key.indexOf("\u0000"));
  }
}

const defaultBrowserAutomationRequestCoordinator = new BrowserAutomationRequestCoordinator();

export interface BrowserAutomationHandlerOptions {
  client: BrowserAutomationClient;
  serverId?: string;
  getHost?: () => DesktopHostBridge | null;
  ensureResidentBrowserWebview?: typeof ensureResidentBrowserWebviewDefault;
  registrationWaitTimeoutMs?: number;
  registrationPollIntervalMs?: number;
  coordinator?: BrowserAutomationRequestCoordinator;
}

export function mountBrowserAutomationHandler(
  options: BrowserAutomationHandlerOptions,
): () => void {
  const getHost = options.getHost ?? getDesktopHost;
  const scope = options.serverId ?? "local-desktop";
  const coordinator = options.coordinator ?? defaultBrowserAutomationRequestCoordinator;
  const unregisterSender = coordinator.registerSender(scope, (response) =>
    options.client.sendBrowserAutomationExecuteResponse(response),
  );
  const unsubscribe = options.client.on("browser.automation.execute.request", (request) => {
    coordinator.execute({
      scope,
      request,
      run: () =>
        executeBrowserAutomationRequest({
          getHost,
          request,
          serverId: options.serverId,
          ensureResidentBrowserWebview:
            options.ensureResidentBrowserWebview ?? ensureResidentBrowserWebviewDefault,
          ...(options.registrationWaitTimeoutMs !== undefined
            ? { registrationWaitTimeoutMs: options.registrationWaitTimeoutMs }
            : {}),
          ...(options.registrationPollIntervalMs !== undefined
            ? { registrationPollIntervalMs: options.registrationPollIntervalMs }
            : {}),
        }),
    });
  });
  return () => {
    unsubscribe();
    unregisterSender();
  };
}

export function mountBrowserAutomationDaemonClientHandler(
  client: unknown,
  options?: { serverId?: string },
): () => void {
  return mountBrowserAutomationHandler({
    client: client as BrowserAutomationClient,
    ...(options?.serverId ? { serverId: options.serverId } : {}),
  });
}

async function executeBrowserAutomationRequest(params: {
  getHost: () => DesktopHostBridge | null;
  request: BrowserAutomationExecuteRequest;
  serverId?: string;
  ensureResidentBrowserWebview: typeof ensureResidentBrowserWebviewDefault;
  registrationWaitTimeoutMs?: number;
  registrationPollIntervalMs?: number;
}): Promise<BrowserAutomationResponsePayload> {
  const {
    getHost,
    request,
    serverId,
    ensureResidentBrowserWebview,
    registrationWaitTimeoutMs,
    registrationPollIntervalMs,
  } = params;
  const browserHost = getHost()?.browser;
  const executeAutomationCommand = browserHost?.executeAutomationCommand;

  if (request.command.command === "new_tab") {
    try {
      return await openBrowserTabForRequest({
        request,
        serverId,
        browserHost,
        ensureResidentBrowserWebview,
        ...(registrationWaitTimeoutMs !== undefined ? { registrationWaitTimeoutMs } : {}),
        ...(registrationPollIntervalMs !== undefined ? { registrationPollIntervalMs } : {}),
      });
    } catch (error) {
      return normalizeThrownBridgeError(request.requestId, error);
    }
  }

  if (request.command.command === "resize") {
    return resizeBrowserTabForRequest({ request, serverId });
  }

  if (request.command.command === "close_tab") {
    try {
      return await closeBrowserTabForRequest({
        request,
        serverId,
        browserHost,
      });
    } catch (error) {
      return normalizeThrownBridgeError(request.requestId, error);
    }
  }

  if (!executeAutomationCommand) {
    return browserAutomationFailure({
      requestId: request.requestId,
      code: "browser_unsupported",
      message: "Browser automation is not available in this app runtime.",
    });
  }

  try {
    const payload = await executeAutomationCommand(request);
    return normalizeBridgePayload(request.requestId, payload);
  } catch (error) {
    return normalizeThrownBridgeError(request.requestId, error);
  }
}

function toBrowserAutomationResponse(
  payload: BrowserAutomationResponsePayload,
): BrowserAutomationExecuteResponse {
  return {
    type: "browser.automation.execute.response",
    payload,
  };
}

function resizeBrowserTabForRequest(params: {
  request: BrowserAutomationExecuteRequest;
  serverId?: string;
}): BrowserAutomationResponsePayload {
  const { request, serverId } = params;
  const command = request.command as Extract<
    BrowserAutomationExecuteRequest["command"],
    { command: "resize" }
  >;
  const browserId = command.args.browserId;
  if (!getBrowserRecord(browserId)) {
    return browserAutomationFailure({
      requestId: request.requestId,
      code: "browser_tab_not_found",
      message: `No browser tab found for ID: ${browserId}`,
    });
  }

  const workspaceId = request.workspaceId;
  if (serverId && workspaceId && !findWorkspaceBrowserTab({ serverId, workspaceId, browserId })) {
    return browserAutomationFailure({
      requestId: request.requestId,
      code: "browser_tab_not_found",
      message: `No browser tab found for ID: ${browserId}`,
    });
  }

  const dimensions = resizeResidentBrowserWebview({
    browserId,
    width: command.args.width,
    height: command.args.height,
  });
  if (!dimensions) {
    return browserAutomationFailure({
      requestId: request.requestId,
      code: "browser_tab_not_found",
      message: `No browser tab found for ID: ${browserId}`,
    });
  }

  return {
    requestId: request.requestId,
    ok: true,
    result: {
      command: "resize",
      browserId,
      width: dimensions.width,
      height: dimensions.height,
    },
  };
}

async function closeBrowserTabForRequest(params: {
  request: BrowserAutomationExecuteRequest;
  serverId?: string;
  browserHost: DesktopHostBridge["browser"] | undefined;
}): Promise<BrowserAutomationResponsePayload> {
  const { request, serverId, browserHost } = params;
  const command = request.command as Extract<
    BrowserAutomationExecuteRequest["command"],
    { command: "close_tab" }
  >;
  const browserId = command.args.browserId;
  const workspaceId = request.workspaceId;
  const workspaceTab = serverId
    ? findWorkspaceBrowserTab({ serverId, workspaceId, browserId })
    : null;
  if (!workspaceTab && (!serverId || !workspaceId)) {
    return browserAutomationFailure({
      requestId: request.requestId,
      code: "browser_unsupported",
      message: "Cannot close a browser tab without a workspace context.",
    });
  }
  if (!workspaceTab || !getBrowserRecord(browserId)) {
    return browserAutomationFailure({
      requestId: request.requestId,
      code: "browser_tab_not_found",
      message: `No browser tab found for ID: ${browserId}`,
    });
  }

  useWorkspaceLayoutStore.getState().closeTab(workspaceTab.workspaceKey, workspaceTab.tabId);
  useBrowserStore.getState().removeBrowser(browserId);
  removeResidentBrowserWebview(browserId);
  await browserHost?.unregisterWorkspaceBrowser?.(browserId);

  return {
    requestId: request.requestId,
    ok: true,
    result: { command: "close_tab", browserId },
  };
}

function findWorkspaceBrowserTab(input: {
  serverId: string;
  workspaceId: string | undefined;
  browserId: string;
}): { workspaceKey: string; tabId: string } | null {
  if (!input.workspaceId) {
    return null;
  }
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return null;
  }
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
  const tab = layout
    ? collectAllTabs(layout.root).find((candidate) => {
        return (
          candidate.target.kind === "browser" && candidate.target.browserId === input.browserId
        );
      })
    : null;
  return tab ? { workspaceKey, tabId: tab.tabId } : null;
}

async function openBrowserTabForRequest(params: {
  request: BrowserAutomationExecuteRequest;
  serverId?: string;
  browserHost: DesktopHostBridge["browser"] | undefined;
  ensureResidentBrowserWebview: typeof ensureResidentBrowserWebviewDefault;
  registrationWaitTimeoutMs?: number;
  registrationPollIntervalMs?: number;
}): Promise<BrowserAutomationResponsePayload> {
  const {
    request,
    serverId,
    browserHost,
    ensureResidentBrowserWebview,
    registrationWaitTimeoutMs,
    registrationPollIntervalMs,
  } = params;
  const command = request.command as Extract<
    BrowserAutomationExecuteRequest["command"],
    { command: "new_tab" }
  >;
  const workspaceId = request.workspaceId;
  if (!serverId || !workspaceId) {
    return browserAutomationFailure({
      requestId: request.requestId,
      code: "browser_unsupported",
      message: "Cannot create a browser tab without a workspace context.",
    });
  }

  const url = command.args.url ?? "https://example.com";
  const { browserId, url: normalizedUrl } = createWorkspaceBrowser({ initialUrl: url });
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  if (!workspaceKey) {
    return browserAutomationFailure({
      requestId: request.requestId,
      code: "browser_unsupported",
      message: "Cannot create a browser tab without a workspace context.",
    });
  }
  useWorkspaceLayoutStore.getState().openTabInBackground(workspaceKey, {
    kind: "browser",
    browserId,
  });

  if (browserHost?.executeAutomationCommand) {
    ensureResidentBrowserWebview({ browserId, workspaceId, url: normalizedUrl });
    const registered = await waitForBrowserRegistration({
      request,
      browserId,
      workspaceId,
      executeAutomationCommand: browserHost.executeAutomationCommand,
      ...(registrationWaitTimeoutMs !== undefined ? { timeoutMs: registrationWaitTimeoutMs } : {}),
      ...(registrationPollIntervalMs !== undefined
        ? { pollIntervalMs: registrationPollIntervalMs }
        : {}),
    });
    if (!registered) {
      return browserAutomationFailure({
        requestId: request.requestId,
        code: "browser_timeout",
        message: `Timed out waiting for browser tab ${browserId} to register with the browser automation host. Try browser_new_tab again.`,
        retryable: true,
      });
    }
  }

  return {
    requestId: request.requestId,
    ok: true,
    result: { command: "new_tab", browserId, workspaceId, url: normalizedUrl },
  };
}

async function waitForBrowserRegistration(params: {
  request: BrowserAutomationExecuteRequest;
  browserId: string;
  workspaceId: string;
  executeAutomationCommand: (
    request: BrowserAutomationExecuteRequest,
  ) => Promise<BrowserAutomationResponsePayload>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<boolean> {
  const deadline = Date.now() + (params.timeoutMs ?? 5_000);
  while (Date.now() < deadline) {
    const payload = await params.executeAutomationCommand({
      type: "browser.automation.execute.request",
      requestId: `${params.request.requestId}:list_tabs`,
      agentId: params.request.agentId,
      cwd: params.request.cwd,
      workspaceId: params.workspaceId,
      executionId: params.request.executionId,
      generation: params.request.generation,
      command: { command: "list_tabs", args: {} },
    });
    if (payload.ok && payload.result.command === "list_tabs") {
      if (payload.result.tabs.some((tab) => tab.browserId === params.browserId)) {
        return true;
      }
    }
    await delay(params.pollIntervalMs ?? 100);
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBridgePayload(
  requestId: string,
  payload: BrowserAutomationResponsePayload,
): BrowserAutomationResponsePayload {
  return { ...payload, requestId } as BrowserAutomationResponsePayload;
}

function normalizeThrownBridgeError(
  requestId: string,
  error: unknown,
): BrowserAutomationFailurePayload {
  const typed = readTypedBrowserAutomationError(error);
  if (typed) {
    return browserAutomationFailure({ requestId, ...typed });
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("No handler registered")) {
    return browserAutomationFailure({
      requestId,
      code: "browser_unsupported",
      message: "Browser automation is not implemented by this app build yet.",
    });
  }

  return browserAutomationFailure({
    requestId,
    code: "browser_unknown_error",
    message: message || "Browser automation failed.",
  });
}

function readTypedBrowserAutomationError(
  value: unknown,
): { code: BrowserAutomationErrorCode; message: string; retryable?: boolean } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string" || !record.code.startsWith("browser_")) {
    return null;
  }
  if (typeof record.message !== "string" || record.message.length === 0) {
    return null;
  }
  return {
    code: record.code as BrowserAutomationErrorCode,
    message: record.message,
    ...(typeof record.retryable === "boolean" ? { retryable: record.retryable } : {}),
  };
}

function browserAutomationFailure(params: {
  requestId: string;
  code: BrowserAutomationErrorCode;
  message: string;
  retryable?: boolean;
}): BrowserAutomationFailurePayload {
  return {
    requestId: params.requestId,
    ok: false,
    error: {
      code: params.code,
      message: params.message,
      retryable: params.retryable ?? false,
    },
  };
}
