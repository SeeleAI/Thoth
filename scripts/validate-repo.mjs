#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";

import { MVP_VERSION } from "./mvp-release-contract.mjs";

const root = process.cwd();
const expectedPackages = [
  "app",
  "cli",
  "client",
  "core",
  "daemon",
  "desktop",
  "drivers",
  "protocol",
  "relay",
  "tui",
];

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`OK ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function gitPaths(args) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args, "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

function fileExists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function checkPackageBoundary() {
  const actual = readdirSync(join(root, "packages"))
    .filter((name) => statSync(join(root, "packages", name)).isDirectory())
    .sort();
  const expected = [...expectedPackages].sort();
  if (actual.join("\n") !== expected.join("\n")) {
    fail(`packages directory mismatch: ${actual.join(", ")}`);
    return;
  }
  if (fileExists(join(root, "packages", "highlight"))) {
    fail("packages/highlight must not exist; highlight stays nested under packages/app/highlight");
    return;
  }
  ok("package boundary is exactly the approved 10 packages");
}

function checkPackageMetadata() {
  const rootPackage = readJson(join(root, "package.json"));
  if (JSON.stringify(rootPackage.workspaces) !== JSON.stringify(["packages/*"])) {
    fail('root workspaces must stay ["packages/*"]');
  }
  if (rootPackage.packageManager !== "npm@11.9.0") {
    fail("root packageManager must be npm@11.9.0");
  }

  for (const name of expectedPackages) {
    const packageJsonPath = join(root, "packages", name, "package.json");
    const packageJson = readJson(packageJsonPath);
    const expectedName = `@thoth/${name}`;
    if (packageJson.name !== expectedName) fail(`${packageJsonPath} name must be ${expectedName}`);
    if (packageJson.private !== true) fail(`${packageJsonPath} must remain private`);
    if (packageJson.license !== "AGPL-3.0-or-later") {
      fail(`${packageJsonPath} license must be AGPL-3.0-or-later`);
    }
    if (packageJson.version !== MVP_VERSION) {
      fail(`${packageJsonPath} version must be ${MVP_VERSION}`);
    }
    if (packageJson.type !== "module") fail(`${packageJsonPath} type must be module`);
  }

  const highlightPackage = readJson(join(root, "packages", "app", "highlight", "package.json"));
  if (highlightPackage.name !== "@thoth/highlight") {
    fail("nested highlight package must be named @thoth/highlight");
  }
  ok("package metadata is normalized");
}

function checkAgentDocs() {
  const rootClaude = lstatSync(join(root, "CLAUDE.md"));
  if (!rootClaude.isSymbolicLink() || readlinkSync(join(root, "CLAUDE.md")) !== "AGENTS.md") {
    fail("root CLAUDE.md must be a symlink to AGENTS.md");
  }

  for (const name of expectedPackages) {
    const packageRoot = join(root, "packages", name);
    if (!fileExists(join(packageRoot, "AGENTS.md"))) fail(`packages/${name}/AGENTS.md missing`);
    const claudePath = join(packageRoot, "CLAUDE.md");
    if (!fileExists(claudePath)) {
      fail(`packages/${name}/CLAUDE.md missing`);
      continue;
    }
    const stat = lstatSync(claudePath);
    if (!stat.isSymbolicLink() || readlinkSync(claudePath) !== "AGENTS.md") {
      fail(`packages/${name}/CLAUDE.md must be a symlink to AGENTS.md`);
    }
  }
  ok("root and package AGENTS/CLAUDE links exist");
}

function checkDocs() {
  for (const path of [
    "docs/development.md",
    "docs/testing.md",
    "docs/packaging.md",
    "docs/release.md",
    ".agent-os/project-index.md",
    ".agent-os/todo.md",
    ".agent-os/acceptance-report.md",
    ".agent-os/run-log.md",
  ]) {
    if (!fileExists(join(root, path))) fail(`${path} missing`);
  }
  ok("developer docs and agent-os state docs exist");
}

function checkDocumentationLanguage() {
  const documentPath = /\.(?:md|mdx|rst|txt)$/i;
  const localizedFilename = /(?:^|[._-])zh(?:[._-](?:cn|hans|hant))?(?:[._-]|$)/i;
  const hanText = /\p{Script=Han}/u;
  const paths = gitPaths(["ls-files", "--cached", "--others", "--exclude-standard"]);
  let invalid = false;

  for (const path of paths) {
    if (!documentPath.test(path) || !fileExists(join(root, path))) continue;
    if (/[^\x00-\x7f]/.test(path) || localizedFilename.test(path)) {
      fail(`documentation filename must be English-only: ${path}`);
      invalid = true;
      continue;
    }
    const content = readFileSync(join(root, path), "utf8");
    if (hanText.test(content)) {
      fail(`documentation must use English: ${path}`);
      invalid = true;
    }
  }

  if (!invalid) ok("documentation language and filenames are English-only");
}

function checkInstallPolicy() {
  const npmrcPath = join(root, ".npmrc");
  if (!fileExists(npmrcPath)) {
    fail(".npmrc missing");
    return;
  }
  const npmrc = readFileSync(npmrcPath, "utf8");
  for (const line of ["ignore-scripts=true", "audit=false", "fund=false"]) {
    if (!npmrc.split(/\r?\n/).includes(line)) fail(`.npmrc must contain ${line}`);
  }
  ok("npm install policy is stable");
}

function checkTrackedPaths() {
  const tracked = git(["ls-files"]).split("\n").filter(Boolean);
  const forbiddenPathPatterns = [
    /(^|\/)_paseo(\/|$)/,
    /^\.agent-os\/upstreams\//,
    /^\.agent-os\/artifacts\//,
    /^\.dev\//,
    /^packages\/app\/android\//,
    /^packages\/app\/ios\//,
    /(^|\/)node_modules\//,
    /(^|\/)\.expo\//,
    /(^|\/)\.wrangler\//,
  ];
  for (const path of tracked) {
    for (const pattern of forbiddenPathPatterns) {
      if (pattern.test(path)) fail(`forbidden tracked path: ${path}`);
    }
  }
  ok("forbidden generated/raw paths are not tracked");
}

function checkPackageConfigVoiceResidue() {
  const paths = [
    "package.json",
    "packages/app/package.json",
    "packages/app/app.config.js",
    "packages/daemon/package.json",
    ...expectedPackages.map((name) => `packages/${name}/package.json`),
  ];
  const pattern =
    /\b(audio|speech|voice|dictation)\b|RECORD_AUDIO|MODIFY_AUDIO_SETTINGS|microphone|expo-audio|expo-two-way-audio|sherpa/i;
  for (const path of [...new Set(paths)]) {
    const absolutePath = join(root, path);
    if (!fileExists(absolutePath)) continue;
    let content = readFileSync(absolutePath, "utf8");
    if (path === "packages/app/app.config.js") {
      content = content.replace(/blockedPermissions:\s*\[[\s\S]*?\],?/g, "");
    }
    if (pattern.test(content)) fail(`voice/audio residue in package/config file: ${path}`);
  }
  ok("package/config voice residue scan passed");
}

function checkSecrets() {
  const tracked = git(["ls-files"]).split("\n").filter(Boolean);
  const secretPattern =
    /ghp_[A-Za-z0-9_]+|-----BEGIN (RSA |DSA |EC |OPENSSH |)PRIVATE KEY-----|sk-[A-Za-z0-9]{32,}/;
  for (const path of tracked) {
    const absolutePath = join(root, path);
    if (!fileExists(absolutePath)) continue;
    const stats = statSync(absolutePath);
    if (stats.size > 1024 * 1024) continue;
    const buffer = readFileSync(absolutePath);
    if (buffer.includes(0)) continue;
    const content = buffer.toString("utf8");
    if (secretPattern.test(content)) fail(`secret-like content in ${path}`);
  }
  ok("secret-like scan passed");
}

function checkRemovedForegroundExecutionPath() {
  const tracked = git(["ls-files", "packages", "scripts"])
    .split("\n")
    .filter(Boolean)
    .filter((path) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path));
  const auditOnlyFiles = new Set([
    "packages/daemon/src/server/persisted-config.ts",
    "scripts/smoke-packaged-appimage-thoth-flow.mjs",
    "scripts/validate-repo.mjs",
  ]);
  const forbidden = [
    /workspace_secretary\./,
    /workspace_secretary_runtime_context/,
    /WorkspaceSecretarySession/,
    /ThothCleanUiModel/,
    /prepareForegroundAgentForThoth/,
    /emitMirroredAgentStream/,
    /\btopicAgents\b/,
    /\bproviderSession\b/,
    /(?:fetch|send|answer|cancel|create)WorkspaceSecretary/,
    /surface:\s*["']workspace-secretary["']/,
  ];
  for (const path of tracked) {
    if (auditOnlyFiles.has(path)) continue;
    const absolutePath = join(root, path);
    if (!fileExists(absolutePath) || statSync(absolutePath).size > 1024 * 1024) continue;
    const content = readFileSync(absolutePath, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(content)) {
        fail(`removed foreground execution path found in ${path}: ${pattern.source}`);
      }
    }
  }
  ok("removed foreground execution path is absent from product source");
}

function checkRemovedProviderSessionAndLoopPaths() {
  const tracked = git(["ls-files", "packages", "scripts"])
    .split("\n")
    .filter(Boolean)
    .filter((path) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path));
  const auditOnlyFiles = new Set([
    "packages/daemon/src/server/storage-layout-migration.ts",
    "packages/drivers/src/clarify/eval.ts",
    "packages/drivers/src/loop/eval.ts",
    "scripts/judge-clarify-user-simulation.mjs",
    "scripts/smoke-packaged-appimage-thoth-flow.mjs",
    "scripts/smoke-packaged-server-cli-relay.mjs",
    "scripts/validate-repo.mjs",
  ]);
  const forbidden = [
    /["']provider-sessions(?:["'/])/,
    /supportsNativeThothTools/,
    /ProviderRuntimeSession/,
    /runtimeSessionProvider/,
    /opencode-home/,
    /background_task\./,
    /codex[-_ ]phase[-_ ]recovery/i,
    /phase-recovery-adapters/,
    /runtime-session-adapters/,
    /RegisteredTaskModel/,
    /LoopTaskModel/,
  ];
  for (const path of tracked) {
    if (auditOnlyFiles.has(path)) continue;
    const absolutePath = join(root, path);
    if (!fileExists(absolutePath) || statSync(absolutePath).size > 1024 * 1024) continue;
    const content = readFileSync(absolutePath, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(content)) {
        fail(`removed provider-session or Loop path found in ${path}: ${pattern.source}`);
      }
    }
  }
  ok("removed provider-session and legacy Loop paths are absent from product source");
}

checkPackageBoundary();
checkPackageMetadata();
checkAgentDocs();
checkDocs();
checkDocumentationLanguage();
checkInstallPolicy();
checkTrackedPaths();
checkPackageConfigVoiceResidue();
checkSecrets();
checkRemovedForegroundExecutionPath();
checkRemovedProviderSessionAndLoopPaths();

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("THOTH_REPO_VALIDATION_OK");
