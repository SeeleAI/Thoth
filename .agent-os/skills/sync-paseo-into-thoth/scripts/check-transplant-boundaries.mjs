#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg.startsWith("--")) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      out[arg.slice(2)] = value;
      index += 1;
    } else throw new Error(`Unexpected argument: ${arg}`);
  }
  return out;
}

function usage() {
  console.log(
    "Usage: npm run paseo:check-boundaries -- --repo <thoth-repo> --base <sha> [--head <sha|WORKTREE>] [--out <json>]",
  );
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
}

function resolveCommit(repo, ref) {
  try {
    return git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  } catch {
    throw new Error(`Ref is not a commit in ${repo}: ${ref}`);
  }
}

function splitNul(raw) {
  return raw.split("\0").filter(Boolean);
}

function changedPaths(repo, baseSha, head) {
  if (head !== "WORKTREE") {
    const headSha = resolveCommit(repo, head);
    return {
      head: headSha,
      paths: splitNul(git(repo, ["diff", "--name-only", "-z", "-M", baseSha, headSha, "--"])),
    };
  }
  const tracked = splitNul(git(repo, ["diff", "--name-only", "-z", "-M", baseSha, "--"]));
  const untracked = splitNul(git(repo, ["ls-files", "--others", "--exclude-standard", "-z"]));
  return { head: "WORKTREE", paths: [...new Set([...tracked, ...untracked])].sort() };
}

function isTestOrFixture(filePath) {
  return /(^|\/)(tests?|test-fixtures|fixtures)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|\.e2e\./.test(
    filePath,
  );
}

function isProductionSource(filePath) {
  return filePath.startsWith("packages/") && !isTestOrFixture(filePath);
}

function readText(repo, filePath) {
  const absolute = path.join(repo, filePath);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) return null;
  const buffer = readFileSync(absolute);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

function addFinding(findings, rule, severity, filePath, evidence) {
  findings.push({ rule, severity, path: filePath, evidence });
}

function checkFile(repo, filePath, findings) {
  if (!isProductionSource(filePath)) return;
  if (/(^|[\/_-])(audio|speech|voice|dictation)([\/_\-.]|$)/i.test(filePath)) {
    addFinding(
      findings,
      "excluded-capability-path",
      "block",
      filePath,
      "Production path matches the current voice/audio/speech/dictation non-goal.",
    );
  }

  const text = readText(repo, filePath);
  if (text === null) return;
  if (text.includes("@getpaseo")) {
    addFinding(findings, "legacy-package-namespace", "block", filePath, "Contains @getpaseo.");
  }
  if (text.includes("PASEO_HOME")) {
    addFinding(findings, "legacy-provider-home", "block", filePath, "Contains PASEO_HOME.");
  }
  if (/(?:localhost|127\.0\.0\.1):6767/.test(text)) {
    addFinding(
      findings,
      "reserved-paseo-port",
      "block",
      filePath,
      "Uses the reserved Paseo endpoint in production source.",
    );
  }
  if (/api\.openai\.com\/v1\/(?:responses|chat\/completions)/.test(text)) {
    addFinding(
      findings,
      "hidden-model-api",
      "block",
      filePath,
      "Contains a direct general-purpose OpenAI inference endpoint.",
    );
  }
  if (
    /^packages\/(?:app|desktop|tui|cli)\//.test(filePath) &&
    /(?:node:sqlite|better-sqlite3)/.test(text)
  ) {
    addFinding(
      findings,
      "ui-direct-sqlite",
      "block",
      filePath,
      "A client shell appears to import SQLite directly.",
    );
  }
  if (
    /^packages\/(?:app|daemon)\//.test(filePath) &&
    /from\s+["'](?:@anthropic-ai\/sdk|openai|@openai\/)/.test(text)
  ) {
    addFinding(
      findings,
      "provider-sdk-outside-drivers",
      "block",
      filePath,
      "A Provider SDK appears outside the Drivers ownership boundary.",
    );
  }
  if (/^packages\/(?:app|daemon)\//.test(filePath) && /provider\s*={2,3}\s*["']/.test(text)) {
    addFinding(
      findings,
      "provider-name-branch-review",
      "review",
      filePath,
      "Review whether a Provider-name branch controls product behavior instead of transport translation.",
    );
  }
}

function writeJson(outputPath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (!outputPath) process.stdout.write(serialized);
  else {
    mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    writeFileSync(outputPath, serialized);
    console.log(`Transplant boundary report written: ${path.resolve(outputPath)}`);
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.repo || !args.base) {
    usage();
    throw new Error("--repo and --base are required");
  }
  const repo = path.resolve(args.repo);
  git(repo, ["rev-parse", "--is-inside-work-tree"]);
  const baseSha = resolveCommit(repo, args.base);
  const head = args.head ?? "WORKTREE";
  const changed = changedPaths(repo, baseSha, head);
  const findings = [];

  const packageJson = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
  if (JSON.stringify(packageJson.workspaces) !== JSON.stringify(["packages/*"])) {
    addFinding(
      findings,
      "root-workspace-boundary",
      "block",
      "package.json",
      "Root workspaces must remain exactly ['packages/*'].",
    );
  }

  const trackedUpstream = git(repo, ["ls-files", ".agent-os/upstreams/"])
    .split("\n")
    .filter(Boolean);
  for (const filePath of trackedUpstream) {
    addFinding(
      findings,
      "tracked-upstream-cache",
      "block",
      filePath,
      "Raw upstream cache must remain ignored and untracked.",
    );
  }

  for (const filePath of changed.paths) checkFile(repo, filePath, findings);
  const blocking = findings.filter((finding) => finding.severity === "block");
  const report = {
    schema_version: 1,
    thoth: { repository_path: repo, base_sha: baseSha, head: changed.head },
    changed_paths: changed.paths,
    findings,
    summary: {
      ok: blocking.length === 0,
      changed_path_count: changed.paths.length,
      blocking_count: blocking.length,
      review_count: findings.length - blocking.length,
    },
  };
  writeJson(args.out, report);
  if (blocking.length > 0) process.exit(1);
} catch (error) {
  console.error(
    `Transplant boundary check failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}
