#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const inspectScript = path.join(scriptDir, "inspect-paseo-range.mjs");
const boundaryScript = path.join(scriptDir, "check-transplant-boundaries.mjs");
const provenanceScript = path.join(scriptDir, "verify-transplant-provenance.mjs");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

function git(repo, args) {
  return run("git", ["-C", repo, ...args]);
}

function write(repo, relativePath, content) {
  const absolute = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function commit(repo, message) {
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]).trim();
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const fixture = mkdtempSync(path.join(os.tmpdir(), "thoth-paseo-sync-skill-"));
try {
  git(fixture, ["init", "-q"]);
  git(fixture, ["config", "user.name", "Skill Fixture"]);
  git(fixture, ["config", "user.email", "skill-fixture@example.invalid"]);

  write(
    fixture,
    "package.json",
    `${JSON.stringify({ name: "paseo-sync-fixture", private: true, workspaces: ["packages/*"] }, null, 2)}\n`,
  );
  write(
    fixture,
    "packages/app/src/timeline.ts",
    "export function renderTimelineItem(value) {\n  return String(value);\n}\n",
  );
  const baseSha = commit(fixture, "fixture: baseline");

  write(
    fixture,
    "packages/app/src/timeline.ts",
    "export function renderTimelineItem(value) {\n  return String(value).trim();\n}\n",
  );
  write(fixture, "packages/app/src/terminal-pane.ts", 'export const label = "Terminal";\n');
  const acceptedSha = commit(fixture, "feat: improve timeline and terminal");

  write(
    fixture,
    "packages/app/src/voice-mode.ts",
    [
      'import OpenAI from "openai";',
      'export const legacy = "@getpaseo/app";',
      'export const endpoint = "https://api.openai.com/v1/responses";',
      "export const client = new OpenAI();",
      "",
    ].join("\n"),
  );
  const targetSha = commit(fixture, "feat: add voice mode");

  const manifestPath = path.join(fixture, "manifest.json");
  run(process.execPath, [
    inspectScript,
    "--repo",
    fixture,
    "--from",
    baseSha,
    "--to",
    targetSha,
    "--out",
    manifestPath,
  ]);
  const manifest = loadJson(manifestPath);
  assert(manifest.summary.commit_count === 2, "Range inspection must report two commits");
  assert(
    manifest.summary.excluded_capability_paths.includes("packages/app/src/voice-mode.ts"),
    "Range inspection must identify the excluded voice path",
  );

  const boundaryPath = path.join(fixture, "boundary.json");
  const boundaryRun = spawnSync(
    process.execPath,
    [
      boundaryScript,
      "--repo",
      fixture,
      "--base",
      baseSha,
      "--head",
      targetSha,
      "--out",
      boundaryPath,
    ],
    { encoding: "utf8" },
  );
  assert(boundaryRun.status === 1, "Boundary check must reject the prohibited fixture");
  const boundary = loadJson(boundaryPath);
  const blockingRules = new Set(
    boundary.findings
      .filter((finding) => finding.severity === "block")
      .map((finding) => finding.rule),
  );
  for (const rule of [
    "excluded-capability-path",
    "legacy-package-namespace",
    "hidden-model-api",
    "provider-sdk-outside-drivers",
  ]) {
    assert(blockingRules.has(rule), `Boundary report is missing rule: ${rule}`);
  }

  const classificationPath = path.join(fixture, "classification.json");
  writeFileSync(
    classificationPath,
    `${JSON.stringify(
      {
        schema_version: 1,
        paseo_base_sha: baseSha,
        paseo_target_sha: targetSha,
        thoth_base_sha: baseSha,
        release_intent: "integrate",
        changes: [
          {
            id: "timeline-terminal",
            upstream_commits: [acceptedSha],
            upstream_paths: ["packages/app/src/timeline.ts", "packages/app/src/terminal-pane.ts"],
            disposition: "adapt",
            reason: "Retain presentation improvements behind Thoth authority.",
            thoth_modules: ["packages/app"],
            formal_interface: "Canonical AgentTimeline projection",
            state_owner: "Daemon Workspace authority",
            acceptance: ["Focused App behavior tests"],
          },
          {
            id: "voice-mode",
            upstream_commits: [targetSha],
            upstream_paths: ["packages/app/src/voice-mode.ts"],
            disposition: "reject",
            reason: "Voice and direct model API paths are outside the Thoth boundary.",
          },
        ],
        ignored_commits: [],
      },
      null,
      2,
    )}\n`,
  );
  const provenancePath = path.join(fixture, "provenance.json");
  run(process.execPath, [
    provenanceScript,
    "--manifest",
    manifestPath,
    "--classification",
    classificationPath,
    "--out",
    provenancePath,
  ]);
  const provenance = loadJson(provenancePath);
  assert(provenance.summary.ok === true, "Complete provenance classification must pass");
  assert(provenance.summary.covered_commit_count === 2, "Every manifest commit must be covered");

  writeFileSync(
    classificationPath,
    `${JSON.stringify(
      {
        schema_version: 1,
        paseo_base_sha: baseSha,
        paseo_target_sha: targetSha,
        thoth_base_sha: baseSha,
        release_intent: "integrate",
        changes: [],
        ignored_commits: [],
      },
      null,
      2,
    )}\n`,
  );
  const incompleteRun = spawnSync(
    process.execPath,
    [provenanceScript, "--manifest", manifestPath, "--classification", classificationPath],
    { encoding: "utf8" },
  );
  assert(incompleteRun.status === 1, "Incomplete provenance classification must fail");

  console.log(
    "Paseo sync skill tools passed: range inventory, boundary blocking, and provenance coverage.",
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
