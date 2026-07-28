/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyboardActionHandler } from "@/keyboard/keyboard-action-dispatcher";
import { useKeyboardActionHandler } from "./use-keyboard-action-handler";

const { registerHandler } = vi.hoisted(() => ({
  registerHandler: vi.fn((_handler: KeyboardActionHandler) => vi.fn()),
}));

vi.mock("@/keyboard/keyboard-action-dispatcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/keyboard/keyboard-action-dispatcher")>();
  return {
    ...actual,
    keyboardActionDispatcher: { registerHandler },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useKeyboardActionHandler", () => {
  it("keeps registration order stable while dispatching the latest callback", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ handle, enabled }) =>
        useKeyboardActionHandler({
          handlerId: "agent-mode",
          actions: ["message-input.mode-cycle"],
          enabled,
          priority: 0,
          handle,
        }),
      { initialProps: { handle: first, enabled: true } },
    );

    expect(registerHandler).toHaveBeenCalledTimes(1);
    const registration = registerHandler.mock.calls[0]?.[0] as KeyboardActionHandler;
    rerender({ handle: second, enabled: true });

    expect(registerHandler).toHaveBeenCalledTimes(1);
    expect(registration.handle({ id: "message-input.mode-cycle", scope: "message-input" })).toBe(
      true,
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("reads enabled and isActive at dispatch time", () => {
    const handle = vi.fn(() => true);
    const active = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ enabled, isActive }) =>
        useKeyboardActionHandler({
          handlerId: "active-surface",
          actions: ["message-input.mode-cycle"],
          enabled,
          priority: 0,
          isActive,
          handle,
        }),
      { initialProps: { enabled: true, isActive: active } },
    );
    const registration = registerHandler.mock.calls[0]?.[0] as KeyboardActionHandler;
    expect(registration.isActive?.()).toBe(true);

    rerender({ enabled: false, isActive: active });
    expect(registration.isActive?.()).toBe(false);
  });
});
