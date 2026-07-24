import pino from "pino";
import { describe, expect, it } from "vitest";
import type { HarnessAdapter } from "../agent-runtime.js";
import { CodexHarnessAdapter } from "../server/agent/providers/codex-app-server-agent.js";
import { ClaudeHarnessAdapter } from "../server/agent/providers/claude/agent.js";
import { OpenCodeHarnessAdapter } from "../server/agent/providers/opencode-agent.js";
import { PiHarnessAdapter } from "../server/agent/providers/pi/agent.js";
import { GenericACPHarnessAdapter } from "../server/agent/providers/generic-acp-agent.js";
import type { HarnessToolAttachment } from "./types.js";
import type { ProviderPlanCapability } from "@thoth/protocol/provider-control";

interface ProviderTransportContractCase {
  id: string;
  client: HarnessAdapter;
  toolAttachment: HarnessToolAttachment;
  eventReplay: "cursor" | "live_only";
  plan: ProviderPlanCapability;
}

const logger = pino({ level: "silent" });

function createCases(): ProviderTransportContractCase[] {
  return [
    {
      id: "codex-app-server",
      client: new CodexHarnessAdapter(logger),
      toolAttachment: "native",
      eventReplay: "cursor",
      plan: { kind: "native" },
    },
    {
      id: "claude-sdk",
      client: new ClaudeHarnessAdapter({
        logger,
        resolveBinary: async () => "/fixture/claude",
      }),
      toolAttachment: "mcp",
      eventReplay: "live_only",
      plan: { kind: "native" },
    },
    {
      id: "opencode-server",
      client: new OpenCodeHarnessAdapter(logger),
      toolAttachment: "mcp",
      eventReplay: "live_only",
      plan: { kind: "native" },
    },
    {
      id: "pi-rpc",
      client: new PiHarnessAdapter({ logger }),
      toolAttachment: "mcp",
      eventReplay: "live_only",
      plan: { kind: "unsupported", reason: "Pi does not expose a native Plan mode." },
    },
    {
      id: "generic-acp-process",
      client: new GenericACPHarnessAdapter({
        logger,
        command: ["fixture-acp"],
        providerId: "fixture-acp",
      }),
      toolAttachment: "mcp",
      eventReplay: "live_only",
      plan: { kind: "native" },
    },
  ];
}

describe("provider native transport capability receipts", () => {
  it.each(createCases())("publishes the complete Harness contract for $id", (entry) => {
    expect(entry.client.harnessCapabilities).toEqual({
      instructionAttachment: ["system"],
      toolAttachment: [entry.toolAttachment],
      continuation: "same_thread",
      interrupt: "cooperative",
      eventReplay: entry.eventReplay,
      permissions: "interactive",
      threadPersistence: "native",
      nativeRetention: "provider_owned",
      plan: entry.plan,
    });
  });
});
