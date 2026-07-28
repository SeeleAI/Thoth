import { appendFile, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readExplorerFile, streamExplorerFile } from "./service.js";

async function createHomeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.homedir(), prefix));
}

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("file explorer service", () => {
  it("reads .ex files as text", async () => {
    const root = await createTempDir("thoth-file-explorer-");

    try {
      const filePath = path.join(root, "sample.ex");
      const content = "defmodule Sample do\nend\n";
      await writeFile(filePath, content, "utf-8");

      const result = await readExplorerFile({
        root,
        relativePath: "sample.ex",
      });

      expect(result.kind).toBe("text");
      expect(result.encoding).toBe("utf-8");
      expect(result.mimeType).toBe("text/plain");
      expect(result.content).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads unknown extension text files as text", async () => {
    const root = await createTempDir("thoth-file-explorer-");

    try {
      const filePath = path.join(root, "notes.customext");
      const content = "hello from a custom text file\n";
      await writeFile(filePath, content, "utf-8");

      const result = await readExplorerFile({
        root,
        relativePath: "notes.customext",
      });

      expect(result.kind).toBe("text");
      expect(result.encoding).toBe("utf-8");
      expect(result.mimeType).toBe("text/plain");
      expect(result.content).toBe(content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies files with null bytes as binary", async () => {
    const root = await createTempDir("thoth-file-explorer-");

    try {
      const filePath = path.join(root, "blob.weird");
      await writeFile(filePath, Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]));

      const result = await readExplorerFile({
        root,
        relativePath: "blob.weird",
      });

      expect(result.kind).toBe("binary");
      expect(result.encoding).toBe("none");
      expect(result.content).toBeUndefined();
      expect(result.mimeType).toBe("application/octet-stream");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file grows after its revision is advertised", async () => {
    const root = await createTempDir("thoth-file-stream-growth-");
    try {
      const filePath = path.join(root, "growing.log");
      await writeFile(filePath, Buffer.alloc(300 * 1024, 0x61));
      await expect(
        streamExplorerFile({ root, relativePath: "growing.log" }, async (file) => {
          await appendFile(filePath, Buffer.alloc(300 * 1024, 0x62));
          for await (const _chunk of file.chunks) {
            // Consume the advertised prefix before revision validation.
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file shrinks below its advertised size", async () => {
    const root = await createTempDir("thoth-file-stream-truncate-");
    try {
      const filePath = path.join(root, "shrinking.log");
      await writeFile(filePath, Buffer.alloc(300 * 1024, 0x61));
      await expect(
        streamExplorerFile({ root, relativePath: "shrinking.log" }, async (file) => {
          await truncate(filePath, 100 * 1024);
          for await (const _chunk of file.chunks) {
            // Consume until premature EOF is detected.
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a stream when the file is overwritten in place", async () => {
    const root = await createTempDir("thoth-file-stream-overwrite-");
    try {
      const filePath = path.join(root, "changing.log");
      const initial = Buffer.alloc(600 * 1024, 0x61);
      await writeFile(filePath, initial);
      await expect(
        streamExplorerFile({ root, relativePath: "changing.log" }, async (file) => {
          let chunkIndex = 0;
          for await (const _chunk of file.chunks) {
            chunkIndex += 1;
            if (chunkIndex === 1) {
              await writeFile(filePath, Buffer.alloc(initial.byteLength, 0x62));
            }
          }
        }),
      ).rejects.toThrow("File changed during transfer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies text when one UTF-8 code point crosses a classification block", async () => {
    const root = await createTempDir("thoth-file-stream-utf8-");
    try {
      const content = Buffer.concat([Buffer.alloc(8191, 0x61), Buffer.from("€"), Buffer.from("z")]);
      await writeFile(path.join(root, "sample.txt"), content);
      let kind: string | undefined;
      let encoding: string | undefined;
      await streamExplorerFile({ root, relativePath: "sample.txt" }, async (file) => {
        kind = file.kind;
        encoding = file.encoding;
      });
      expect(kind).toBe("text");
      expect(encoding).toBe("utf-8");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies incomplete terminal UTF-8 as binary", async () => {
    const root = await createTempDir("thoth-file-stream-invalid-utf8-");
    try {
      await writeFile(path.join(root, "invalid.txt"), Buffer.from([0x61, 0xe2, 0x82]));
      let kind: string | undefined;
      await streamExplorerFile({ root, relativePath: "invalid.txt" }, async (file) => {
        kind = file.kind;
      });
      expect(kind).toBe("binary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects binary data after the first classification block", async () => {
    const root = await createTempDir("thoth-file-stream-late-binary-");
    try {
      const content = Buffer.concat([Buffer.alloc(8192, 0x61), Buffer.from([0xff])]);
      await writeFile(path.join(root, "late-binary.unknown"), content);
      let kind: string | undefined;
      await streamExplorerFile({ root, relativePath: "late-binary.unknown" }, async (file) => {
        kind = file.kind;
      });
      expect(kind).toBe("binary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("expands a ~ prefix in relative paths against the user home directory", async () => {
    const root = await createHomeTempDir(".thoth-file-explorer-home-");

    try {
      const filePath = path.join(root, "sample.txt");
      await writeFile(filePath, "hello from home\n", "utf-8");

      const tildePath = `~/${path.relative(os.homedir(), filePath)}`;
      const result = await readExplorerFile({
        root,
        relativePath: tildePath,
      });

      expect(result.kind).toBe("text");
      expect(result.content).toBe("hello from home\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows home to be the scoped root for tilde file previews", async () => {
    const root = await createHomeTempDir(".thoth-file-explorer-home-root-");

    try {
      const filePath = path.join(root, "sample.txt");
      await writeFile(filePath, "hello from home root\n", "utf-8");

      const tildePath = `~/${path.relative(os.homedir(), filePath)}`;
      const result = await readExplorerFile({
        root: "~",
        relativePath: tildePath,
      });

      expect(result.kind).toBe("text");
      expect(result.path).toBe(path.relative(os.homedir(), filePath).split(path.sep).join("/"));
      expect(result.content).toBe("hello from home root\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects ~-prefixed paths that resolve outside the workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "thoth-file-explorer-outside-home-"));

    try {
      await expect(
        readExplorerFile({
          root,
          relativePath: "~/some/file.txt",
        }),
      ).rejects.toThrow("Access outside of workspace is not allowed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
