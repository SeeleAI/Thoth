#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
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
    "Usage: npm run paseo:inspect -- --repo <git-repo> --from <sha> --to <sha> [--out <json>]",
  );
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
}

function resolveCommit(repo, ref, label) {
  try {
    return git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  } catch {
    throw new Error(`${label} is not a commit in ${repo}: ${ref}`);
  }
}

function assertAncestor(repo, base, target) {
  const result = spawnSync("git", ["-C", repo, "merge-base", "--is-ancestor", base, target], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Base commit is not an ancestor of target: ${base}..${target}`);
  }
}

function parseNameStatus(raw) {
  const tokens = raw.split("\0");
  const changes = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++];
    if (!status) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = tokens[index++];
      const newPath = tokens[index++];
      changes.push({ status, old_path: oldPath, path: newPath, category: categorize(newPath) });
    } else {
      const changedPath = tokens[index++];
      if (changedPath)
        changes.push({ status, path: changedPath, category: categorize(changedPath) });
    }
  }
  return changes;
}

function categorize(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const packageMatch = normalized.match(/^packages\/([^/]+)\//);
  if (packageMatch) return `package:${packageMatch[1]}`;
  if (normalized.startsWith(".github/")) return "github";
  if (normalized.startsWith("scripts/")) return "scripts";
  if (normalized.startsWith("docs/") || normalized.startsWith("public-docs/")) return "docs";
  if (normalized.startsWith("skills/") || normalized.includes("/.agents/")) return "skills";
  if (normalized.startsWith("docker/") || normalized.startsWith("nix/")) return "infrastructure";
  return "root";
}

function changedPathsForCommit(repo, sha) {
  const raw = git(repo, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-M", sha]);
  return raw
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const architectureSubjectPattern =
  /\b(architect(?:ure|ural)?|refactor|redesign|rewrite|rework|overhaul|migrat(?:e|ion))\b/i;
const architectureBoundaryPathPattern =
  /(^|\/)(architecture|protocol|rpc|registry|transport|session|provider|adapter|runtime|lifecycle|storage|store|database|schema|migration|repository|composition|supervisor|daemon)([./_-]|$)/i;
const architecturePackages = new Set([
  "client",
  "core",
  "daemon",
  "drivers",
  "protocol",
  "relay",
  "server",
]);

function architectureSignals(subject, paths) {
  const normalizedPaths = paths.map((entry) => entry.replaceAll("\\", "/"));
  const packageNames = new Set(
    normalizedPaths.map((entry) => entry.match(/^packages\/([^/]+)\//)?.[1]).filter(Boolean),
  );
  const boundaryPackages = [...packageNames].filter((entry) => architecturePackages.has(entry));
  const boundaryPaths = normalizedPaths.filter((entry) =>
    architectureBoundaryPathPattern.test(entry),
  );
  const topologyPaths = normalizedPaths.filter((entry) =>
    /^(?:(?:pnpm-)?workspace\.ya?ml|turbo\.json|nx\.json)$/.test(entry),
  );
  const rootConfigurationPaths = normalizedPaths.filter((entry) =>
    /^(package\.json|tsconfig\.json)$/.test(entry),
  );
  const categories = new Set(normalizedPaths.map((entry) => categorize(entry)));
  const signals = [];

  if (architectureSubjectPattern.test(subject)) {
    signals.push({
      code: "architecture-subject",
      level: "review",
      detail:
        "Commit subject describes an architecture, refactor, rewrite, migration, or redesign.",
    });
  }
  if (boundaryPaths.length > 0) {
    signals.push({
      code: "architecture-boundary-path",
      level: "review",
      detail:
        "Changed paths touch protocol, transport, session, provider, runtime, storage, or lifecycle boundaries.",
      paths: [...new Set(boundaryPaths)].sort(),
    });
  }
  if (topologyPaths.length > 0) {
    signals.push({
      code: "repository-topology",
      level: "required",
      detail: "Changed paths can alter workspace, package, or repository topology.",
      paths: [...new Set(topologyPaths)].sort(),
    });
  }
  if (rootConfigurationPaths.length > 0) {
    signals.push({
      code: "root-configuration",
      level: "review",
      detail:
        "Root manifest or TypeScript configuration changes may affect dependency direction or package contracts.",
      paths: [...new Set(rootConfigurationPaths)].sort(),
    });
  }
  if (
    boundaryPackages.length >= 3 ||
    (boundaryPackages.length >= 2 && architectureSubjectPattern.test(subject))
  ) {
    signals.push({
      code: "cross-boundary-package-change",
      level: "required",
      detail: "One commit changes multiple architecture-owning packages.",
      packages: boundaryPackages.sort(),
    });
  }
  if (normalizedPaths.length >= 25 && categories.size >= 3) {
    signals.push({
      code: "large-cross-category-change",
      level: "review",
      detail: "One commit changes at least 25 paths across at least three repository categories.",
    });
  }

  return signals;
}

function summarize(changes) {
  const categories = {};
  for (const change of changes)
    categories[change.category] = (categories[change.category] ?? 0) + 1;
  const dependencyFiles = changes
    .map((change) => change.path)
    .filter((entry) => /(^|\/)(package(?:-lock)?\.json|\.npmrc)$/.test(entry));
  const workflowFiles = changes
    .map((change) => change.path)
    .filter((entry) => entry.startsWith(".github/workflows/"));
  const excludedCapabilityPaths = changes
    .map((change) => change.path)
    .filter((entry) => /(^|[\/_-])(audio|speech|voice|dictation)([\/_\-.]|$)/i.test(entry));
  return {
    commit_count: 0,
    changed_path_count: changes.length,
    categories,
    dependency_files: [...new Set(dependencyFiles)].sort(),
    workflow_files: [...new Set(workflowFiles)].sort(),
    excluded_capability_paths: [...new Set(excludedCapabilityPaths)].sort(),
  };
}

function writeJson(outputPath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (!outputPath) {
    process.stdout.write(serialized);
    return;
  }
  mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  writeFileSync(outputPath, serialized);
  console.log(`Paseo range manifest written: ${path.resolve(outputPath)}`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.repo || !args.from || !args.to) {
    usage();
    throw new Error("--repo, --from, and --to are required");
  }

  const repo = realpathSync(args.repo);
  git(repo, ["rev-parse", "--is-inside-work-tree"]);
  const baseSha = resolveCommit(repo, args.from, "Base ref");
  const targetSha = resolveCommit(repo, args.to, "Target ref");
  assertAncestor(repo, baseSha, targetSha);

  const logRaw = git(repo, [
    "log",
    "--reverse",
    "--format=%H%x1f%aI%x1f%s%x1e",
    `${baseSha}..${targetSha}`,
  ]);
  const commits = logRaw
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, authoredAt, ...subjectParts] = record.split("\x1f");
      const subject = subjectParts.join("\x1f");
      const paths = changedPathsForCommit(repo, sha);
      return {
        sha,
        authored_at: authoredAt,
        subject,
        paths,
        architecture_signals: architectureSignals(subject, paths),
      };
    });

  const changes = parseNameStatus(
    git(repo, ["diff", "--name-status", "-z", "-M", baseSha, targetSha, "--"]),
  );
  const summary = summarize(changes);
  summary.commit_count = commits.length;
  const architectureCandidates = commits
    .filter((commit) => commit.architecture_signals.length > 0)
    .map((commit) => ({
      commit_sha: commit.sha,
      subject: commit.subject,
      review_level: commit.architecture_signals.some((signal) => signal.level === "required")
        ? "required"
        : "review",
      signals: commit.architecture_signals,
    }));
  summary.architecture_candidate_count = architectureCandidates.length;
  summary.required_architecture_review_count = architectureCandidates.filter(
    (candidate) => candidate.review_level === "required",
  ).length;

  writeJson(args.out, {
    schema_version: 2,
    upstream: {
      repository_path: repo,
      base_sha: baseSha,
      target_sha: targetSha,
      range: `${baseSha}..${targetSha}`,
    },
    commits,
    changes,
    architecture_candidates: architectureCandidates,
    summary,
  });
} catch (error) {
  console.error(`Paseo range inspection failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
