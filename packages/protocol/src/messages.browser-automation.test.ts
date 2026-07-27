import { describe, expect, test } from "vitest";

import {
  BROWSER_AUTOMATION_COMMAND_NAMES,
  BROWSER_AUTOMATION_TOOL_NAMES,
} from "./browser-automation/rpc-schemas.js";
import { CLIENT_CAPS } from "./client-capabilities.js";
import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  WSHelloMessageSchema,
} from "./messages.js";

describe("browser automation protocol integration", () => {
  const browserId = "11111111-1111-4111-8111-111111111111";
  const authority = {
    workspaceId: "workspace-1",
    agentId: "agent-1",
    executionId: "foreground-turn-1",
    generation: "generation-1",
  };

  test("provider semantic tool names cover the exact browser command portfolio", () => {
    expect(BROWSER_AUTOMATION_TOOL_NAMES).toEqual(
      BROWSER_AUTOMATION_COMMAND_NAMES.map((command) => `browser_${command}`),
    );
  });

  test("browser host capability carries the complete command portfolio in hello", () => {
    const parsed = WSHelloMessageSchema.parse({
      type: "hello",
      clientId: "desktop-1",
      clientType: "mobile",
      protocolVersion: 1,
      capabilities: {
        [CLIENT_CAPS.browserHost]: {
          supportedCommands: [...BROWSER_AUTOMATION_COMMAND_NAMES],
          hostKind: "Thoth Desktop",
        },
      },
    });

    expect(parsed.capabilities?.[CLIENT_CAPS.browserHost]).toEqual({
      supportedCommands: [...BROWSER_AUTOMATION_COMMAND_NAMES],
      hostKind: "Thoth Desktop",
    });
  });

  test("daemon-to-host command is outbound and carries the fenced authority scope", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "browser.automation.execute.request",
        requestId: "browser-request-1",
        ...authority,
        command: { command: "snapshot", args: { browserId } },
      }),
    ).toMatchObject(authority);
  });

  test("browser host response is an inbound session message", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "browser.automation.execute.response",
        payload: {
          requestId: "browser-request-1",
          ok: true,
          result: { command: "list_tabs", tabs: [] },
        },
      }).type,
    ).toBe("browser.automation.execute.response");
  });

  test("rejects commands that omit any authority fence field", () => {
    for (const field of Object.keys(authority)) {
      const candidate = {
        type: "browser.automation.execute.request",
        requestId: `missing-${field}`,
        ...authority,
        command: { command: "snapshot", args: { browserId } },
      } as Record<string, unknown>;
      delete candidate[field];
      expect(SessionOutboundMessageSchema.safeParse(candidate).success).toBe(false);
    }
  });
});
