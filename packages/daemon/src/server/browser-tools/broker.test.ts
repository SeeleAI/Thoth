import { describe, expect, it, vi } from "vitest";
import type {
  BrowserAutomationExecuteRequest,
  BrowserAutomationExecuteResponse,
} from "@thoth/protocol/browser-automation/rpc-schemas";
import { BROWSER_AUTOMATION_COMMAND_NAMES } from "@thoth/protocol/browser-automation/rpc-schemas";
import { BrowserToolsBroker } from "./broker.js";

const AUTHORITY = {
  workspaceId: "workspace-1",
  agentId: "agent-1",
  executionId: "execution-1",
  generation: "generation-1",
} as const;
const BROWSER_ID = "11111111-1111-4111-8111-111111111111";

function host(id: string) {
  const requests: BrowserAutomationExecuteRequest[] = [];
  return {
    requests,
    client: {
      id,
      hostKind: "Thoth Desktop",
      supportedCommands: [...BROWSER_AUTOMATION_COMMAND_NAMES],
      sendBrowserAutomationRequest(request: BrowserAutomationExecuteRequest) {
        requests.push(request);
      },
    },
  };
}

function okResponse(
  requestId: string,
  result: BrowserAutomationExecuteResponse["payload"] extends infer Payload
    ? Payload extends { ok: true; result: infer Result }
      ? Result
      : never
    : never,
): BrowserAutomationExecuteResponse {
  return {
    type: "browser.automation.execute.response",
    payload: { requestId, ok: true, result },
  } as BrowserAutomationExecuteResponse;
}

describe("BrowserToolsBroker", () => {
  it("returns a typed unavailable receipt when no host is registered", async () => {
    const broker = new BrowserToolsBroker({ createRequestId: () => "request-1" });
    await expect(
      broker.execute({
        ...AUTHORITY,
        command: { command: "list_tabs", args: {} },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "browser_no_host", retryable: true },
    });
  });

  it("forwards every authority fence field and correlates the owning host response", async () => {
    const broker = new BrowserToolsBroker({ createRequestId: () => "request-1" });
    const desktop = host("desktop-1");
    broker.registerClient(desktop.client);

    const result = broker.execute({
      ...AUTHORITY,
      command: { command: "new_tab", args: { url: "https://example.com" } },
    });
    expect(desktop.requests).toEqual([
      {
        type: "browser.automation.execute.request",
        requestId: "request-1",
        ...AUTHORITY,
        command: { command: "new_tab", args: { url: "https://example.com" } },
      },
    ]);

    expect(
      broker.receiveResponse(
        "desktop-2",
        okResponse("request-1", {
          command: "new_tab",
          browserId: BROWSER_ID,
          workspaceId: AUTHORITY.workspaceId,
          url: "https://example.com",
        }),
      ),
    ).toBe(false);
    expect(
      broker.receiveResponse(
        "desktop-1",
        okResponse("request-1", {
          command: "new_tab",
          browserId: BROWSER_ID,
          workspaceId: AUTHORITY.workspaceId,
          url: "https://example.com",
        }),
      ),
    ).toBe(true);
    await expect(result).resolves.toMatchObject({ ok: true });
  });

  it("rejects a browser id already bound to another Workspace without dispatch", async () => {
    let requestSequence = 0;
    const broker = new BrowserToolsBroker({
      createRequestId: () => `request-${++requestSequence}`,
    });
    const desktop = host("desktop-1");
    broker.registerClient(desktop.client);

    const created = broker.execute({
      ...AUTHORITY,
      command: { command: "new_tab", args: {} },
    });
    broker.receiveResponse(
      "desktop-1",
      okResponse("request-1", {
        command: "new_tab",
        browserId: BROWSER_ID,
        workspaceId: AUTHORITY.workspaceId,
        url: "about:blank",
      }),
    );
    await created;

    await expect(
      broker.execute({
        ...AUTHORITY,
        workspaceId: "workspace-2",
        executionId: "execution-2",
        generation: "generation-2",
        command: { command: "snapshot", args: { browserId: BROWSER_ID } },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "browser_scope_mismatch", retryable: false },
    });
    expect(desktop.requests).toHaveLength(1);
  });

  it("rejects a host response that tries to bind a new tab to another Workspace", async () => {
    const broker = new BrowserToolsBroker({ createRequestId: () => "request-1" });
    const desktop = host("desktop-1");
    broker.registerClient(desktop.client);
    const result = broker.execute({
      ...AUTHORITY,
      command: { command: "new_tab", args: {} },
    });

    expect(
      broker.receiveResponse(
        "desktop-1",
        okResponse("request-1", {
          command: "new_tab",
          browserId: BROWSER_ID,
          workspaceId: "workspace-2",
          url: "about:blank",
        }),
      ),
    ).toBe(true);
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: { code: "browser_scope_mismatch" },
    });
  });

  it("returns typed unsupported, timeout, and disconnect receipts", async () => {
    vi.useFakeTimers();
    try {
      const broker = new BrowserToolsBroker({
        defaultTimeoutMs: 50,
        createRequestId: () => "request-1",
      });
      const desktop = host("desktop-1");
      desktop.client.supportedCommands = ["list_tabs"];
      const unregister = broker.registerClient(desktop.client);

      await expect(
        broker.execute({
          ...AUTHORITY,
          command: { command: "new_tab", args: {} },
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "browser_unsupported" },
      });

      const pending = broker.execute({
        ...AUTHORITY,
        command: { command: "list_tabs", args: {} },
      });
      await vi.advanceTimersByTimeAsync(51);
      await expect(pending).resolves.toMatchObject({
        ok: false,
        error: { code: "browser_timeout", retryable: true },
      });

      const disconnected = broker.execute({
        ...AUTHORITY,
        requestId: "request-disconnect",
        command: { command: "list_tabs", args: {} },
      });
      unregister();
      await expect(disconnected).resolves.toMatchObject({
        ok: false,
        error: { code: "browser_no_host", retryable: true },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an in-flight command correlated while the same logical host reconnects", async () => {
    const broker = new BrowserToolsBroker({ createRequestId: () => "request-reconnect" });
    const firstConnection = host("desktop-stable");
    const disconnect = broker.registerClient(firstConnection.client);

    const result = broker.execute({
      ...AUTHORITY,
      command: { command: "navigate", args: { browserId: BROWSER_ID, url: "https://example.com" } },
    });
    expect(firstConnection.requests).toHaveLength(1);

    disconnect({ preservePending: true });
    expect(broker.getRegisteredClientCount()).toBe(0);
    expect(broker.getPendingRequestCount()).toBe(1);

    const resumedConnection = host("desktop-stable");
    broker.registerClient(resumedConnection.client);
    expect(resumedConnection.requests).toEqual(firstConnection.requests);
    expect(
      broker.receiveResponse(
        "desktop-stable",
        okResponse("request-reconnect", {
          command: "navigate",
          browserId: BROWSER_ID,
          url: "https://example.com",
        }),
      ),
    ).toBe(true);
    await expect(result).resolves.toMatchObject({
      ok: true,
      result: { command: "navigate", browserId: BROWSER_ID },
    });
    expect(broker.getPendingRequestCount()).toBe(0);
  });
});
