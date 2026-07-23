#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const excludedPathPatterns = [
  /(^|\/)__tests__(\/|$)/,
  /(^|\/)tests?(\/|$)/,
  /(^|\/)test-utils(\/|$)/,
  /(^|\/)e2e(\/|$)/,
  /(^|\/)fixtures?(\/|$)/,
  /(^|\/)test-fixtures?(\/|$)/,
  /(^|\/)maestro(\/|$)/,
  /(^|\/)golden(\/|$)/,
  /(^|\/)eval(\/|$)/,
  /(^|\/)user-simulation(\/|$)/,
  /(^|\/)i18n\/resources(\/|$)/,
  /(^|\/)(golden|eval|user-simulation)\.(ts|tsx|js|mjs|cjs)$/,
  /\.(test|spec)(\.[^.]+)?\.(ts|tsx|js|mjs|cjs)$/,
  /\.(e2e|real|local|browser|posix)\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/,
  /(^|\/)mock-[^/]*\.(ts|tsx|js|mjs|cjs)$/,
  /packages\/drivers\/src\/server\/agent\/providers\/mock-[^/]+\.ts$/,
  /packages\/app\/src\/terminal\/webview\/terminal-emulator-webview-html\.ts$/,
];

const args = parseArgs(process.argv.slice(2));
const manifest = collectManifest();

if (args.baseline) {
  compareWithBaseline(manifest, readJson(resolve(repoRoot, args.baseline)), args);
}

