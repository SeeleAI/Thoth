import { describe, expect, test } from "vitest";
import {
  DeleteProviderRequestMessageSchema,
  DeleteProviderResponseMessageSchema,
  GetProvidersSnapshotResponseMessageSchema,
  ProviderSnapshotEntrySchema,
  ProvidersSnapshotUpdateMessageSchema,
} from "./messages.js";

describe("provider snapshot message schemas", () => {
  test("defaults missing provider snapshot entry enabled state to true", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "codex",
      status: "ready",
      label: "Codex",
    });

    expect(parsed.enabled).toBe(true);
  });

  test("preserves disabled provider snapshot entries", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "claude",
      status: "unavailable",
      enabled: false,
      label: "Claude",
    });

    expect(parsed.enabled).toBe(false);
  });

  test("preserves enabled provider snapshot entries", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "opencode",
      status: "loading",
      enabled: true,
      label: "OpenCode",
    });

    expect(parsed.enabled).toBe(true);
  });

  test("preserves custom Provider lifecycle metadata and defaults old entries to non-deletable", () => {
    expect(
      ProviderSnapshotEntrySchema.parse({
        provider: "custom-claude",
        status: "ready",
        source: "custom",
        deletable: true,
      }),
    ).toMatchObject({ source: "custom", deletable: true });
    expect(
      ProviderSnapshotEntrySchema.parse({ provider: "claude", status: "ready" }).deletable,
    ).toBe(false);
  });

  test("requires an explicit confirmed deletion request and preserves the deletion receipt", () => {
    expect(() =>
      DeleteProviderRequestMessageSchema.parse({
        type: "provider.delete.request",
        provider: "custom-claude",
        confirmed: false,
        requestId: "delete-provider",
      }),
    ).toThrow();

    expect(
      DeleteProviderRequestMessageSchema.parse({
        type: "provider.delete.request",
        provider: "custom-claude",
        confirmed: true,
        requestId: "delete-provider",
      }),
    ).toMatchObject({ provider: "custom-claude", confirmed: true });

    expect(
      DeleteProviderResponseMessageSchema.parse({
        type: "provider.delete.response",
        payload: {
          provider: "custom-claude",
          deleted: true,
          requestId: "delete-provider",
        },
      }).payload,
    ).toEqual({
      provider: "custom-claude",
      deleted: true,
      requestId: "delete-provider",
    });
  });

  test("normalizes thinking option defaults on provider snapshot models", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "claude",
      status: "ready",
      models: [
        {
          provider: "claude",
          id: "MiniMax-M2.7",
          label: "MiniMax-M2.7",
          isDefault: true,
          thinkingOptions: [
            { id: "off", label: "Off" },
            { id: "max", label: "Max", isDefault: true },
          ],
        },
      ],
    });

    expect(parsed.models).toEqual([
      {
        provider: "claude",
        id: "MiniMax-M2.7",
        label: "MiniMax-M2.7",
        isDefault: true,
        thinkingOptions: [
          { id: "off", label: "Off" },
          { id: "max", label: "Max", isDefault: true },
        ],
        defaultThinkingOptionId: "max",
      },
    ]);
  });

  test("defaults missing enabled state in providers snapshot response entries", () => {
    const parsed = GetProvidersSnapshotResponseMessageSchema.parse({
      type: "get_providers_snapshot_response",
      payload: {
        entries: [
          {
            provider: "codex",
            status: "ready",
            label: "Codex",
          },
          {
            provider: "claude",
            status: "unavailable",
            enabled: false,
            label: "Claude",
          },
        ],
        generatedAt: "2026-04-24T00:00:00.000Z",
        requestId: "req-providers",
      },
    });

    expect(parsed.payload.entries.map((entry) => entry.enabled)).toEqual([true, false]);
  });

  test("defaults missing enabled state in providers snapshot update entries", () => {
    const parsed = ProvidersSnapshotUpdateMessageSchema.parse({
      type: "providers_snapshot_update",
      payload: {
        cwd: "/tmp/repo",
        entries: [
          {
            provider: "codex",
            status: "ready",
            label: "Codex",
          },
        ],
        generatedAt: "2026-04-24T00:00:00.000Z",
      },
    });

    expect(parsed.payload.entries[0]?.enabled).toBe(true);
  });
});
