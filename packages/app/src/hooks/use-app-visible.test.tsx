// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/utils/app-visibility");
  vi.resetModules();
});

describe("useAppVisible", () => {
  it("resamples visibility when a pane mounts after the focus event", async () => {
    let visible = false;
    vi.doMock("@/utils/app-visibility", () => ({
      getIsAppActivelyVisible: () => visible,
    }));
    const { useAppVisible } = await import("./use-app-visible");

    visible = true;
    const { result } = renderHook(() => useAppVisible());

    await waitFor(() => expect(result.current).toBe(true));
  });
});
