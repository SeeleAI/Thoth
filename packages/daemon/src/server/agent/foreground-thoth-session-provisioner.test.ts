import { describe, expect, it } from "vitest";
import {
  THOTH_RUNTIME_BUNDLE_CATALOG,
  defineHarnessCapabilities,
  loadRuntimeBundle,
} from "@thoth/drivers/harness";
import { provisionForegroundThothSession } from "./foreground-thoth-session-provisioner.js";

const clarifyBundle = loadRuntimeBundle("thoth.clarify", THOTH_RUNTIME_BUNDLE_CATALOG);

describe("foreground Thoth session provisioner", () => {
  it("does not inject the Clarify bundle into a new foreground Agent config", () => {
    const config = provisionForegroundThothSession({
      config: { provider: "codex", cwd: "/workspace" },
      capabilities: defineHarnessCapabilities({ toolAttachment: ["native"] }),
      bundle: clarifyBundle,
    });

    expect(config).toEqual({ provider: "codex", cwd: "/workspace" });
    expect(JSON.stringify(config)).not.toContain("provider-sessions");
  });

  it("removes only a provenance-matched generated suffix and preserves the user prompt", () => {
    const marker = `[Thoth RuntimeBundle ${clarifyBundle.id} ${clarifyBundle.digest}]`;
    const generated = [
      marker,
      "The following RuntimeBundle is session-scoped capability. Apply it only when the current daemon-authorized turn activates Thoth; raw turns must remain normal provider conversation.",
      clarifyBundle.instructions,
    ].join("\n\n");
    const config = provisionForegroundThothSession({
      config: {
        provider: "codex",
        cwd: "/workspace",
        systemPrompt: `Keep my own instruction.\n\n${generated}`,
        extra: {
          keep: "user-value",
          thothRuntimeTools: { enabled: true, scope: "clarify" },
          thothRuntimeAttachment: {
            bundleId: clarifyBundle.id,
            bundleDigest: clarifyBundle.digest,
          },
        },
      },
      capabilities: defineHarnessCapabilities({ toolAttachment: ["native"] }),
      bundle: clarifyBundle,
    });

    expect(config.systemPrompt).toBe("Keep my own instruction.");
    expect(config.extra).toEqual({ keep: "user-value" });
    expect(
      provisionForegroundThothSession({
        config,
        capabilities: defineHarnessCapabilities({ toolAttachment: ["native"] }),
        bundle: clarifyBundle,
      }),
    ).toEqual(config);
  });

  it("retains an ambiguous user prompt and records a typed migration blocker", () => {
    const marker = `[Thoth RuntimeBundle ${clarifyBundle.id} ${clarifyBundle.digest}]`;
    const config = provisionForegroundThothSession({
      config: {
        provider: "codex",
        cwd: "/workspace",
        systemPrompt: `User text before ${marker} and user text after`,
        extra: {
          thothRuntimeTools: { enabled: true, scope: "clarify" },
          thothRuntimeAttachment: {
            bundleId: clarifyBundle.id,
            bundleDigest: clarifyBundle.digest,
          },
        },
      },
      capabilities: defineHarnessCapabilities({ toolAttachment: ["native"] }),
      bundle: clarifyBundle,
    });

    expect(config.systemPrompt).toBe(`User text before ${marker} and user text after`);
    expect(config.extra).toEqual({
      thothRuntimeMigrationBlocker: expect.objectContaining({
        code: "THOTH_RUNTIME_PROMPT_PROVENANCE_UNVERIFIED",
      }),
    });
  });
});
