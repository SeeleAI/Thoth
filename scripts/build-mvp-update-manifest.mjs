import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [releaseDir, commit, workflowRunId] = process.argv.slice(2);
if (!releaseDir || !/^[a-f0-9]{40}$/u.test(commit ?? "") || !workflowRunId) {
  throw new Error("Usage: build-mvp-update-manifest.mjs <release-dir> <commit> <workflow-run-id>");
}

const baseUrl = "https://github.com/SeeleAI/Thoth/releases/download/v0.0.0-mvp-beta";
const files = await readdir(releaseDir);
const definitions = [
  [/^Thoth-0\.0\.0-mvp-beta-arm64\.dmg$/u, "darwin", "arm64", "open_dmg"],
  [/^Thoth-0\.0\.0-mvp-beta-x64\.dmg$/u, "darwin", "x64", "open_dmg"],
  [/^Thoth-Setup-0\.0\.0-mvp-beta-arm64\.exe$/u, "win32", "arm64", "nsis"],
  [/^Thoth-Setup-0\.0\.0-mvp-beta-x64\.exe$/u, "win32", "x64", "nsis"],
  [/^Thoth-x86_64\.AppImage$/u, "linux", "x64", "appimage_replace"],
  [/^Thoth-0\.0\.0-mvp-beta-amd64\.deb$/u, "linux", "x64", "system_package"],
];
const assets = [];
for (const [pattern, platform, arch, installStrategy] of definitions) {
  const name = files.find((file) => pattern.test(file));
  if (!name) throw new Error(`Missing MVP update asset matching ${pattern}`);
  const path = join(releaseDir, name);
  const bytes = await readFile(path);
  assets.push({
    platform,
    arch,
    installStrategy,
    name,
    url: `${baseUrl}/${encodeURIComponent(name)}`,
    size: (await stat(path)).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  join(releaseDir, "MVP-UPDATE.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      tag: "v0.0.0-mvp-beta",
      version: "0.0.0-mvp-beta",
      commit,
      workflowRunId,
      publishedAt: new Date().toISOString(),
      assets,
    },
    null,
    2,
  )}\n`,
);
