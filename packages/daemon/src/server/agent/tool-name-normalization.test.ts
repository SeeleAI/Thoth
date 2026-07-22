import { describe, expect, it } from "vitest";

import { getThothToolLeafName, isThothToolName } from "@thoth/protocol/tool-name-normalization";

describe("isThothToolName", () => {
  it("detects Claude Code format", () => {
    expect(isThothToolName("mcp__thoth__create_agent")).toBe(true);
    expect(isThothToolName("mcp__thoth__list_agents")).toBe(true);
  });

  it("detects extended Thoth namespaces", () => {
    expect(isThothToolName("mcp__thoth_runtime__create_agent")).toBe(true);
    expect(isThothToolName("thoth_runtime.create_agent")).toBe(true);
  });

  it("detects Codex dot format", () => {
    expect(isThothToolName("thoth.create_agent")).toBe(true);
  });

  it("rejects non-thoth tools", () => {
    expect(isThothToolName("Bash")).toBe(false);
    expect(isThothToolName("Read")).toBe(false);
    expect(isThothToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getThothToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getThothToolLeafName("mcp__thoth__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getThothToolLeafName("thoth.create_agent")).toBe("create_agent");
    expect(getThothToolLeafName("thoth.list_agents")).toBe("list_agents");
  });

  it("returns null for non-thoth tools", () => {
    expect(getThothToolLeafName("Bash")).toBeNull();
  });
});
