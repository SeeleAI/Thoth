import pino from "pino";
import { describe, expect, it } from "vitest";
import type { AgentClient } from "../agent-runtime.js";
import { CodexAppServerAgentClient } from "../server/agent/providers/codex-app-server-agent.js";
import { ClaudeAgentClient } from "../server/agent/providers/claude/agent.js";
import { OpenCodeAgentClient } from "../server/agent/providers/opencode-agent.js";
import { PiRpcAgentClient } from "../server/agent/providers/pi/agent.js";
import { GenericACPAgentClient } from "../server/agent/providers/generic-acp-agent.js";
import type { HarnessToolAttachment } from "./types.js";

interface ProviderTransportContractCase {
  id: string;
  client: AgentClient;
  toolAttachment: HarnessToolAttachment;
  eventReplay: "cursor" | "live_only";
}

const logger = pino({ level: "silent" });

function createCases(): ProviderTransportContractCase[] {
  return [
    {
      id: "codex-app-server",
      client: new CodexAppServerAgentClient(logger),
      toolAttachment: "native",
      eventReplay: "cursor",
    },
    {
      id: "claude-sdk",
      client: new ClaudeAgentClient({
        logger,
        resolveBinary: async () => "/fixture/claude",
      }),
      toolAttachment: "mcp",
      eventReplay: "live_only",
    },
    {
      id: "opencode-server",
      client: new OpenCodeAgentClient(logger),
      toolAttachment: "mcp",
      eventReplay: "live_only",
    },
    {
      id: "pi-rpc",
      client: new PiRpcAgentClient({ logger }),
      toolAttachment: "mcp",
      eventReplay: "live_only",
    },
    {
      id: "generic-acp-process",
      client: new GenericACPAgentClient({
        logger,
        command: ["fixture-acp"],
        providerId: "fixture-acp",
      }),
      toolAttachment: "mcp",
      eventReplay: "live_only",
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
    });
  });
});
