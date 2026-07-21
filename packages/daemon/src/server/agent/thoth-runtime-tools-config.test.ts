import { describe, expect, it } from "vitest";

import {
  readThothRuntimeToolsConfig,
  withThothRuntimeTools,
} from "./thoth-runtime-tools-config.js";

describe("Thoth runtime tools config", () => {
  it("writes the provider-neutral runtime contract without changing provider-private config", () => {
    expect(
      withThothRuntimeTools(
        { extra: { opencode: { providerVisibleOption: true } } },
        { enabled: true, scope: "clarify" },
      ),
    ).toEqual({
      extra: {
        opencode: { providerVisibleOption: true },
        thothRuntimeTools: {
          enabled: true,
          scope: "clarify",
        },
      },
    });
  });

  it("rejects pre-migration provider-private runtime flags", () => {
    expect(
      readThothRuntimeToolsConfig({
        extra: { codex: { thothClarifyRuntimeTools: true } },
      }),
    ).toBeNull();
    expect(
      readThothRuntimeToolsConfig({
        extra: { codex: { thothLoopRuntimeTools: true } },
      }),
    ).toBeNull();
  });

  it("does not infer runtime tools from an unknown provider-private field", () => {
    expect(
      readThothRuntimeToolsConfig({ extra: { opencode: { thothClarifyRuntimeTools: true } } }),
    ).toBeNull();
  });

  it("does not revive legacy flags when a newer runtime contract explicitly disables tools", () => {
    expect(
      readThothRuntimeToolsConfig({
        extra: {
          thothRuntimeTools: { enabled: false },
          codex: { thothClarifyRuntimeTools: true },
        },
      }),
    ).toBeNull();
  });
});
