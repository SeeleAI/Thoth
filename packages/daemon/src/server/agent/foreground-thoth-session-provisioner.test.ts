import { describe, expect, it } from "vitest";
import {
  NO_HARNESS_CAPABILITIES,
  THOTH_RUNTIME_BUNDLE_CATALOG,
  defineHarnessCapabilities,
  loadRuntimeBundle,
} from "@thoth/drivers/harness";
import { readThothRuntimeToolsConfig } from "./thoth-runtime-tools-config.js";
import { provisionForegroundThothSession } from "./foreground-thoth-session-provisioner.js";

const clarifyBundle = loadRuntimeBundle("thoth.clarify", THOTH_RUNTIME_BUNDLE_CATALOG);

describe("foreground Thoth session provisioner", () => {
  it("attaches the immutable Clarify bundle before a capable foreground thread starts", () => {
    const config = provisionForegroundThothSession({
      config: { provider: "codex", cwd: "/workspace" },
      capabilities: defineHarnessCapabilities({ toolAttachment: ["native"] }),
      bundle: clarifyBundle,
    });

    expect(readThothRuntimeToolsConfig(config)).toEqual({ enabled: true, scope: "clarify" });
    expect(config.systemPrompt).toContain(clarifyBundle.digest);
    expect(config.extra?.thothRuntimeAttachment).toEqual({
      bundleId: "thoth.clarify",
      bundleDigest: clarifyBundle.digest,
      instructionAttachment: "system",
      toolAttachment: "native",
    });
    expect(JSON.stringify(config)).not.toContain("provider-sessions");
  });

  it("does not contaminate internal sessions or adapters without semantic tools", () => {
    const internal = { provider: "codex" as const, cwd: "/workspace", internal: true };
    const unsupported = { provider: "future-provider" as const, cwd: "/workspace" };

    expect(
      provisionForegroundThothSession({
        config: internal,
        capabilities: defineHarnessCapabilities({ toolAttachment: ["mcp"] }),
        bundle: clarifyBundle,
      }),
    ).toBe(internal);
    expect(
      provisionForegroundThothSession({
        config: unsupported,
        capabilities: NO_HARNESS_CAPABILITIES,
        bundle: clarifyBundle,
      }),
    ).toBe(unsupported);
  });

  it("chooses ACP and MCP attachment receipts without inspecting provider identity", () => {
    const acp = provisionForegroundThothSession({
      config: { provider: "future-acp", cwd: "/workspace" },
      capabilities: defineHarnessCapabilities({ toolAttachment: ["acp"] }),
      bundle: clarifyBundle,
    });
    const mcp = provisionForegroundThothSession({
      config: { provider: "future-mcp", cwd: "/workspace" },
      capabilities: defineHarnessCapabilities({ toolAttachment: ["mcp"] }),
      bundle: clarifyBundle,
    });

    expect(acp.extra?.thothRuntimeAttachment).toMatchObject({ toolAttachment: "acp" });
    expect(mcp.extra?.thothRuntimeAttachment).toMatchObject({ toolAttachment: "mcp" });
  });
});
