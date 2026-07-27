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

  write(fixture, "packages/protocol/src/rpc-registry.ts", "export const rpcVersion = 2;\n");
  write(fixture, "packages/client/src/transport.ts", "export const transport = 'registry';\n");
  write(fixture, "packages/server/src/session/runtime.ts", "export const lifecycle = 'durable';\n");
  const architectureSha = commit(fixture, "refactor: rewrite protocol session transport");

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
  assert(manifest.schema_version === 2, "Range inspection must emit schema version 2");
  assert(manifest.summary.commit_count === 3, "Range inspection must report three commits");
  assert(
    manifest.summary.excluded_capability_paths.includes("packages/app/src/voice-mode.ts"),
    "Range inspection must identify the excluded voice path",
  );
  const architectureCandidate = manifest.architecture_candidates.find(
    (candidate) => candidate.commit_sha === architectureSha,
  );
  assert(architectureCandidate, "Range inspection must identify the architecture candidate");
  assert(
    architectureCandidate.review_level === "required",
    "Cross-boundary architecture work must require review",
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
        schema_version: 2,
        paseo_base_sha: baseSha,
        paseo_target_sha: targetSha,
        thoth_base_sha: baseSha,
        release_intent: "analyze",
        changes: [
          {
            id: "timeline-terminal",
            upstream_commits: [acceptedSha],
            upstream_paths: ["packages/app/src/timeline.ts", "packages/app/src/terminal-pane.ts"],
            disposition: "adapt",
            reason: "Retain presentation improvements behind Thoth authority.",
            architecture_impact: "local",
            architecture_assessment:
              "The change is limited to App presentation and does not change a Thoth ownership boundary.",
            thoth_modules: ["packages/app"],
            formal_interface: "Canonical AgentTimeline projection",
            state_owner: "Daemon Workspace authority",
            acceptance: ["Focused App behavior tests"],
          },
          {
            id: "protocol-session-transport",
            upstream_commits: [architectureSha],
            upstream_paths: [
              "packages/protocol/src/rpc-registry.ts",
              "packages/client/src/transport.ts",
              "packages/server/src/session/runtime.ts",
            ],
            disposition: "defer",
            reason: "The upstream rewrite requires an explicit Thoth architecture decision.",
            architecture_impact: "architectural",
            architecture_assessment:
              "The commit changes Protocol, Client transport, and server session lifecycle together.",
            architecture_review: {
              status: "pending",
              discussion: {
                upstream_change:
                  "Paseo rewrites RPC, transport, and session lifecycle as one subsystem.",
                thoth_impact:
                  "A direct port would affect the Protocol Registry, semantic Client, Daemon runtime, and HarnessAdapter boundary.",
                authority_assessment:
                  "Paseo session ownership cannot replace Workspace and Task authority or ProviderThread opacity.",
                options: [
                  "Reject the upstream architecture and port no code.",
                  "Adapt selected transport mechanics inside Thoth's existing ownership model.",
                  "Revise the canonical Thoth architecture through a new user decision.",
                ],
                recommendation:
                  "Adapt only independently valuable mechanics after preserving the current Thoth ownership chain.",
                decision_question:
                  "Should Thoth adapt selected mechanics or reopen its canonical transport and session architecture?",
              },
            },
          },
          {
            id: "voice-mode",
            upstream_commits: [targetSha],
            upstream_paths: ["packages/app/src/voice-mode.ts"],
            disposition: "reject",
            reason: "Voice and direct model API paths are outside the Thoth boundary.",
            architecture_impact: "local",
            architecture_assessment:
              "The prohibited feature is local to the App and is rejected without changing Thoth architecture.",
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
  assert(provenance.summary.covered_commit_count === 3, "Every manifest commit must be covered");
  assert(
    provenance.summary.architecture_review_required === true,
    "Analyze mode must surface the pending architecture decision",
  );

  const pendingClassification = loadJson(classificationPath);
  pendingClassification.release_intent = "integrate";
  writeFileSync(classificationPath, `${JSON.stringify(pendingClassification, null, 2)}\n`);
  const pendingIntegrateRun = spawnSync(
    process.execPath,
    [provenanceScript, "--manifest", manifestPath, "--classification", classificationPath],
    { encoding: "utf8" },
  );
  assert(
    pendingIntegrateRun.status === 1,
    "Integrate mode must fail while architecture review is pending",
  );
  const pendingIntegrateReport = JSON.parse(pendingIntegrateRun.stdout);
  assert(
    pendingIntegrateReport.failures.some(
      (failure) => failure.code === "architecture-review-pending",
    ),
    "Pending integrate failure must identify the architecture review gate",
  );

  const approvedClassification = loadJson(classificationPath);
  const architectureChange = approvedClassification.changes.find(
    (change) => change.id === "protocol-session-transport",
  );
  architectureChange.disposition = "adapt";
  architectureChange.thoth_modules = ["packages/protocol", "packages/client", "packages/daemon"];
  architectureChange.formal_interface = "Protocol Registry -> semantic Client -> Daemon use case";
  architectureChange.state_owner = "Daemon Workspace authority";
  architectureChange.acceptance = ["Protocol/Client transport contract", "Daemon lifecycle test"];
  architectureChange.architecture_review.status = "approved";
  architectureChange.architecture_review.decision_id = "NTH-CD-999";
  writeFileSync(classificationPath, `${JSON.stringify(approvedClassification, null, 2)}\n`);
  run(process.execPath, [
    provenanceScript,
    "--manifest",
    manifestPath,
    "--classification",
    classificationPath,
    "--out",
    provenancePath,
  ]);
  const approvedProvenance = loadJson(provenancePath);
  assert(approvedProvenance.summary.ok === true, "Approved architecture review must pass");
  assert(
    approvedProvenance.summary.architecture_review_required === false,
    "Approved architecture review must clear the discussion gate",
  );

  const downclassified = structuredClone(approvedClassification);
  const downclassifiedChange = downclassified.changes.find(
    (change) => change.id === "protocol-session-transport",
  );
  downclassifiedChange.architecture_impact = "cross-layer";
  delete downclassifiedChange.architecture_review;
  writeFileSync(classificationPath, `${JSON.stringify(downclassified, null, 2)}\n`);
  const downclassifiedRun = spawnSync(
    process.execPath,
    [provenanceScript, "--manifest", manifestPath, "--classification", classificationPath],
    { encoding: "utf8" },
  );
  assert(
    downclassifiedRun.status === 1,
    "A required architecture candidate must not be silently downclassified",
  );
  const downclassifiedReport = JSON.parse(downclassifiedRun.stdout);
  assert(
    downclassifiedReport.failures.some(
      (failure) => failure.code === "required-architecture-review-missing",
    ),
    "Downclassification failure must identify the missing required architecture review",
  );

  const ignoredArchitecture = structuredClone(approvedClassification);
  ignoredArchitecture.changes = ignoredArchitecture.changes.filter(
    (change) => change.id !== "protocol-session-transport",
  );
  ignoredArchitecture.ignored_commits = [
    {
      sha: architectureSha,
      reason: "Attempt to hide an architecture candidate as an ignored commit.",
    },
  ];
  writeFileSync(classificationPath, `${JSON.stringify(ignoredArchitecture, null, 2)}\n`);
  const ignoredArchitectureRun = spawnSync(
    process.execPath,
    [provenanceScript, "--manifest", manifestPath, "--classification", classificationPath],
    { encoding: "utf8" },
  );
  assert(
    ignoredArchitectureRun.status === 1,
    "An architecture candidate must not be hidden in ignored commits",
  );
  const ignoredArchitectureReport = JSON.parse(ignoredArchitectureRun.stdout);
  assert(
    ignoredArchitectureReport.failures.some(
      (failure) => failure.code === "architecture-candidate-ignored",
    ),
    "Ignored candidate failure must identify the architecture discussion gate",
  );

  writeFileSync(
    classificationPath,
    `${JSON.stringify(
      {
        schema_version: 2,
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
    "Paseo sync skill tools passed: range inventory, architecture discussion gating, boundary blocking, and provenance coverage.",
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
