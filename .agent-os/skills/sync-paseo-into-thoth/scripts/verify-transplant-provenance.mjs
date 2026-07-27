#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DISPOSITIONS = new Set(["adopt", "adapt", "reject", "defer"]);
const RELEASE_INTENTS = new Set(["analyze", "integrate", "release-ready", "publish"]);
const ARCHITECTURE_IMPACTS = new Set(["local", "cross-layer", "architectural"]);
const ARCHITECTURE_REVIEW_STATUSES = new Set(["pending", "approved", "rejected"]);

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
    "Usage: npm run paseo:verify-provenance -- --manifest <manifest.json> --classification <classification.json> [--out <json>]",
  );
}

function loadJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function addFailure(failures, code, location, message) {
  failures.push({ code, location, message });
}

function validDecisionId(value) {
  return typeof value === "string" && /^NTH-CD-\d{3,}$/.test(value);
}

function validateArchitectureReview(failures, review, location) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    addFailure(
      failures,
      "missing-architecture-review",
      location,
      "Architecture-level changes require a structured review",
    );
    return null;
  }
  if (!ARCHITECTURE_REVIEW_STATUSES.has(review.status)) {
    addFailure(
      failures,
      "invalid-architecture-review-status",
      `${location}.status`,
      `Expected one of: ${[...ARCHITECTURE_REVIEW_STATUSES].join(", ")}`,
    );
  }
  const discussion = review.discussion;
  if (!discussion || typeof discussion !== "object" || Array.isArray(discussion)) {
    addFailure(
      failures,
      "missing-architecture-discussion",
      `${location}.discussion`,
      "Architecture review requires a discussion packet",
    );
  } else {
    for (const field of [
      "upstream_change",
      "thoth_impact",
      "authority_assessment",
      "recommendation",
      "decision_question",
    ]) {
      if (!nonEmptyString(discussion[field])) {
        addFailure(
          failures,
          "incomplete-architecture-discussion",
          `${location}.discussion.${field}`,
          `${field} is required`,
        );
      }
    }
    if (
      !Array.isArray(discussion.options) ||
      discussion.options.length < 2 ||
      !discussion.options.every(nonEmptyString)
    ) {
      addFailure(
        failures,
        "incomplete-architecture-options",
        `${location}.discussion.options`,
        "At least two concrete architecture options are required",
      );
    }
  }
  return review.status;
}