if (args.write) {
  writeFileSync(resolve(repoRoot, args.write), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

printSummary(manifest, args.baseline ? readJson(resolve(repoRoot, args.baseline)) : null);

function parseArgs(argv) {
  const result = {
    baseline: null,
    write: null,
    requireNetNegative: false,
    requireTarget: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--baseline") {
      result.baseline = requiredValue(argv, ++index, arg);
    } else if (arg === "--write") {
      result.write = requiredValue(argv, ++index, arg);
    } else if (arg === "--require-net-negative") {
      result.requireNetNegative = true;
    } else if (arg === "--require-target") {
      const value = Number(requiredValue(argv, ++index, arg));
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Invalid --require-target value: ${value}`);
      }
      result.requireTarget = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function candidateFiles(...pathspecs) {
  return [
    ...new Set(
      execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...pathspecs],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      )
        .split("\0")
        .filter(Boolean),
    ),
  ]
    .filter((file) => existsSync(resolve(repoRoot, file)))
    .sort();
}

function trackedProductionFiles() {
  return candidateFiles("packages")
    .filter((file) => /^packages\/[^/]+\/src\//.test(file))
    .filter((file) => sourceExtensions.has(extname(file)))
    .filter((file) => !excludedPathPatterns.some((pattern) => pattern.test(file)))
    .sort();
}

function collectManifest() {
  const files = trackedProductionFiles().map(measureFile);
  const packages = {};
  for (const file of files) {
    const packageName = file.path.split("/")[1] ?? "unknown";
    const aggregate = (packages[packageName] ??= emptyMetrics());
    addMetrics(aggregate, file);
  }

  const totals = emptyMetrics();
  for (const file of files) addMetrics(totals, file);

  return {
    schemaVersion: 1,
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim(),
    node: process.version,
    npm: execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim(),
    definition: {
      roots: ["packages"],
      extensions: [...sourceExtensions].sort(),
      excludes: excludedPathPatterns.map((pattern) => pattern.source),
      notes: [
        "Git-tracked and non-ignored candidate package production sources are counted so pre-commit gates cannot omit new files.",
        "Tests, fixtures, eval data, translations, generated terminal HTML, and mock providers are excluded.",
        "File moves are neutral because every current file is measured from content.",
      ],
    },
    totals,
    packages: Object.fromEntries(
      Object.entries(packages).sort(([left], [right]) => left.localeCompare(right)),
    ),
    runtimeDependencies: collectRuntimeDependencies(),
    publicSurface: collectPublicSurface(files),
    files,
  };
}

function measureFile(file) {
  const sourceText = readFileSync(resolve(repoRoot, file), "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  return {
    path: file,
    sha256: createHash("sha256").update(sourceText).digest("hex"),
    physicalLines: countPhysicalLines(sourceText),
    scannerTokens: countScannerTokens(sourceText, file),
    astNodes: countAstNodes(sourceFile),
    staticImportEdges: countStaticImportEdges(sourceFile),
    bytes: Buffer.byteLength(sourceText),
  };
}

function scriptKindFor(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".ts")) return ts.ScriptKind.TS;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function countPhysicalLines(sourceText) {
  if (sourceText.length === 0) return 0;
  const newlineCount = sourceText.match(/\n/g)?.length ?? 0;
  return newlineCount + (sourceText.endsWith("\n") ? 0 : 1);
}

function countScannerTokens(sourceText, file) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    file.endsWith(".tsx") ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    sourceText,
  );
  let count = 0;
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) count += 1;
  return count;
}

function countAstNodes(sourceFile) {
  let count = 0;
  const visit = (node) => {
    count += 1;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

function countStaticImportEdges(sourceFile) {
  let count = 0;
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && importHasRuntimeValue(node)) {
      count += 1;
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
      count += 1;
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

function importHasRuntimeValue(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (!clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function emptyMetrics() {
  return {
    files: 0,
    physicalLines: 0,
    scannerTokens: 0,
    astNodes: 0,
    staticImportEdges: 0,
    bytes: 0,
  };
}

function addMetrics(target, file) {
  target.files += 1;
  target.physicalLines += file.physicalLines;
  target.scannerTokens += file.scannerTokens;
  target.astNodes += file.astNodes;
  target.staticImportEdges += file.staticImportEdges;
  target.bytes += file.bytes;
}

function collectRuntimeDependencies() {
  const packageFiles = candidateFiles("package.json", "packages/*/package.json");
  const entries = [];
  for (const packageFile of packageFiles) {
    const packageJson = readJson(resolve(repoRoot, packageFile));
    for (const field of ["dependencies", "optionalDependencies"]) {
      for (const [name, version] of Object.entries(packageJson[field] ?? {})) {
        entries.push({ package: packageJson.name ?? packageFile, field, name, version });
      }
    }
  }
  return entries.sort((left, right) =>
    `${left.package}:${left.field}:${left.name}`.localeCompare(
      `${right.package}:${right.field}:${right.name}`,
    ),
  );
}

function collectPublicSurface(files) {
  const exportedNames = new Set();
  const daemonClientMethods = new Set();
  const wireTypes = new Set();
  const timelineTypes = new Set();
  const toolDetailTypes = new Set();
  const publicFiles = files.filter(
    ({ path }) =>
      path.startsWith("packages/protocol/src/") || path.startsWith("packages/client/src/"),
  );

  for (const { path } of publicFiles) {
    const sourceText = readFileSync(resolve(repoRoot, path), "utf8");
    const sourceFile = ts.createSourceFile(
      path,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(path),
    );
    if (path.startsWith("packages/protocol/src/") || path === "packages/client/src/index.ts") {
      collectExports(sourceFile, exportedNames);
    }
    collectDaemonClientMethods(sourceFile, daemonClientMethods);
    if (path.startsWith("packages/protocol/src/")) {
      collectDiscriminants(sourceFile, "type", wireTypes);
      collectDiscriminants(sourceFile, "type", timelineTypes);
      collectDiscriminants(sourceFile, "kind", toolDetailTypes);
    }
  }

  const providerIds = collectProviderIds(files);

  return {
    exportedNames: [...exportedNames].sort(),
    daemonClientMethods: [...daemonClientMethods].sort(),
    wireTypes: [...wireTypes].sort(),
    timelineTypes: [...timelineTypes].sort(),
    toolDetailTypes: [...toolDetailTypes].sort(),
    providerIds,
  };
}

function collectExports(sourceFile, exportedNames) {
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) exportedNames.add(element.name.text);
      }
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if ("name" in statement && statement.name && ts.isIdentifier(statement.name)) {
      exportedNames.add(statement.name.text);
    }
  }
}

function collectDaemonClientMethods(sourceFile, target) {
  const visit = (node) => {
    if (
      (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
      node.name?.text === "DaemonClient"
    ) {
      for (const member of node.members) {
        if (
          (ts.isMethodDeclaration(member) ||
            ts.isMethodSignature(member) ||
            ts.isGetAccessorDeclaration(member)) &&
          member.name &&
          (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name)) &&
          !hasPrivateModifier(member)
        ) {
          target.add(member.name.text);
        }
      }
    }
    if (
      (ts.isPropertyAssignment(node) || ts.isPropertySignature(node)) &&
      propertyText(node.name) === "clientMethod"
    ) {
      const value = ts.isPropertyAssignment(node) ? node.initializer : node.type;
      if (value && ts.isStringLiteralLike(value)) target.add(value.text);
      if (value && ts.isLiteralTypeNode(value) && ts.isStringLiteralLike(value.literal)) {
        target.add(value.literal.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectProviderIds(files) {
  const providerIds = new Set();
  for (const { path } of files) {
    if (
      path !== "packages/protocol/src/provider-manifest.ts" &&
      !path.endsWith("/provider-registry.ts") &&
      !path.endsWith("/provider-manifest.ts")
    ) {
      continue;
    }
    const sourceText = readFileSync(resolve(repoRoot, path), "utf8");
    const sourceFile = ts.createSourceFile(
      path,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(path),
    );
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const initializer = unwrapExpression(node.initializer);
        if (
          node.name.text === "AGENT_PROVIDER_DEFINITIONS" &&
          ts.isArrayLiteralExpression(initializer)
        ) {
          for (const element of initializer.elements) {
            const candidate = unwrapExpression(element);
            if (!ts.isObjectLiteralExpression(candidate)) continue;
            const id = candidate.properties.find(
              (property) =>
                ts.isPropertyAssignment(property) && propertyText(property.name) === "id",
            );
            if (id && ts.isPropertyAssignment(id) && ts.isStringLiteralLike(id.initializer)) {
              providerIds.add(id.initializer.text);
            }
          }
        }
        if (
          /PROVIDER_(?:CLIENT_)?(?:FACTORIES|MANIFESTS)/u.test(node.name.text) &&
          ts.isObjectLiteralExpression(initializer)
        ) {
          for (const property of initializer.properties) {
            if (!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property)) continue;
            const id = propertyText(property.name);
            if (id) providerIds.add(id);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  providerIds.delete("mock");
  providerIds.delete("mock-slow");
  return [...providerIds].sort();
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function hasPrivateModifier(node) {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return Boolean(modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword));
}

function collectDiscriminants(sourceFile, propertyName, target) {
  const visit = (node) => {
    if (
      (ts.isPropertyAssignment(node) || ts.isPropertySignature(node)) &&
      propertyText(node.name) === propertyName
    ) {
      const candidate = ts.isPropertyAssignment(node) ? node.initializer : node.type;
      collectStringLiterals(candidate, target);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function propertyText(name) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;
}

function collectStringLiterals(node, target) {
  if (!node) return;
  if (ts.isStringLiteralLike(node)) target.add(node.text);
  ts.forEachChild(node, (child) => collectStringLiterals(child, target));
}

function compareWithBaseline(current, baseline, options) {
  if (baseline.schemaVersion !== current.schemaVersion) {
    throw new Error(`Unsupported baseline schema ${baseline.schemaVersion}`);
  }
  const failures = [];
  for (const key of Object.keys(current.publicSurface)) {
    const missing = (baseline.publicSurface[key] ?? []).filter(
      (entry) => !(current.publicSurface[key] ?? []).includes(entry),
    );
    if (missing.length > 0) failures.push(`publicSurface.${key} missing: ${missing.join(", ")}`);
  }
  if (current.runtimeDependencies.length > baseline.runtimeDependencies.length) {
    failures.push(
      `runtime dependency edges grew ${baseline.runtimeDependencies.length} -> ${current.runtimeDependencies.length}`,
    );
  }
  if (options.requireNetNegative) {
    for (const key of ["physicalLines", "scannerTokens", "astNodes", "staticImportEdges"]) {
      if (current.totals[key] >= baseline.totals[key]) {
        failures.push(
          `${key} is not net-negative: ${baseline.totals[key]} -> ${current.totals[key]}`,
        );
      }
    }
  }
  if (
    options.requireTarget !== null &&
    baseline.totals.physicalLines - current.totals.physicalLines < options.requireTarget
  ) {
    failures.push(
      `production LOC reduction is ${baseline.totals.physicalLines - current.totals.physicalLines}, required ${options.requireTarget}`,
    );
  }
  if (failures.length > 0)
    throw new Error(`Refactor source contract failed:\n- ${failures.join("\n- ")}`);
}

function printSummary(current, baseline) {
  const rows = [
    ["files", current.totals.files],
    ["physicalLines", current.totals.physicalLines],
    ["scannerTokens", current.totals.scannerTokens],
    ["astNodes", current.totals.astNodes],
    ["staticImportEdges", current.totals.staticImportEdges],
    ["runtimeDependencyEdges", current.runtimeDependencies.length],
  ];
  for (const [label, value] of rows) {
    const baselineValue = baseline
      ? label === "runtimeDependencyEdges"
        ? baseline.runtimeDependencies.length
        : baseline.totals[label]
      : null;
    const delta =
      baselineValue === null || baselineValue === undefined ? "" : ` (${value - baselineValue})`;
    console.log(`${label}: ${value}${delta}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
