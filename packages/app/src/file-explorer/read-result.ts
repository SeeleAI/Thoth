import type { FileReadResult } from "@thoth/client/internal/daemon-client";
import type { ExplorerFile } from "@/query/file-explorer-model";

export function explorerFileFromReadResult(file: FileReadResult): ExplorerFile {
  const isText = file.kind === "text";
  return {
    path: file.path,
    kind: file.kind,
    encoding: isText ? "utf-8" : "none",
    content: isText ? new TextDecoder().decode(file.bytes) : undefined,
    mimeType: file.mime,
    size: file.size,
    modifiedAt: file.modifiedAt,
  };
}