function writeJson(outputPath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (!outputPath) process.stdout.write(serialized);
  else {
    mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    writeFileSync(outputPath, serialized);
    console.log(`Transplant provenance report written: ${path.resolve(outputPath)}`);
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.manifest || !args.classification) {
    usage();
    throw new Error("--manifest and --classification are required");
  }

  const manifest = loadJson(args.manifest, "Manifest");
  const classification = loadJson(args.classification, "Classification");
  const failures = [];

  if (manifest.schema_version !== 2) {
    addFailure(failures, "manifest-schema", "manifest", "schema_version must be 2");
  }
  if (classification.schema_version !== 2) {
    addFailure(failures, "classification-schema", "classification", "schema_version must be 2");
  }

  const manifestBase = manifest.upstream?.base_sha;
  const manifestTarget = manifest.upstream?.target_sha;
  if (classification.paseo_base_sha !== manifestBase) {
    addFailure(
      failures,
      "base-sha-mismatch",
      "classification.paseo_base_sha",
      "Does not match manifest base SHA",
    );
  }
  if (classification.paseo_target_sha !== manifestTarget) {
    addFailure(
      failures,
      "target-sha-mismatch",
      "classification.paseo_target_sha",
      "Does not match manifest target SHA",
    );
  }
  if (!nonEmptyString(classification.thoth_base_sha)) {
    addFailure(
      failures,
      "missing-thoth-base",
      "classification.thoth_base_sha",
      "A Thoth base SHA is required",
    );
  }
  if (!RELEASE_INTENTS.has(classification.release_intent)) {
    addFailure(
      failures,
      "invalid-release-intent",
      "classification.release_intent",
      `Expected one of: ${[...RELEASE_INTENTS].join(", ")}`,
    );
  }

  const manifestCommits = new Set((manifest.commits ?? []).map((commit) => commit.sha));
  const architectureCandidates = Array.isArray(manifest.architecture_candidates)
    ? manifest.architecture_candidates
    : [];
  if (!Array.isArray(manifest.architecture_candidates)) {
    addFailure(
      failures,
      "missing-architecture-candidates",
      "manifest.architecture_candidates",
      "Manifest must contain the architecture candidate inventory",
    );
  }
  const candidateByCommit = new Map();
  for (const [index, candidate] of architectureCandidates.entries()) {
    const location = `manifest.architecture_candidates[${index}]`;
    if (!manifestCommits.has(candidate.commit_sha)) {
      addFailure(
        failures,
        "unknown-architecture-candidate",
        `${location}.commit_sha`,
        `Candidate commit is not in manifest: ${candidate.commit_sha}`,
      );
      continue;
    }
    if (candidate.review_level !== "review" && candidate.review_level !== "required") {
      addFailure(
        failures,
        "invalid-architecture-review-level",
        `${location}.review_level`,
        "Expected review or required",
      );
    }
    candidateByCommit.set(candidate.commit_sha, candidate);
  }
  const coveredCommits = new Set();
  const assessedCandidateCommits = new Set();
  const architecturalCandidateCommits = new Set();
  let architecturalChangeCount = 0;
  let pendingArchitectureReviewCount = 0;
  const changes = Array.isArray(classification.changes) ? classification.changes : [];
  if (!Array.isArray(classification.changes)) {
    addFailure(failures, "missing-changes", "classification.changes", "changes must be an array");
  }

  const ids = new Set();
  for (const [index, change] of changes.entries()) {
    const location = `classification.changes[${index}]`;
    if (!nonEmptyString(change.id))
      addFailure(failures, "missing-id", `${location}.id`, "A stable change id is required");
    else if (ids.has(change.id))
      addFailure(failures, "duplicate-id", `${location}.id`, `Duplicate id: ${change.id}`);
    else ids.add(change.id);

    if (!DISPOSITIONS.has(change.disposition)) {
      addFailure(
        failures,
        "invalid-disposition",
        `${location}.disposition`,
        `Expected one of: ${[...DISPOSITIONS].join(", ")}`,
      );
    }
    if (!nonEmptyString(change.reason))
      addFailure(failures, "missing-reason", `${location}.reason`, "A concrete reason is required");
    if (!ARCHITECTURE_IMPACTS.has(change.architecture_impact)) {
      addFailure(
        failures,
        "invalid-architecture-impact",
        `${location}.architecture_impact`,
        `Expected one of: ${[...ARCHITECTURE_IMPACTS].join(", ")}`,
      );
    }
    if (!nonEmptyString(change.architecture_assessment)) {
      addFailure(
        failures,
        "missing-architecture-assessment",
        `${location}.architecture_assessment`,
        "Every coherent change requires an explicit Thoth architecture assessment",
      );
    }
    if (!nonEmptyStrings(change.upstream_paths)) {
      addFailure(
        failures,
        "missing-upstream-paths",
        `${location}.upstream_paths`,
        "At least one upstream path is required",
      );
    }
    if (!nonEmptyStrings(change.upstream_commits)) {
      addFailure(
        failures,
        "missing-upstream-commits",
        `${location}.upstream_commits`,
        "At least one upstream commit is required",
      );
    } else {
      for (const sha of change.upstream_commits) {
        if (!manifestCommits.has(sha)) {
          addFailure(
            failures,
            "unknown-upstream-commit",
            `${location}.upstream_commits`,
            `Commit is not in manifest: ${sha}`,
          );
        } else {
          coveredCommits.add(sha);
          if (candidateByCommit.has(sha)) assessedCandidateCommits.add(sha);
          if (change.architecture_impact === "architectural") {
            architecturalCandidateCommits.add(sha);
          }
        }
      }
    }

    if (change.architecture_impact === "architectural") {
      architecturalChangeCount += 1;
      const reviewStatus = validateArchitectureReview(
        failures,
        change.architecture_review,
        `${location}.architecture_review`,
      );
      if (reviewStatus === "pending") {
        pendingArchitectureReviewCount += 1;
        if (classification.release_intent !== "analyze") {
          addFailure(
            failures,
            "architecture-review-pending",
            `${location}.architecture_review.status`,
            "Pending architecture review is allowed only in analyze mode",
          );
        }
        if (change.disposition !== "defer") {
          addFailure(
            failures,
            "pending-architecture-must-defer",
            `${location}.disposition`,
            "A pending architecture decision must remain deferred",
          );
        }
      } else if (reviewStatus === "approved") {
        if (!validDecisionId(change.architecture_review?.decision_id)) {
          addFailure(
            failures,
            "missing-architecture-decision",
            `${location}.architecture_review.decision_id`,
            "Approved architecture review requires a concrete NTH-CD decision",
          );
        }
        if (change.disposition === "reject") {
          addFailure(
            failures,
            "approved-architecture-rejected",
            `${location}.disposition`,
            "Approved architecture review cannot use reject disposition",
          );
        }
      } else if (reviewStatus === "rejected") {
        if (!validDecisionId(change.architecture_review?.decision_id)) {
          addFailure(
            failures,
            "missing-architecture-decision",
            `${location}.architecture_review.decision_id`,
            "Rejected architecture review requires a concrete NTH-CD decision",
          );
        }
        if (change.disposition !== "reject") {
          addFailure(
            failures,
            "rejected-architecture-not-rejected",
            `${location}.disposition`,
            "A rejected architecture direction must use reject disposition",
          );
        }
      }
    } else if (change.architecture_review !== undefined) {
      addFailure(
        failures,
        "unexpected-architecture-review",
        `${location}.architecture_review`,
        "Only architecture-level changes may carry architecture_review",
      );
    }

    if (change.disposition === "adopt" || change.disposition === "adapt") {
      if (!nonEmptyStrings(change.thoth_modules)) {
        addFailure(
          failures,
          "missing-thoth-modules",
          `${location}.thoth_modules`,
          "Accepted changes require final Thoth modules",
        );
      }
      if (!nonEmptyString(change.formal_interface)) {
        addFailure(
          failures,
          "missing-formal-interface",
          `${location}.formal_interface`,
          "Accepted changes require a formal interface",
        );
      }
      if (!nonEmptyString(change.state_owner)) {
        addFailure(
          failures,
          "missing-state-owner",
          `${location}.state_owner`,
          "Accepted changes require an explicit state owner",
        );
      }
      if (!nonEmptyStrings(change.acceptance)) {
        addFailure(
          failures,
          "missing-acceptance",
          `${location}.acceptance`,
          "Accepted changes require behavioral acceptance evidence",
        );
      }
    }
  }

  const ignored = Array.isArray(classification.ignored_commits)
    ? classification.ignored_commits
    : [];
  if (!Array.isArray(classification.ignored_commits)) {
    addFailure(
      failures,
      "missing-ignored-commits",
      "classification.ignored_commits",
      "ignored_commits must be an array",
    );
  }
  for (const [index, entry] of ignored.entries()) {
    const location = `classification.ignored_commits[${index}]`;
    if (!manifestCommits.has(entry.sha)) {
      addFailure(
        failures,
        "unknown-ignored-commit",
        `${location}.sha`,
        `Commit is not in manifest: ${entry.sha}`,
      );
    } else {
      coveredCommits.add(entry.sha);
      if (candidateByCommit.has(entry.sha)) {
        addFailure(
          failures,
          "architecture-candidate-ignored",
          `${location}.sha`,
          "Architecture candidate commits require an explicit coherent-change assessment",
        );
      }
    }
    if (!nonEmptyString(entry.reason)) {
      addFailure(
        failures,
        "missing-ignore-reason",
        `${location}.reason`,
        "Ignored commits require a reason",
      );
    }
  }

  for (const sha of manifestCommits) {
    if (!coveredCommits.has(sha)) {
      addFailure(
        failures,
        "unclassified-commit",
        "classification",
        `Manifest commit has no disposition: ${sha}`,
      );
    }
  }
  for (const [sha, candidate] of candidateByCommit) {
    if (!assessedCandidateCommits.has(sha)) {
      addFailure(
        failures,
        "unresolved-architecture-candidate",
        "classification",
        `Architecture candidate has no explicit change assessment: ${sha}`,
      );
    }
    if (candidate.review_level === "required" && !architecturalCandidateCommits.has(sha)) {
      addFailure(
        failures,
        "required-architecture-review-missing",
        "classification",
        `Required architecture candidate is not classified as architectural: ${sha}`,
      );
    }
  }

  const report = {
    schema_version: 1,
    manifest: path.resolve(args.manifest),
    classification: path.resolve(args.classification),
    paseo_base_sha: manifestBase ?? null,
    paseo_target_sha: manifestTarget ?? null,
    summary: {
      ok: failures.length === 0,
      manifest_commit_count: manifestCommits.size,
      covered_commit_count: coveredCommits.size,
      classified_change_count: changes.length,
      architecture_candidate_count: candidateByCommit.size,
      architectural_change_count: architecturalChangeCount,
      pending_architecture_review_count: pendingArchitectureReviewCount,
      architecture_review_required: pendingArchitectureReviewCount > 0,
      failure_count: failures.length,
    },
    failures,
  };
  writeJson(args.out, report);
  if (failures.length > 0) process.exit(1);
} catch (error) {
  console.error(
    `Transplant provenance verification failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}
