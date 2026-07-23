#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(repoRoot, process.argv[2] ?? "packages/app/dist/index.html");

if (!existsSync(indexPath)) {
  throw new Error(`Web export index.html does not exist: ${indexPath}`);
}

const before = readFileSync(indexPath, "utf8");
const after = before.replace(
  /<script(?![^>]*\btype=)([^>]*\bsrc=["']\/_expo\/static\/js\/web\/[^"']+\.js["'][^>]*)><\/script>/g,
  (script, attributes) =>
    /\/_expo\/static\/js\/web\/__expo-metro-runtime-[^/"']+\.js/u.test(attributes)
      ? script
      : `<script type="module"${attributes}></script>`,
);

if (after === before) {
  if (!/<script[^>]+\btype=["']module["'][^>]+\bsrc=["']\/_expo\/static\/js\/web\//.test(before)) {
    throw new Error(`No Expo web bundle script found to mark as module in ${indexPath}`);
  }
  console.log(`Web export already uses module scripts: ${indexPath}`);
} else {
  writeFileSync(indexPath, after);
  console.log(`Marked Expo web bundle scripts as modules: ${indexPath}`);
}
