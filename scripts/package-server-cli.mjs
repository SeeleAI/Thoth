#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MVP_PACKAGE_JSON_PATHS,
  MVP_SERVER_CLI_PACKAGE_NAME,
  MVP_VERSION,
  resolveMvpServerCliPackages,
} from "./mvp-release-contract.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mvpPackageManifests = MVP_PACKAGE_JSON_PATHS.map((relativePath) => ({
  relativePath,
  value: readJson(join(repoRoot, relativePath)),
}));
const rootLockfile = readJson(join(repoRoot, "package-lock.json"));
const internalPackages = resolveMvpServerCliPackages(mvpPackageManifests).map(
  ({ relativePath, value }) => [value.name, dirname(relativePath)],
);
const internalNames = new Set(internalPackages.map(([name]) => name));

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, ...options.env },
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function packPackage(packageRoot, destination) {
  const output = run(
    "npm",
    ["pack", "--ignore-scripts", "--silent", "--pack-destination", destination],
    { cwd: packageRoot },
  );
  const filename = output.trim().split(/\r?\n/u).filter(Boolean).at(-1);
  if (!filename?.endsWith(".tgz")) {
    throw new Error(`npm pack did not report an artifact for ${packageRoot}`);
  }
  return join(destination, basename(filename));
}

function mergeDependency(target, name, version, source) {
  const current = target[name];
  if (current && current !== version) {
    throw new Error(
      `Conflicting release dependency ${name}: ${current} versus ${version} from ${source}`,
    );
  }
  target[name] = version;
}

function lockedExternalVersion(name, source) {
  const version = rootLockfile.packages?.[`node_modules/${name}`]?.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`Missing locked external dependency ${name} required by ${source}`);
  }
  return version;
}

const outputDir = resolve(repoRoot, optionValue("--output-dir") ?? ".dev/release-artifacts");
const skipBuild = process.argv.includes("--skip-build");
const workRoot = mkdtempSync(join(tmpdir(), "thoth-server-cli-"));
const packDir = join(workRoot, "packs");
const stageDir = join(workRoot, "stage");
const finalName = `thoth-server-cli-${MVP_VERSION}.tgz`;
const finalPath = join(outputDir, finalName);

mkdirSync(packDir, { recursive: true });
mkdirSync(stageDir, { recursive: true });
mkdirSync(outputDir, { recursive: true });

