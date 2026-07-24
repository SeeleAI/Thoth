#!/usr/bin/env node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { AgentPromptInput, AgentStreamEvent } from "@thoth/drivers/agent-runtime";
import {
  createTestHarnessAdapters,
  type FakeAgentProbe,
} from "../packages/daemon/src/server/test-utils/fake-harness-adapter.ts";
import {
  createTestThothDaemon,
  DaemonClient,
} from "../packages/daemon/src/server/test-utils/index.ts";

const sampleCount = 1;
const timeoutMs = 15_000;

interface ActiveSample {
  marker: string;
  sendAtMs: number;
  adapterInvocation: Deferred<number>;
  providerEvent: Deferred<number>;
  clientEvent: Deferred<number>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

let activeSample: ActiveSample | null = null;

const probe: FakeAgentProbe = {
  onStartTurn(input) {
    if (!activeSample || !promptContains(input.prompt, activeSample.marker)) return;
    activeSample.adapterInvocation.resolve(input.timestampMs);
  },
  onEvent(input) {
    if (!activeSample || !isAssistantTimeline(input.event)) return;
    activeSample.providerEvent.resolve(input.timestampMs);
  },
};

const daemon = await createTestThothDaemon({ harnessAdapters: createTestHarnessAdapters(probe) });
const client = new DaemonClient({
  url: `ws://127.0.0.1:${daemon.port}/ws`,
  reconnect: { enabled: false },
});
const workspace = mkdtempSync(join(tmpdir(), "thoth-refactor-response-"));

try {
  await client.connect();
  const unsubscribe = client.subscribe((event) => {
    if (
      activeSample &&
      event.type === "agent_stream" &&
      isAssistantTimeline(event.event as AgentStreamEvent)
    ) {
      activeSample.clientEvent.resolve(performance.now());
    }
  });

  try {
    const agent = await client.createAgent({
      provider: "codex",
      model: "gpt-5.4-mini",
      modeId: "auto",
      cwd: workspace,
      initialPrompt: "REFACTOR_RESPONSE_WARMUP",
      thoth: { enabled: false },
    });
    await waitForAgentIdle(client, agent.id);

    const marker = `REFACTOR_RESPONSE_${process.pid}`;
    const sample: ActiveSample = {
      marker,
      sendAtMs: performance.now(),
      adapterInvocation: deferred<number>(),
      providerEvent: deferred<number>(),
      clientEvent: deferred<number>(),
    };
    activeSample = sample;
    sample.sendAtMs = performance.now();
    await client.sendAgentMessage(agent.id, `Respond with exactly: ${marker}`, {
      messageId: `refactor-response-${process.pid}`,
      deliveryMode: "queue",
      thoth: { enabled: false },
    });
    const [adapterInvocationAtMs, providerEventAtMs, clientEventAtMs] = await Promise.all([
      withTimeout(sample.adapterInvocation.promise, timeoutMs, "adapter invocation"),
      withTimeout(sample.providerEvent.promise, timeoutMs, "provider event"),
      withTimeout(sample.clientEvent.promise, timeoutMs, "client event"),
    ]);
    await waitForAgentIdle(client, agent.id);
    const samples = [
      {
        clientToAdapterMs: adapterInvocationAtMs - sample.sendAtMs,
        providerDelayMs: providerEventAtMs - adapterInvocationAtMs,
        adapterEventToClientMs: clientEventAtMs - providerEventAtMs,
        localResponseOverheadMs:
          adapterInvocationAtMs - sample.sendAtMs + clientEventAtMs - providerEventAtMs,
      },
    ];
    activeSample = null;

    process.stdout.write(`${JSON.stringify({ sampleCount, samples })}\n`);
  } finally {
    unsubscribe();
  }
} finally {
  activeSample = null;
  await client.close().catch(() => undefined);
  await daemon.close().catch(() => undefined);
  rmSync(workspace, { recursive: true, force: true });
}

process.exit(0);

function promptContains(prompt: AgentPromptInput, marker: string): boolean {
  return (typeof prompt === "string" ? prompt : JSON.stringify(prompt)).includes(marker);
}

function isAssistantTimeline(event: AgentStreamEvent): boolean {
  return event.type === "timeline" && event.item.type === "assistant_message";
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function withTimeout<T>(promise: Promise<T>, durationMs: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), durationMs).unref();
    }),
  ]);
}

async function waitForAgentIdle(client: DaemonClient, agentId: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await client.fetchAgent({ agentId });
    if (snapshot?.agent.status === "idle") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for agent ${agentId} to become idle`);
}
