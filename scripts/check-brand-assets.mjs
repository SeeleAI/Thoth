import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const assets = [
  "packages/desktop/assets/icon.png",
  "packages/app/assets/images/icon.png",
  "packages/app/assets/images/android-icon-foreground.png",
  "packages/app/assets/images/splash-icon.png",
  "packages/app/assets/images/thoth-brand-mark.png",
];
for (const path of assets) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cornerAlpha = [
    data[3],
    data[(info.width - 1) * 4 + 3],
    data[(info.height - 1) * info.width * 4 + 3],
    data[(info.width * info.height - 1) * 4 + 3],
  ];
  if (cornerAlpha.some((alpha) => alpha !== 0)) {
    throw new Error(`${path} must have fully transparent corners; got ${cornerAlpha.join(",")}`);
  }
}
const logoSource = await readFile("packages/app/src/components/icons/thoth-logo.tsx", "utf8");
if (logoSource.includes("arcade-inventory/brand/brand-mark.png")) {
  throw new Error("ThothLogo still references the archived Paseo brand mark.");
}

const legacyBrandAssets = [
  "packages/app/assets/icons/arcade-inventory/brand/app-icon-source.png",
  "packages/app/assets/icons/arcade-inventory/brand/avatar-light.png",
  "packages/app/assets/icons/arcade-inventory/brand/brand-mark.png",
  "packages/app/assets/icons/arcade-inventory/brand/thoth-seal.png",
];
for (const path of legacyBrandAssets) {
  try {
    await access(path);
  } catch {
    continue;
  }
  throw new Error(`Legacy Paseo brand asset must not exist: ${path}`);
}

const legacyBrandHashes = new Set([
  "3de5f7392dbfaa52980a88fe54087d5b1925c269e3fb392a187dd564ca880d95",
  "cb397c71a50bad2e1fd23f02c32195f9532f6abe31d34c140ecb84b5f69ba295",
  "1bf31b2337bcff7bcf7369337bf6b582d2e8c5fe5b37819477e77bbe1ba89ca1",
  "069c35d903afc1054c46b6391f50477a62fd613c3283c87cea90c3a4fded3c16",
]);

async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

for (const path of await listFiles("packages/app/assets")) {
  const hash = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (legacyBrandHashes.has(hash)) {
    throw new Error(`Renamed or relocated Paseo brand asset must not exist: ${path}`);
  }
}

const startupSource = await readFile("packages/app/src/screens/startup-splash-screen.tsx", "utf8");
if (!startupSource.includes("<ThothLogo")) {
  throw new Error("Startup splash must render the shared ThothLogo asset.");
}
if (
  startupSource.includes("WebkitMaskImage") ||
  startupSource.includes("data:image/svg+xml") ||
  startupSource.includes("M291.495 91.399")
) {
  throw new Error("Startup splash contains a legacy embedded brand silhouette.");
}
console.log("Thoth brand assets verified.");