try {
  if (!skipBuild) {
    run("npm", ["run", "build:release-runtime"], { stdio: "inherit" });
  }

  run("node", ["scripts/mvp-release-contract.mjs"], { stdio: "inherit" });

  const packageTarballs = [];
  for (const [packageName, relativeRoot] of internalPackages) {
    const packageRoot = join(repoRoot, relativeRoot);
    const packageTarball = packPackage(packageRoot, packDir);
    packageTarballs.push(packageTarball);
    console.log(`Packed ${packageName}`);
  }

  const cliManifest = mvpPackageManifests.find(
    ({ value }) => value.name === MVP_SERVER_CLI_PACKAGE_NAME,
  );
  if (!cliManifest) throw new Error(`Missing ${MVP_SERVER_CLI_PACKAGE_NAME} manifest`);
  const cliRoot = join(repoRoot, dirname(cliManifest.relativePath));
  const cliPackage = cliManifest.value;
  const externalDependencies = {};
  const externalOptionalDependencies = {};
  for (const [packageName, relativeRoot] of [
    ...internalPackages,
    [cliPackage.name, "packages/cli"],
  ]) {
    const packageJson = readJson(join(repoRoot, relativeRoot, "package.json"));
    for (const name of Object.keys(packageJson.dependencies ?? {})) {
      if (!internalNames.has(name)) {
        mergeDependency(
          externalDependencies,
          name,
          lockedExternalVersion(name, packageName),
          packageName,
        );
      }
    }
    for (const name of Object.keys(packageJson.optionalDependencies ?? {})) {
      if (!internalNames.has(name) && !externalDependencies[name]) {
        mergeDependency(
          externalOptionalDependencies,
          name,
          lockedExternalVersion(name, packageName),
          packageName,
        );
      }
    }
  }
  const stagedPackage = {
    name: "@thoth/cli",
    version: MVP_VERSION,
    private: true,
    description: cliPackage.description,
    license: cliPackage.license,
    type: cliPackage.type,
    bin: cliPackage.bin,
    engines: { node: ">=24.14.0" },
    dependencies: {
      ...externalDependencies,
      ...Object.fromEntries(internalPackages.map(([name]) => [name, MVP_VERSION])),
    },
    optionalDependencies: externalOptionalDependencies,
    bundleDependencies: [...internalNames],
  };

  writeFileSync(join(stageDir, "package.json"), `${JSON.stringify(stagedPackage, null, 2)}\n`);
  writeFileSync(join(stageDir, ".npmrc"), "@thoth:registry=http://127.0.0.1:9\n");
  cpSync(join(cliRoot, "bin"), join(stageDir, "bin"), { recursive: true });
  cpSync(join(cliRoot, "dist"), join(stageDir, "dist"), { recursive: true });
  if (existsSync(join(cliRoot, "README.md"))) {
    copyFileSync(join(cliRoot, "README.md"), join(stageDir, "README.md"));
  } else {
    writeFileSync(
      join(stageDir, "README.md"),
      `# Thoth Server CLI\n\nGitHub Release bundle for Thoth ${MVP_VERSION}.\n`,
    );
  }
  copyFileSync(join(repoRoot, "LICENSE"), join(stageDir, "LICENSE"));

  run(
    "npm",
    [
      "install",
      "--no-save",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--prefer-offline",
      "--fetch-retries=1",
      "--fetch-timeout=30000",
      ...packageTarballs,
    ],
    { cwd: stageDir, stdio: "inherit" },
  );

  const installedScope = join(stageDir, "node_modules", "@thoth");
  const installedNames = readdirSync(installedScope).sort();
  const expectedNames = [...internalNames].map((name) => name.slice("@thoth/".length)).sort();
  if (JSON.stringify(installedNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Server CLI installed private package set mismatch: expected ${expectedNames.join(", ")}; got ${installedNames.join(", ")}`,
    );
  }
  for (const installedName of installedNames) {
    const packageRoot = join(installedScope, installedName);
    const packageJsonPath = join(packageRoot, "package.json");
    const packageJson = readJson(packageJsonPath);
    packageJson.dependencies = {};
    delete packageJson.optionalDependencies;
    delete packageJson.peerDependencies;
    delete packageJson.peerDependenciesMeta;
    delete packageJson.devDependencies;
    delete packageJson.bundleDependencies;
    delete packageJson.bundledDependencies;
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    rmSync(join(packageRoot, "node_modules"), { recursive: true, force: true });
  }
  rmSync(join(stageDir, ".npmrc"), { force: true });

  const stageNodeModules = join(stageDir, "node_modules");
  for (const entry of readdirSync(stageNodeModules)) {
    if (entry !== "@thoth") {
      rmSync(join(stageNodeModules, entry), { recursive: true, force: true });
    }
  }
  rmSync(join(stageDir, "package-lock.json"), { force: true });

  const packedPath = packPackage(stageDir, outputDir);
  rmSync(finalPath, { force: true });
  renameSync(packedPath, finalPath);

  const archiveList = run("tar", ["-tzf", finalPath]);
  const requiredEntries = [
    "package/bin/thoth",
    ...internalPackages.map(
      ([packageName]) =>
        `package/node_modules/@thoth/${packageName.slice("@thoth/".length)}/package.json`,
    ),
    "package/node_modules/@thoth/drivers/dist/runtime-skills/thoth-clarify/SKILL.md",
    "package/node_modules/@thoth/drivers/dist/runtime-skills/thoth-loop/SKILL.md",
  ];
  for (const requiredEntry of requiredEntries) {
    if (!archiveList.includes(requiredEntry)) {
      throw new Error(`Server CLI archive is missing ${requiredEntry}`);
    }
  }

  const bundledThirdParty = archiveList
    .split(/\r?\n/u)
    .filter((entry) => entry.startsWith("package/node_modules/"))
    .filter((entry) => !entry.startsWith("package/node_modules/@thoth/"));
  if (bundledThirdParty.length > 0) {
    throw new Error(`Server CLI archive bundles third-party modules: ${bundledThirdParty[0]}`);
  }

  console.log(
    JSON.stringify(
      { version: MVP_VERSION, artifact: finalPath, bytes: statSync(finalPath).size },
      null,
      2,
    ),
  );
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
