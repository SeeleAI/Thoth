// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileReadResult } from "@thoth/client/internal/daemon-client";
import {
  createTransientImagePreviewSource,
  encodePreviewBytesBase64,
  useFilePreviewSource,
} from "./use-file-preview-source";

function imageFile(mime: string, path = "/workspace/image.png"): FileReadResult {
  return {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mime,
    size: 4,
    path,
    kind: "image",
    modifiedAt: "2026-07-22T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("transient file preview source", () => {
  it.each(["image/png", "image/jpeg", "image/gif", "image/webp"])(
    "creates and releases a transient URL for %s",
    (mime) => {
      const createObjectURL = vi.fn(() => `blob:${mime}`);
      const revokeObjectURL = vi.fn();
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

      const source = createTransientImagePreviewSource(imageFile(mime));

      expect(source.uri).toBe(`blob:${mime}`);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      source.release();
      expect(revokeObjectURL).toHaveBeenCalledWith(`blob:${mime}`);
    },
  );

  it("rejects unsupported binary types instead of showing an empty image state", () => {
    expect(() => createTransientImagePreviewSource(imageFile("image/tiff"))).toThrow(
      "Unsupported image preview type: image/tiff",
    );
  });

  it("releases the previous URL when the selected file changes and on unmount", () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    const { result, rerender, unmount } = renderHook(
      ({ file }: { file: FileReadResult | null }) => useFilePreviewSource(file),
      { initialProps: { file: imageFile("image/png", "/workspace/first.png") } },
    );
    expect(result.current.uri).toBe("blob:first");

    rerender({ file: imageFile("image/png", "/workspace/second.png") });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    expect(result.current.uri).toBe("blob:second");

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second");
  });

  it("encodes native data URI bytes without relying on a durable attachment store", () => {
    expect(encodePreviewBytesBase64(new Uint8Array([0x4d, 0x61, 0x6e]))).toBe("TWFu");
    expect(encodePreviewBytesBase64(new Uint8Array([0x4d, 0x61]))).toBe("TWE=");
  });
});
