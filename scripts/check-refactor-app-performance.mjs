#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const baseline = readJson(resolve(repoRoot, args.baseline));
const candidate = readJson(resolve(repoRoot, args.candidate));
const failures = [];

if (JSON.stringify(candidate.measurement) !== JSON.stringify(baseline.measurement)) {
  failures.push("App performance measurement contract does not match the frozen baseline");
}

for (const metric of ["workspaceInteractiveMs", "jsHeapBytes", "settingsNavigationMs"]) {
  compareMetric(metric);
}

if (args.final) {
  const target = baseline.summary.workspaceInteractiveMs.median * 0.75;
  if (candidate.summary.workspaceInteractiveMs.median > target) {
    failures.push(
      `workspaceInteractiveMs=${candidate.summary.workspaceInteractiveMs.median.toFixed(2)} missed 25% target ${target.toFixed(2)}`,
    );
  }
}

if (failures.length > 0) {
  throw new Error(`Refactor App performance contract failed:\n- ${failures.join("\n- ")}`);
}

console.log(
  `App performance verified: interactive=${candidate.summary.workspaceInteractiveMs.median.toFixed(1)}ms heap=${formatMiB(candidate.summary.jsHeapBytes.median)} settings=${candidate.summary.settingsNavigationMs.median.toFixed(1)}ms`,
);

function compareMetric(metric) {
  const before = baseline.summary[metric];
  const after = candidate.summary[metric];
  const noiseRatio = before.median === 0 ? 0 : (2 * before.mad) / before.median;
  const toleratedRatio = Math.max(0.03, noiseRatio);
  const baselineValues = baseline.samples.map((sample) => sample[metric]);
  const candidateValues = candidate.samples.map((sample) => sample[metric]);
  const oneSidedP = mannWhitneyWorsePValue(candidateValues, baselineValues);
  if (after.median > before.median && oneSidedP < 0.05) {
    failures.push(
      `${metric} is statistically worse (one-sided Mann-Whitney p=${oneSidedP.toFixed(4)})`,
    );
  }
  if (after.median > before.median * (1 + toleratedRatio)) {
    failures.push(
      `${metric} regressed ${before.median.toFixed(2)} -> ${after.median.toFixed(2)} (tolerance ${(toleratedRatio * 100).toFixed(1)}%)`,
    );
  }
}

function mannWhitneyWorsePValue(candidate, baselineValues) {
  const pooled = [
    ...candidate.map((value) => ({ value, candidate: true })),
    ...baselineValues.map((value) => ({ value, candidate: false })),
  ].sort((left, right) => left.value - right.value);
  const ranks = new Array(pooled.length);
  for (let start = 0; start < pooled.length; ) {
    let end = start + 1;
    while (end < pooled.length && pooled[end].value === pooled[start].value) end += 1;
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[index] = averageRank;
    start = end;
  }
  const observedRankSum = pooled.reduce(
    (sum, entry, index) => sum + (entry.candidate ? ranks[index] : 0),
    0,
  );
  let permutations = 0;
  let atLeastObserved = 0;
  enumerateRankSums(ranks, candidate.length, 0, 0, (rankSum) => {
    permutations += 1;
    if (rankSum >= observedRankSum - Number.EPSILON) atLeastObserved += 1;
  });
  return atLeastObserved / permutations;
}

function enumerateRankSums(ranks, remaining, index, sum, visit) {
  if (remaining === 0) {
    visit(sum);
    return;
  }
  const finalStart = ranks.length - remaining;
  for (let current = index; current <= finalStart; current += 1) {
    enumerateRankSums(ranks, remaining - 1, current + 1, sum + ranks[current], visit);
  }
}

function parseArgs(argv) {
  const result = {
    baseline: "scripts/refactor-app-performance-baseline.json",
    candidate: ".dev/refactor-app-performance-current.json",
    final: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--baseline") result.baseline = requiredValue(argv, ++index, arg);
    else if (arg === "--candidate") result.candidate = requiredValue(argv, ++index, arg);
    else if (arg === "--final") result.final = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MiB`;
}
