import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SANDBOX_ALLOWLIST = new Set(["electron"]);
const preloadPath = join(dirname(fileURLToPath(import.meta.url)), "preload.cts");
const browserProfilePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "features",
  "browser-profile.ts",
);

function runtimeModuleSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "preload.cts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const record = (node: ts.Expression | undefined): void => {
    if (node && ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
    }
  };
  const isTypeOnlyImport = (node: ts.ImportDeclaration): boolean => {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    const bindings = clause.namedBindings;
    return (
      clause.name === undefined &&
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length > 0 &&
      bindings.elements.every((element) => element.isTypeOnly)
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!isTypeOnlyImport(node)) record(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) {
      record(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamicImport) record(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

describe("preload sandbox safety", () => {
  it("only loads Electron's sandbox allowlist at runtime", () => {
    const source = readFileSync(preloadPath, "utf8");
    const disallowed = runtimeModuleSpecifiers(source).filter(
      (specifier) => !SANDBOX_ALLOWLIST.has(specifier),
    );
    expect(disallowed).toEqual([]);
  });

  it("exposes the shared browser profile and the host-scoped browser bridge", () => {
    const preloadSource = readFileSync(preloadPath, "utf8");
    const browserProfileSource = readFileSync(browserProfilePath, "utf8");

    expect(preloadSource).toContain(
      'const THOTH_BROWSER_PROFILE_PARTITION = "persist:thoth-browser"',
    );
    expect(browserProfileSource).toContain(
      'export const THOTH_BROWSER_PROFILE_PARTITION = "persist:thoth-browser"',
    );
    expect(preloadSource).toContain("profilePartition: THOTH_BROWSER_PROFILE_PARTITION");
    expect(preloadSource).toContain('ipcRenderer.invoke("thoth:browser:register-attached"');
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("thoth:browser:unregister-workspace-browser"',
    );
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("thoth:browser:set-workspace-active-browser", input)',
    );
    expect(preloadSource).toContain('ipcRenderer.invoke("thoth:browser:clear-profile"');
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("thoth:browser:execute-automation-command", request)',
    );
    expect(preloadSource).not.toContain("thoth:browser:clear-partition");
    expect(preloadSource).not.toContain("persist:thoth-browser-${");
  });
});
