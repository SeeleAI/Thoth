import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

let cachedClientId: string | null = null;

export function resolveCliClientIdPath(
  env: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string {
  const configuredHome = env.THOTH_HOME?.trim();
  return join(configuredHome || join(userHome, ".thoth"), "cli-client-id");
}

function normalizeClientId(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function generateClientId(): string {
  return `cid_${randomUUID().replace(/-/g, "")}`;
}

export async function getOrCreateCliClientId(): Promise<string> {
  if (cachedClientId) {
    return cachedClientId;
  }

  const keyFile = resolveCliClientIdPath();
  try {
    const existing = normalizeClientId(await readFile(keyFile, "utf8"));
    if (existing) {
      cachedClientId = existing;
      return existing;
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  const nextValue = generateClientId();
  await mkdir(dirname(keyFile), { recursive: true });
  await writeFile(keyFile, nextValue, { mode: 0o600 });
  cachedClientId = nextValue;
  return nextValue;
}
