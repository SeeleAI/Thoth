import { useEffect, useState } from "react";
import type { FileReadResult } from "@thoth/client/internal/daemon-client";
import { isWeb } from "@/constants/platform";

const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodePreviewBytesBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const combined = (a << 16) | (b << 8) | c;
    output += BASE64_ALPHABET[(combined >>> 18) & 63];
    output += BASE64_ALPHABET[(combined >>> 12) & 63];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(combined >>> 6) & 63] : "=";
    output += index + 2 < bytes.length ? BASE64_ALPHABET[combined & 63] : "=";
  }
  return output;
}

export function createTransientImagePreviewSource(file: FileReadResult): {
  uri: string;
  release: () => void;
} {
  if (file.kind !== "image" || !SUPPORTED_IMAGE_MIME_TYPES.has(file.mime.toLowerCase())) {
    throw new Error(`Unsupported image preview type: ${file.mime}`);
  }
  if (isWeb) {
    const blob = new Blob([file.bytes.slice().buffer], { type: file.mime });
    const uri = URL.createObjectURL(blob);
    return { uri, release: () => URL.revokeObjectURL(uri) };
  }
  return {
    uri: `data:${file.mime};base64,${encodePreviewBytesBase64(file.bytes)}`,
    release: () => undefined,
  };
}

export function useFilePreviewSource(file: FileReadResult | null | undefined): {
  uri: string | null;
  error: string | null;
} {
  const [state, setState] = useState<{ uri: string | null; error: string | null }>({
    uri: null,
    error: null,
  });

  useEffect(() => {
    if (!file || file.kind !== "image") {
      setState({ uri: null, error: null });
      return;
    }
    try {
      const source = createTransientImagePreviewSource(file);
      setState({ uri: source.uri, error: null });
      return source.release;
    } catch (error) {
      setState({ uri: null, error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }, [file]);

  return state;
}
