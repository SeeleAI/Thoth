import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

interface JsonRpcMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

class ScriptedCodexProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly messages: JsonRpcMessage[] = [];
  readonly stderr: string[] = [];
  private readonly waiters = new Set<() => void>();
  private buffer = "";
  private nextRequestId = 1;

  constructor(scriptPath: string, capturePath: string, statePath: string) {
    this.child = spawn(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        THOTH_FAKE_CODEX_CAPTURE: capturePath,
        THOTH_FAKE_CODEX_STATE: statePath,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk: string) => this.stderr.push(chunk));
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextRequestId++;
    this.send({ jsonrpc: "2.0", id, method, params });
    const response = await this.take(
      (message) => message.id === id && message.method === undefined,
    );
    if (response.error !== undefined) {
      throw new Error(`Scripted Codex request ${method} failed: ${JSON.stringify(response.error)}`);
    }
    return response.result;
  }

  send(message: JsonRpcMessage & { jsonrpc?: string }): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async take(predicate: (message: JsonRpcMessage) => boolean): Promise<JsonRpcMessage> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) {
        return this.messages.splice(index, 1)[0];
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for scripted Codex message; stderr=${this.stderr.join("")}`,
        );
      }
      await new Promise<void>((resolveWait) => {
        const timeout = setTimeout(() => {
          this.waiters.delete(wake);
          resolveWait();
        }, 25);
        const wake = () => {
          clearTimeout(timeout);
          this.waiters.delete(wake);
          resolveWait();
        };
        this.waiters.add(wake);
      });
    }
  }

  async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>((resolveClose) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimeout);
        clearTimeout(finalTimeout);
        resolveClose();
      };
      const forceTimeout = setTimeout(() => {
        if (this.child.exitCode === null && this.child.signalCode === null) {
          this.child.kill("SIGKILL");
        }
      }, 1_000);
      const finalTimeout = setTimeout(finish, 2_000);
      this.child.once("close", finish);
      if (!this.child.kill("SIGTERM")) finish();
    });
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      this.messages.push(JSON.parse(line) as JsonRpcMessage);
      for (const wake of [...this.waiters]) wake();
    }
  }
}

const providersDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(providersDirectory, "../../../../../..");
const fixturePath = join(repositoryRoot, "scripts", "fixtures", "scripted-codex-app-server.mjs");
const temporaryDirectories = new Set<string>();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

describe("scripted Codex app-server fixture", () => {
  it("restores the stable tool catalog when a native thread resumes in a new process", async () => {
    const directory = mkdtempSync(join(tmpdir(), "thoth-scripted-codex-resume-"));
    temporaryDirectories.add(directory);
    const capturePath = join(directory, "capture.jsonl");
    const statePath = join(directory, "state.json");
    writeFileSync(statePath, JSON.stringify({ planExec: 0, review: 0 }));

    const first = new ScriptedCodexProcess(fixturePath, capturePath, statePath);
    let second: ScriptedCodexProcess | null = null;
    try {
      const started = (await first.request("thread/start", {
        cwd: directory,
        dynamicTools: [
          { name: "thoth_submit_clarify_card" },
          { name: "thoth_submit_task_card" },
          { name: "thoth_submit_goals_card" },
        ],
      })) as { thread: { id: string } };
      const originalThreadId = started.thread.id;
      await first.stop();

      second = new ScriptedCodexProcess(fixturePath, capturePath, statePath);
      await expect(
        second.request("thread/resume", { threadId: originalThreadId }),
      ).resolves.toMatchObject({ thread: { id: originalThreadId } });

      const turn = (await second.request("turn/start", {
        threadId: originalThreadId,
        input: [
          { type: "skill", name: "thoth.clarify", path: "/fixture/SKILL.md" },
          { type: "text", text: "Follow the installed thoth.clarify skill." },
        ],
      })) as { turn: { id: string } };
      const toolCall = await second.take(
        (message) => message.method === "item/tool/call" && message.params?.turnId === turn.turn.id,
      );
      expect(toolCall.params).toMatchObject({
        threadId: originalThreadId,
        turnId: turn.turn.id,
        tool: "thoth_submit_clarify_card",
      });
      second.send({ jsonrpc: "2.0", id: toolCall.id, result: { success: true } });
      await expect(
        second.take(
          (message) =>
            message.method === "turn/completed" && message.params?.threadId === originalThreadId,
        ),
      ).resolves.toMatchObject({ params: { threadId: originalThreadId } });
      await second.stop();

      const state = JSON.parse(readFileSync(statePath, "utf8")) as {
        dynamicToolNamesByThreadId?: Record<string, string[]>;
      };
      expect(state.dynamicToolNamesByThreadId?.[originalThreadId]).toEqual([
        "thoth_submit_clarify_card",
        "thoth_submit_task_card",
        "thoth_submit_goals_card",
      ]);
      const records = readFileSync(capturePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records).toContainEqual(
        expect.objectContaining({
          kind: "thread_resume",
          threadId: originalThreadId,
          dynamicToolNames: [
            "thoth_submit_clarify_card",
            "thoth_submit_task_card",
            "thoth_submit_goals_card",
          ],
        }),
      );
      expect(records).toContainEqual(
        expect.objectContaining({
          kind: "tool_call",
          threadId: originalThreadId,
          tool: "thoth_submit_clarify_card",
        }),
      );
    } finally {
      await second?.stop();
      await first.stop();
    }
  }, 15_000);
});
