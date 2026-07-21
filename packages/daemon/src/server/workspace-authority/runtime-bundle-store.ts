import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RuntimeBundle } from "@thoth/drivers/harness";

export class RuntimeBundleStore {
  private readonly root: string;

  constructor(thothHome: string) {
    this.root = path.join(thothHome, "runtime-bundles", "sha256");
    mkdirSync(this.root, { recursive: true });
  }

  persist(bundle: RuntimeBundle): string {
    const digest = bundle.digest.replace(/^sha256:/u, "");
    if (!/^[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`Invalid RuntimeBundle digest: ${bundle.digest}`);
    }
    const directory = path.join(this.root, digest);
    const target = path.join(directory, "bundle.json");
    mkdirSync(directory, { recursive: true });
    const serialized = `${JSON.stringify(bundle)}\n`;
    try {
      const existing = readFileSync(target, "utf8");
      if (existing !== serialized) {
        throw new Error(`RuntimeBundle digest collision for ${bundle.digest}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      writeFileSync(target, serialized, { mode: 0o600, flag: "wx" });
    }
    return target;
  }
}
