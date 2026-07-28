/**
 * @vitest-environment jsdom
 */
import React, { useCallback } from "react";
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebOverlayRegistration } from "./overlay-root";

function RegisteredOverlay({
  active,
  layer,
  name,
  onEscape,
}: {
  active: boolean;
  layer: number;
  name: string;
  onEscape: () => void;
}) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Escape") return false;
      onEscape();
      return true;
    },
    [onEscape],
  );
  const setScope = useWebOverlayRegistration({ active, layer, onKeyDown: handleKeyDown });
  return (
    <div ref={setScope} data-testid={`scope-${name}`} tabIndex={-1}>
      <button type="button">{name}</button>
    </div>
  );
}

describe("web overlay registry", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("routes Escape and focus to the highest painted nested overlay", async () => {
    const firstEscape = vi.fn();
    const secondEscape = vi.fn();
    await act(async () => {
      root.render(
        <>
          <RegisteredOverlay active layer={10} name="first" onEscape={firstEscape} />
          <RegisteredOverlay active layer={40} name="second" onEscape={secondEscape} />
        </>,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(firstEscape).not.toHaveBeenCalled();
    expect(secondEscape).toHaveBeenCalledTimes(1);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    await act(async () => Promise.resolve());
    expect(
      container.querySelector('[data-testid="scope-second"]')?.contains(document.activeElement),
    ).toBe(true);
    outside.remove();
  });

  it("restores focus to the opener when the overlay closes", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    await act(async () => {
      root.render(<RegisteredOverlay active layer={20} name="modal" onEscape={vi.fn()} />);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    act(() => {
      root.render(<RegisteredOverlay active={false} layer={20} name="modal" onEscape={vi.fn()} />);
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
