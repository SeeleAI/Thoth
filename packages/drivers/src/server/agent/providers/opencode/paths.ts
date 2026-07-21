import os from "node:os";
import path from "node:path";

const OPENCODE_RUNTIME_DIRNAME = "thoth-opencode-runtime";

export function resolveOpenCodeRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  const owner = typeof process.getuid === "function" ? String(process.getuid()) : "user";
  return path.resolve(
    env.THOTH_PROVIDER_RUNTIME_DIR ??
      path.join(os.tmpdir(), `${OPENCODE_RUNTIME_DIRNAME}-${owner}`),
  );
}
