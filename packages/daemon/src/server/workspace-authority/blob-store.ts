import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface StoredBlob {
  digest: string;
  byteSize: number;
  path: string;
}

export class ContentAddressedBlobStore {
  private readonly root: string;

  constructor(workspaceRoot: string) {
    this.root = path.join(workspaceRoot, "blobs", "sha256");
    mkdirSync(this.root, { recursive: true });
  }

  put(value: Buffer | string): StoredBlob {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const target = this.resolve(digest);
    if (!existsSync(target)) {
      mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(temporary, bytes, { mode: 0o600 });
      try {
        renameSync(temporary, target);
      } catch (error) {
        rmSync(temporary, { force: true });
        if (!existsSync(target)) {
          throw error;
        }
      }
    }
    return { digest, byteSize: bytes.byteLength, path: target };
  }

  putJson(value: unknown): StoredBlob {
    return this.put(JSON.stringify(value));
  }

  read(digest: string): Buffer {
    return readFileSync(this.resolve(digest));
  }

  readJson(digest: string): unknown {
    return JSON.parse(this.read(digest).toString("utf8")) as unknown;
  }

  has(digest: string): boolean {
    return existsSync(this.resolve(digest));
  }

  private resolve(digest: string): string {
    if (!/^[a-f0-9]{64}$/u.test(digest)) {
      throw new Error("Invalid SHA-256 blob digest");
    }
    return path.join(this.root, digest.slice(0, 2), digest);
  }
}
