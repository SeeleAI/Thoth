import { beforeEach, describe, expect, it } from "vitest";
import { useProviderSettingsStore } from "./provider-settings-store";

beforeEach(() => {
  useProviderSettingsStore.setState({
    serverId: null,
    provider: null,
    visible: false,
    overlayParentLayer: 0,
  });
});

describe("provider settings store", () => {
  it("retains the opener overlay layer for the globally hosted settings modal", () => {
    useProviderSettingsStore.getState().open({
      serverId: "server-1",
      provider: "claude-code",
      overlayParentLayer: 30,
    });
    expect(useProviderSettingsStore.getState()).toMatchObject({
      serverId: "server-1",
      provider: "claude-code",
      visible: true,
      overlayParentLayer: 30,
    });
  });

  it("defaults direct settings openers to the base overlay layer", () => {
    useProviderSettingsStore.getState().open({ serverId: "server-1", provider: "codex" });
    expect(useProviderSettingsStore.getState().overlayParentLayer).toBe(0);
  });
});
