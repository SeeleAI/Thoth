import { describe, expect, it } from "vitest";

import {
  AGENT_TIMELINE_TOOL_CONTENT_LIMIT_BYTES,
  limitAgentTimelineItemContent,
} from "./agent-timeline-content.js";

describe("limitAgentTimelineItemContent", () => {
  it("truncates ASCII shell output once and records original and retained UTF-8 bytes", () => {
    const output = `${"x".repeat(AGENT_TIMELINE_TOOL_CONTENT_LIMIT_BYTES)}SECRET_SUFFIX`;
    const item = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "shell-ascii",
      name: "exec_command",
      status: "completed",
      error: null,
      detail: { type: "shell", command: "run", output },
    });

    expect(item.type).toBe("tool_call");
    if (item.type !== "tool_call" || item.detail.type !== "shell") throw new Error("shell");
    expect(Buffer.byteLength(item.detail.output ?? "", "utf8")).toBe(
      AGENT_TIMELINE_TOOL_CONTENT_LIMIT_BYTES,
    );
    expect(item.detail.output).not.toContain("SECRET_SUFFIX");
    expect(item.metadata?.contentTruncation).toEqual({
      truncated: true,
      encoding: "utf-8",
      strategy: "prefix",
      originalBytes: Buffer.byteLength(output, "utf8"),
      retainedBytes: AGENT_TIMELINE_TOOL_CONTENT_LIMIT_BYTES,
      limitBytes: AGENT_TIMELINE_TOOL_CONTENT_LIMIT_BYTES,
    });
  });

  it("never splits a multi-byte UTF-8 code point at the 64 KiB boundary", () => {
    const output = "你".repeat(21_846);
    const item = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "shell-utf8",
      name: "exec_command",
      status: "completed",
      error: null,
      detail: { type: "shell", command: "run", output },
    });

    if (item.type !== "tool_call" || item.detail.type !== "shell") throw new Error("shell");
    expect(item.detail.output).toBe("你".repeat(21_845));
    expect(item.detail.output).not.toContain("�");
    expect(item.metadata?.contentTruncation).toMatchObject({
      originalBytes: 65_538,
      retainedBytes: 65_535,
      limitBytes: 65_536,
    });
  });

  it("shares one byte budget across duplicated worktree output fields", () => {
    const item = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "worktree-output",
      name: "thoth_worktree_setup",
      status: "completed",
      error: null,
      detail: {
        type: "worktree_setup",
        worktreePath: "/tmp/worktree",
        branchName: "feature",
        log: "a".repeat(40_000),
        commands: [
          {
            index: 1,
            command: "build",
            cwd: "/tmp/worktree",
            log: "b".repeat(40_000),
            status: "completed",
            exitCode: 0,
          },
        ],
      },
    });

    if (item.type !== "tool_call" || item.detail.type !== "worktree_setup") {
      throw new Error("worktree_setup");
    }
    expect(
      Buffer.byteLength(item.detail.log, "utf8") +
        Buffer.byteLength(item.detail.commands[0]?.log ?? "", "utf8"),
    ).toBe(65_536);
    expect(item.detail.truncated).toBe(true);
    expect(item.metadata?.contentTruncation).toMatchObject({
      originalBytes: 80_000,
      retainedBytes: 65_536,
    });
  });

  it("bounds failed shell error content under the same receipt", () => {
    const item = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "failed-shell",
      name: "exec_command",
      status: "failed",
      error: { content: "e".repeat(70_000), code: "failed" },
      detail: { type: "shell", command: "false" },
    });

    if (item.type !== "tool_call" || typeof item.error !== "object" || !item.error) {
      throw new Error("failed shell");
    }
    expect(
      Buffer.byteLength(String("content" in item.error ? item.error.content : ""), "utf8"),
    ).toBe(65_536);
    expect(item.metadata?.contentTruncation).toMatchObject({
      originalBytes: 70_000,
      retainedBytes: 65_536,
    });
  });

  it("strips an untrusted provider-supplied truncation receipt from small content", () => {
    const item = limitAgentTimelineItemContent({
      type: "tool_call",
      callId: "spoofed-receipt",
      name: "exec_command",
      status: "completed",
      error: null,
      detail: { type: "shell", command: "true", output: "ok" },
      metadata: {
        providerField: "preserved",
        contentTruncation: {
          truncated: true,
          encoding: "utf-8",
          strategy: "prefix",
          originalBytes: 999_999,
          retainedBytes: 2,
          limitBytes: 65_536,
        },
      },
    });

    expect(item.type === "tool_call" ? item.metadata : null).toEqual({
      providerField: "preserved",
    });
  });
});
