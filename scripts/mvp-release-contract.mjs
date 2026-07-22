#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MVP_VERSION = "0.0.0-mvp-beta";
export const MVP_TAG = `v${MVP_VERSION}`;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPaths = [
  "package.json",
  "packages/app/highlight/package.json",
  "packages/app/package.json",
  "packages/cli/package.json",
  "packages/client/package.json",
  "packages/core/package.json",
  "packages/daemon/package.json",
  "packages/desktop/package.json",
  "packages/drivers/package.json",
  "packages/protocol/package.json",
  "packages/relay/package.json",
  "packages/tui/package.json",
];
const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));
}

function verifyInternalDependencies({ dependencies, source, failures }) {
  if (!dependencies) return;
  for (const [dependencyName, dependencyVersion] of Object.entries(dependencies)) {
    if (dependencyName.startsWith("@thoth/") && dependencyVersion !== MVP_VERSION) {
      failures.push(`${source}.${dependencyName} must be ${MVP_VERSION}, got ${dependencyVersion}`);
    }
  }
}

export function runMvpReleaseContract({ writeMode = false } = {}) {
  const manifests = packageJsonPaths.map((relativePath) => ({
    relativePath,
    value: readJson(relativePath),
  }));
  const internalPackageNames = new Set(
    manifests.map(({ value }) => value.name).filter((name) => name?.startsWith("@thoth/")),
  );
  const failures = [];

  for (const manifest of manifests) {
    const { relativePath, value } = manifest;

    if (writeMode) {
      value.version = MVP_VERSION;
      if (value.name === "@thoth/cli") {
        value.engines = { node: ">=24.14.0" };
      }
      for (const section of dependencySections) {
        const dependencies = value[section];
        if (!dependencies) continue;
        for (const dependencyName of Object.keys(dependencies)) {
          if (internalPackageNames.has(dependencyName)) {
            dependencies[dependencyName] = MVP_VERSION;
          }
        }
      }
      writeFileSync(join(repoRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`);
      continue;
    }

    if (value.version !== MVP_VERSION) {
      failures.push(`${relativePath}: expected version ${MVP_VERSION}, got ${value.version}`);
    }
    if (value.private !== true) {
      failures.push(`${relativePath}: MVP packages must remain private`);
    }
    if (value.name === "@thoth/cli" && value.engines?.node !== ">=24.14.0") {
      failures.push(`${relativePath}: @thoth/cli must require Node >=24.14.0`);
    }
    for (const section of dependencySections) {
      verifyInternalDependencies({
        dependencies: value[section],
        source: `${relativePath}:${section}`,
        failures,
      });
    }
  }

  if (writeMode) {
    console.log(`Pinned ${packageJsonPaths.length} package manifests to ${MVP_VERSION}.`);
    return;
  }

  const lock = readJson("package-lock.json");
  for (const { relativePath } of manifests) {
    const packagePath = relativePath === "package.json" ? "" : dirname(relativePath);
    const lockEntry = lock.packages?.[packagePath];
    if (!lockEntry) {
      failures.push(`package-lock.json is missing ${packagePath || "the root package"}`);
      continue;
    }
    if (lockEntry.version !== MVP_VERSION) {
      failures.push(
        `package-lock.json:${packagePath || "root"} expected version ${MVP_VERSION}, got ${lockEntry.version}`,
      );
    }
    for (const section of dependencySections) {
      verifyInternalDependencies({
        dependencies: lockEntry[section],
        source: `package-lock.json:${packagePath || "root"}:${section}`,
        failures,
      });
    }
  }

  const lockText = readFileSync(join(repoRoot, "package-lock.json"), "utf8");
  if (/"@thoth\/[^"]+"\s*:\s*"file:/u.test(lockText)) {
    failures.push("package-lock.json contains an internal file: dependency");
  }

  const workflowText = readFileSync(
    join(repoRoot, ".github/workflows/mvp-beta-release.yml"),
    "utf8",
  );
  if (!workflowText.includes(`THOTH_MVP_VERSION: ${MVP_VERSION}`)) {
    failures.push("MVP workflow version does not match the package version");
  }
  if (!workflowText.includes(`THOTH_MVP_TAG: ${MVP_TAG}`)) {
    failures.push("MVP workflow tag does not match the package version");
  }
  if (!workflowText.includes("build-mvp-update-manifest.mjs")) {
    failures.push("MVP workflow must generate the fixed-tag build update manifest");
  }
  if (!workflowText.includes('test -f "release-files/MVP-UPDATE.json"')) {
    failures.push("MVP workflow must verify MVP-UPDATE.json before publishing");
  }
  if (/^  android-apk:/mu.test(workflowText)) {
    failures.push("MVP workflow must not build or publish Android artifacts");
  }
  if (
    workflowText.includes("downloaded/android") ||
    workflowText.includes("release-files/Thoth-$THOTH_MVP_VERSION-android.apk") ||
    workflowText.includes("release-files/thoth-server-cli-$THOTH_MVP_VERSION.tgz")
  ) {
    failures.push("Public MVP payload must contain desktop artifacts only");
  }
  const updateManifestBuilder = readFileSync(
    join(repoRoot, "scripts/build-mvp-update-manifest.mjs"),
    "utf8",
  );
  if (updateManifestBuilder.includes('"android"') || updateManifestBuilder.includes('"apk"')) {
    failures.push("MVP update manifest must not advertise Android assets");
  }
  const appConfig = readFileSync(join(repoRoot, "packages/app/app.config.js"), "utf8");
  if (appConfig.includes("android.permission.REQUEST_INSTALL_PACKAGES")) {
    failures.push("Android source must not request package installation permission");
  }
  const desktopManifest = readJson("packages/desktop/package.json");
  if (desktopManifest.dependencies?.["electron-updater"]) {
    failures.push("Desktop MVP must not depend on the legacy electron-updater path");
  }

  const hermeticBuildScripts = new Map([
    ["packages/app/highlight/package.json", "build"],
    ["packages/app/package.json", "build:web"],
    ["packages/cli/package.json", "build"],
    ["packages/client/package.json", "build"],
    ["packages/daemon/package.json", "build"],
    ["packages/desktop/package.json", "build:main"],
    ["packages/drivers/package.json", "build"],
    ["packages/protocol/package.json", "build"],
    ["packages/relay/package.json", "build"],
    ["packages/tui/package.json", "build"],
  ]);
  for (const [manifestPath, scriptName] of hermeticBuildScripts) {
    const manifest = manifests.find(({ relativePath }) => relativePath === manifestPath)?.value;
    const script = manifest?.scripts?.[scriptName] ?? "";
    if (!script.startsWith("npm run clean && ")) {
      failures.push(`${manifestPath}:${scriptName} must clean stale outputs before compilation`);
    }
  }

  const rootScripts = manifests.find(({ relativePath }) => relativePath === "package.json")?.value
    .scripts;
  for (const scriptName of ["build:client", "build:app-deps", "build:foundation"]) {
    const script = rootScripts?.[scriptName];
    const protocolIndex = script?.indexOf("build:protocol") ?? -1;
    const relayIndex = script?.indexOf("build:relay") ?? -1;
    if (protocolIndex < 0 || relayIndex < 0 || protocolIndex > relayIndex) {
      failures.push(`${scriptName} must build @thoth/protocol before @thoth/relay`);
    }
  }
  const daemonBuild = rootScripts?.["build:daemon"] ?? "";
  const daemonBuildSequence = [
    "build:highlight",
    "build:protocol",
    "build:relay",
    "--workspace=@thoth/client",
    "--workspace=@thoth/drivers",
    "--workspace=@thoth/tui",
    "--workspace=@thoth/daemon",
  ];
  let previousDaemonBuildIndex = -1;
  for (const requiredStep of daemonBuildSequence) {
    const currentIndex = daemonBuild.indexOf(requiredStep);
    if (currentIndex <= previousDaemonBuildIndex) {
      failures.push(`build:daemon must build runtime dependencies in order before ${requiredStep}`);
      break;
    }
    previousDaemonBuildIndex = currentIndex;
  }
  if (rootScripts?.["setup:electron"] !== "node node_modules/electron/install.js") {
    failures.push("setup:electron must explicitly install the platform Electron binary");
  }
  const electronSetupSteps = workflowText.match(/- run: npm run setup:electron/gu) ?? [];
  if (electronSetupSteps.length !== 4) {
    failures.push(
      `MVP workflow must initialize Electron in preflight and three desktop jobs, got ${electronSetupSteps.length}`,
    );
  }
  if (workflowText.includes("$home =") || !workflowText.includes("$thothHome =")) {
    failures.push(
      "Windows server CLI smoke must not overwrite PowerShell's read-only HOME variable",
    );
  }
  if (
    workflowText.includes("-c.publish.") ||
    (workflowText.match(/--config\.publish\.releaseType=prerelease/gu) ?? []).length !== 3 ||
    (workflowText.match(/--config\.publish\.channel=beta/gu) ?? []).length !== 3
  ) {
    failures.push("Desktop release jobs must use cross-platform long publish config arguments");
  }

  const terminalWebViewBuild = readFileSync(
    join(repoRoot, "packages/app/scripts/build-terminal-webview-html.mjs"),
    "utf8",
  );
  if (!/execFileAsync\(\s*process\.execPath/.test(terminalWebViewBuild)) {
    failures.push("Terminal WebView build must launch oxfmt through Node on every host platform");
  }
  if (terminalWebViewBuild.includes("packages/server/src")) {
    failures.push("Terminal WebView aliases must not refer to the removed packages/server path");
  }

  const androidReleaseBuild = readFileSync(
    join(repoRoot, "scripts/package-android-release-apk.mjs"),
    "utf8",
  );
  const androidHighlightIndex = androidReleaseBuild.indexOf('["run", "build:highlight"]');
  const androidClientIndex = androidReleaseBuild.indexOf('["run", "build:client"]');
  if (androidHighlightIndex < 0 || androidClientIndex <= androidHighlightIndex) {
    failures.push("Android release packaging must build highlight before the client graph");
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  console.log(`MVP release contract verified: ${MVP_TAG}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    runMvpReleaseContract({ writeMode: process.argv.includes("--write") });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
