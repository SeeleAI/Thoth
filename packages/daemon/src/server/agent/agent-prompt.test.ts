import { expect, it, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { ExecutionService } from "./execution-service.js";
import { AgentStorage } from "./agent-storage.js";
import {
  formatSystemNotificationPrompt,
  isSystemInjectedEnvelope,
  sendPromptToAgent,
  setupFinishNotification,
  unarchiveAgentState,
} from "./agent-prompt.js";
import type { ExecutionServiceEvent, ManagedAgent } from "./execution-service.js";

interface FinishNotificationScenarioOptions {
  childLastAssistantMessage?: string | null;
}

interface FinishNotificationScenario {
  startWatchingChild(): void;
  finishChildAndReadParentPrompt(): Promise<string>;
}

function createFinishNotificationScenario(
  options?: FinishNotificationScenarioOptions,
): FinishNotificationScenario {
  let subscriber: ((event: ExecutionServiceEvent) => void) | null = null;
  let resolveParentPrompt: ((prompt: string) => void) | null = null;

  const childAgent: ManagedAgent = Object.create(null);
  Reflect.set(childAgent, "id", "child-agent");
  Reflect.set(childAgent, "lifecycle", "idle");
  Reflect.set(childAgent, "config", { title: "Child Agent" });

  const callerAgent: ManagedAgent = Object.create(null);
  Reflect.set(callerAgent, "id", "caller-agent");
  Reflect.set(callerAgent, "lifecycle", "idle");
  Reflect.set(callerAgent, "config", { title: "Caller Agent" });

  const executionService: ExecutionService = Object.create(ExecutionService.prototype);
  Reflect.set(executionService, "getAgent", (agentId: string) => {
    if (agentId === "child-agent") {
      return childAgent;
    }
    if (agentId === "caller-agent") {
      return callerAgent;
    }
    return null;
  });
  Reflect.set(executionService, "subscribe", (callback: (event: ExecutionServiceEvent) => void) => {
    subscriber = callback;
    return () => {
      subscriber = null;
    };
  });
  Reflect.set(executionService, "getLastAssistantMessage", async () => {
    return options?.childLastAssistantMessage ?? null;
  });
  Reflect.set(executionService, "waitForAgentClose", async () => {});
  Reflect.set(executionService, "tryRunOutOfBand", () => false);
  Reflect.set(executionService, "hasInFlightRun", () => false);
  Reflect.set(executionService, "streamAgent", (_agentId: string, prompt: string) => {
    resolveParentPrompt?.(prompt);
    return (async function* noop() {})();
  });

  const agentStorage: AgentStorage = Object.create(AgentStorage.prototype);
  Reflect.set(agentStorage, "get", async (agentId: string) => {
    if (agentId === "child-agent") {
      return { title: "Child Agent" };
    }
    return null;
  });

  return {
    startWatchingChild() {
      setupFinishNotification({
        executionService,
        agentStorage,
        childAgentId: "child-agent",
        callerAgentId: "caller-agent",
        logger: createTestLogger(),
      });
    },
    async finishChildAndReadParentPrompt() {
      const parentPrompt = new Promise<string>((resolve) => {
        resolveParentPrompt = resolve;
      });

      childAgent.lifecycle = "running";
      subscriber?.({
        type: "agent_state",
        agent: childAgent,
      });

      childAgent.lifecycle = "idle";
      subscriber?.({
        type: "agent_state",
        agent: childAgent,
      });

      return parentPrompt;
    },
  };
}

test("isSystemInjectedEnvelope matches the envelope formatSystemNotificationPrompt produces", () => {
  expect(isSystemInjectedEnvelope(formatSystemNotificationPrompt("child finished"))).toBe(true);
  expect(isSystemInjectedEnvelope("hello world")).toBe(false);
});

test("unarchiveAgentState does not notify before a stored Agent is registered live", async () => {
  const unarchiveSnapshot = vi.fn(async () => true);
  const notifyAgentState = vi.fn(() => {
    throw new Error("Unknown agent");
  });
  const executionService: ExecutionService = Object.create(ExecutionService.prototype);
  Reflect.set(executionService, "unarchiveSnapshot", unarchiveSnapshot);
  Reflect.set(executionService, "notifyAgentState", notifyAgentState);
  const agentStorage: AgentStorage = Object.create(AgentStorage.prototype);

  await expect(unarchiveAgentState(agentStorage, executionService, "stored-agent")).resolves.toBe(
    true,
  );
  expect(unarchiveSnapshot).toHaveBeenCalledWith("stored-agent");
  expect(notifyAgentState).not.toHaveBeenCalled();
});

test("sendPromptToAgent forwards the client message id as run options", async () => {
  const agent: ManagedAgent = Object.create(null);
  Reflect.set(agent, "id", "agent-1");
  Reflect.set(agent, "provider", "codex");

  const streamAgentSpy = vi.fn(() => (async function* noop() {})());
  const executionService: ExecutionService = Object.create(ExecutionService.prototype);
  Reflect.set(
    executionService,
    "getAgent",
    vi.fn(() => agent),
  );
  Reflect.set(executionService, "tryRunOutOfBand", vi.fn().mockReturnValue(false));
  Reflect.set(executionService, "hasInFlightRun", vi.fn().mockReturnValue(false));
  Reflect.set(executionService, "waitForAgentClose", vi.fn().mockResolvedValue(undefined));
  Reflect.set(executionService, "streamAgent", streamAgentSpy);

  const agentStorage: AgentStorage = Object.create(AgentStorage.prototype);
  Reflect.set(
    agentStorage,
    "get",
    vi.fn(async () => null),
  );

  await sendPromptToAgent({
    executionService,
    agentStorage,
    agentId: "agent-1",
    prompt: "hello",
    messageId: "msg-client-1",
    runOptions: { outputSchema: { type: "object" } },
    logger: createTestLogger(),
  });

  expect(streamAgentSpy).toHaveBeenCalledWith("agent-1", "hello", {
    outputSchema: { type: "object" },
    messageId: "msg-client-1",
  });
});

test("finish notifications tell the parent the child's last assistant message", async () => {
  const scenario = createFinishNotificationScenario({
    childLastAssistantMessage: "Implemented the cleanup and all checks pass.",
  });

  scenario.startWatchingChild();
  const parentPrompt = await scenario.finishChildAndReadParentPrompt();

  expect(parentPrompt).toEqual(
    formatSystemNotificationPrompt(
      "Agent child-agent (Child Agent) finished.\n\n<agent-response>\nImplemented the cleanup and all checks pass.\n</agent-response>",
    ),
  );
});

it("does not notify archived callers", async () => {
  let subscriber: ((event: ExecutionServiceEvent) => void) | null = null;

  const childAgent: ManagedAgent = Object.create(null);
  Reflect.set(childAgent, "id", "child-agent");
  Reflect.set(childAgent, "lifecycle", "idle");
  Reflect.set(childAgent, "config", { title: "Child Agent" });

  const callerAgent: ManagedAgent = Object.create(null);
  Reflect.set(callerAgent, "id", "caller-agent");
  Reflect.set(callerAgent, "lifecycle", "idle");
  Reflect.set(callerAgent, "config", { title: "Caller Agent" });

  const streamAgentSpy = vi.fn(() => (async function* noop() {})());
  const replaceAgentRunSpy = vi.fn(() => (async function* noop() {})());

  const executionService: ExecutionService = Object.create(ExecutionService.prototype);
  Reflect.set(
    executionService,
    "getAgent",
    vi.fn((agentId: string) => {
      if (agentId === "child-agent") {
        return childAgent;
      }
      if (agentId === "caller-agent") {
        return callerAgent;
      }
      return null;
    }),
  );
  Reflect.set(
    executionService,
    "subscribe",
    vi.fn((callback: (event: ExecutionServiceEvent) => void) => {
      subscriber = callback;
      return () => {
        subscriber = null;
      };
    }),
  );
  Reflect.set(executionService, "hasInFlightRun", vi.fn().mockReturnValue(false));
  Reflect.set(executionService, "streamAgent", streamAgentSpy);
  Reflect.set(executionService, "replaceAgentRun", replaceAgentRunSpy);

  const agentStorageGetSpy = vi.fn(async (agentId: string) =>
    agentId === "caller-agent" ? { archivedAt: "2024-01-01" } : null,
  );
  const agentStorage: AgentStorage = Object.create(AgentStorage.prototype);
  Reflect.set(agentStorage, "get", agentStorageGetSpy);

  setupFinishNotification({
    executionService,
    agentStorage,
    childAgentId: "child-agent",
    callerAgentId: "caller-agent",
    logger: createTestLogger(),
  });

  expect(subscriber).not.toBeNull();

  childAgent.lifecycle = "running";
  subscriber?.({
    type: "agent_state",
    agent: childAgent,
  });

  childAgent.lifecycle = "idle";
  subscriber?.({
    type: "agent_state",
    agent: childAgent,
  });

  await vi.waitFor(() => {
    expect(agentStorageGetSpy).toHaveBeenCalledWith("caller-agent");
  });

  expect(streamAgentSpy).not.toHaveBeenCalled();
  expect(replaceAgentRunSpy).not.toHaveBeenCalled();
});
