#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import net from "node:net";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const daemonEntrypoint = resolve(repoRoot, "packages/daemon/dist/scripts/supervisor-entrypoint.js");
const sampleCount = 7;
const warmupSampleCount = 1;
const idleSettleMs = 2_000;
const idleCpuWindowMs = 750;
const healthWarmupRequestCount = 20;
const healthRequestCount = 400;
const args = parseArgs(process.argv.slice(2));
const samples = [];

if (process.platform !== "linux") {
  throw new Error("The bounded refactor performance gate currently requires Linux /proc metrics");
}
if (!existsSync(daemonEntrypoint)) {
  throw new Error("Missing built daemon entrypoint. Run npm run build:daemon first.");
}

for (let index = 0; index < warmupSampleCount; index += 1) {
  await measureDaemon(`warmup-${index + 1}`);
  console.log(`[perf warmup ${index + 1}/${warmupSampleCount}] complete`);
}

for (let index = 0; index < sampleCount; index += 1) {
  const sample = await measureDaemon(index + 1);
  samples.push(sample);
  console.log(
    `[perf ${index + 1}/${sampleCount}] startup=${sample.startupMs.toFixed(1)}ms rss=${formatMiB(sample.idleRssBytes)} idleCpu=${sample.idleCpuMs.toFixed(2)}ms httpP50=${sample.healthRoundTripP50Ms.toFixed(2)}ms`,
  );
}

const response = measureResponsePath();

const result = {
  schemaVersion: 1,
  commit: gitHead(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  sampleCount,
  measurement: {
    daemonEntrypoint: "packages/daemon/dist/scripts/supervisor-entrypoint.js",
    warmupSampleCount,
    idleSettleMs,
    idleCpuWindowMs,
    healthWarmupRequestCount,
    healthRequestCount,
    responseIndependentProcessCount: sampleCount,
    responseWarmupTurnCount: 1,
  },
  samples,
  summary: {
    startupMs: summarize(samples.map((sample) => sample.startupMs)),
    idleRssBytes: summarize(samples.map((sample) => sample.idleRssBytes)),
    idleCpuMs: summarize(samples.map((sample) => sample.idleCpuMs)),
    healthRoundTripP50Ms: summarize(samples.map((sample) => sample.healthRoundTripP50Ms)),
    healthRoundTripP95Ms: summarize(samples.map((sample) => sample.healthRoundTripP95Ms)),
  },
  response: {
    providerDelayExcludedFromOverhead: true,
    samples: response.samples,
    summary: {
      clientToAdapterMs: summarize(response.samples.map((sample) => sample.clientToAdapterMs)),
      providerDelayMs: summarize(response.samples.map((sample) => sample.providerDelayMs)),
      adapterEventToClientMs: summarize(
        response.samples.map((sample) => sample.adapterEventToClientMs),
      ),
      localResponseOverheadMs: summarize(
        response.samples.map((sample) => sample.localResponseOverheadMs),
      ),
    },
  },
};

if (args.baseline)
  comparePerformance(result, readJson(resolve(repoRoot, args.baseline)), args.final);
if (args.write)
  writeFileSync(resolve(repoRoot, args.write), `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify(result.summary, null, 2));

function parseArgs(argv) {
  const result = { baseline: null, write: null, final: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--baseline") result.baseline = requiredValue(argv, ++index, arg);
    else if (arg === "--write") result.write = requiredValue(argv, ++index, arg);
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

async function measureDaemon(sampleNumber) {
  const thothHome = mkdtempSync(join(tmpdir(), `thoth-refactor-perf-${sampleNumber}-`));
  const port = await availablePort();
  const logs = [];
  const startedAt = performance.now();
  const child = spawn(
    process.execPath,
    [daemonEntrypoint, "--no-relay", "--no-mcp", "--no-web-ui"],
    {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NO_COLOR: "1",
        THOTH_HOME: thothHome,
        THOTH_LISTEN: `127.0.0.1:${port}`,
        THOTH_LOG_FORMAT: "json",
        THOTH_NODE_INSPECT: "0",
      },
    },
  );
  collectOutput(child.stdout, logs);
  collectOutput(child.stderr, logs);

  try {
    await waitForHealth(port, child, logs, 30_000);
    const startupMs = performance.now() - startedAt;
    await delay(idleSettleMs);
    const pids = readProcessTree(child.pid);
    const idleRssBytes = pids.reduce((total, pid) => total + readRssBytes(pid), 0);
    const cpuBefore = pids.reduce((total, pid) => total + readCpuTicks(pid), 0);
    await delay(idleCpuWindowMs);
    const remainingPids = readProcessTree(child.pid);
    const cpuAfter = remainingPids.reduce((total, pid) => total + readCpuTicks(pid), 0);
    const idleCpuMs = ((cpuAfter - cpuBefore) * 1000) / clockTicksPerSecond();
    for (let index = 0; index < healthWarmupRequestCount; index += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (!response.ok) throw new Error(`Health warmup returned ${response.status}`);
      await response.arrayBuffer();
    }
    const healthDurations = [];
    for (let index = 0; index < healthRequestCount; index += 1) {
      const requestStartedAt = performance.now();
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (!response.ok) throw new Error(`Health request returned ${response.status}`);
      await response.arrayBuffer();
      healthDurations.push(performance.now() - requestStartedAt);
    }
    return {
      startupMs,
      idleRssBytes,
      idleCpuMs,
      healthRoundTripP50Ms: percentile(healthDurations, 0.5),
      healthRoundTripP95Ms: percentile(healthDurations, 0.95),
      processCount: remainingPids.length,
    };
  } finally {
    await stopProcessGroup(child);
    rmSync(thothHome, { recursive: true, force: true });
  }
}

function collectOutput(stream, logs) {
  stream?.setEncoding("utf8");
  stream?.on("data", (chunk) => {
    logs.push(chunk);
    while (logs.length > 80) logs.shift();
  });
}

async function waitForHealth(port, child, logs, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Daemon exited with ${child.exitCode}:\n${logs.join("").slice(-8000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(25);
  }
  throw new Error(
    `Daemon health timed out: ${lastError instanceof Error ? lastError.message : String(lastError)}\n${logs.join("").slice(-8000)}`,
  );
}

async function stopProcessGroup(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await delay(1_000);
  try {
    process.kill(-child.pid, 0);
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  } catch {
    // The complete process group exited gracefully.
  }
  await Promise.race([
    new Promise((resolvePromise) => {
      if (child.exitCode !== null) resolvePromise(undefined);
      else child.once("exit", resolvePromise);
    }),
    delay(2_000),
  ]);
}

function readProcessTree(rootPid) {
  const result = [];
  const pending = [rootPid];
  const seen = new Set();
  while (pending.length > 0) {
    const pid = pending.shift();
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    if (!processExists(pid)) continue;
    result.push(pid);
    try {
      const children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(Number);
      pending.push(...children);
    } catch {
      // The process can exit between the existence check and the read.
    }
  }
  return result;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readRssBytes(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
    return match ? Number(match[1]) * 1024 : 0;
  } catch {
    return 0;
  }
}

function readCpuTicks(pid) {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, "utf8").trim().split(/\s+/);
    return Number(fields[13]) + Number(fields[14]);
  } catch {
    return 0;
  }
}

function clockTicksPerSecond() {
  return 100;
}

async function availablePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = net.createServer();
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => rejectPromise(new Error("Failed to allocate a local port")));
        return;
      }
      server.close(() => resolvePromise(address.port));
    });
  });
}

function summarize(values) {
  const median = percentile(values, 0.5);
  const deviations = values.map((value) => Math.abs(value - median));
  return {
    median,
    p95: percentile(values, 0.95),
    mad: percentile(deviations, 0.5),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}

function comparePerformance(current, baseline, finalGate) {
  const failures = [];
  if (JSON.stringify(current.measurement) !== JSON.stringify(baseline.measurement)) {
    failures.push("performance measurement contract does not match the frozen baseline");
  }
  for (const metric of [
    "startupMs",
    "idleRssBytes",
    "idleCpuMs",
    "healthRoundTripP50Ms",
    "healthRoundTripP95Ms",
  ]) {
    const before = baseline.summary[metric];
    const after = current.summary[metric];
    const noiseRatio = before.median === 0 ? 0 : (2 * before.mad) / before.median;
    const toleratedRatio = Math.max(0.03, noiseRatio);
    const candidateValues = current.samples.map((sample) => sample[metric]);
    const baselineValues = baseline.samples.map((sample) => sample[metric]);
    const oneSidedP = mannWhitneyWorsePValue(candidateValues, baselineValues);
    if (after.median > before.median && oneSidedP < 0.05) {
      failures.push(
        `${metric} is statistically worse (one-sided Mann-Whitney p=${oneSidedP.toFixed(4)})`,
      );
    }
    const exceedsNoiseFloor =
      before.median === 0
        ? after.median > before.p95 + 1000 / clockTicksPerSecond()
        : after.median > before.median * (1 + toleratedRatio);
    if (exceedsNoiseFloor) {
      failures.push(
        before.median === 0
          ? `${metric} regressed ${before.median.toFixed(2)} -> ${after.median.toFixed(2)} (zero-baseline ceiling ${(before.p95 + 1000 / clockTicksPerSecond()).toFixed(2)})`
          : `${metric} regressed ${before.median.toFixed(2)} -> ${after.median.toFixed(2)} (tolerance ${(toleratedRatio * 100).toFixed(1)}%)`,
      );
    }
  }
  for (const metric of ["clientToAdapterMs", "adapterEventToClientMs", "localResponseOverheadMs"]) {
    const before = baseline.response.summary[metric];
    const after = current.response.summary[metric];
    const noiseRatio = before.median === 0 ? 0 : (2 * before.mad) / before.median;
    const toleratedRatio = Math.max(0.03, noiseRatio);
    const candidateValues = current.response.samples.map((sample) => sample[metric]);
    const baselineValues = baseline.response.samples.map((sample) => sample[metric]);
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
  if (finalGate) {
    requireImprovement(failures, "startupMs", current, baseline, 0.4);
    requireImprovement(failures, "idleRssBytes", current, baseline, 0.3);
    requireResponseImprovement(failures, "localResponseOverheadMs", current, baseline, 0.3);
    if (
      current.response.summary.localResponseOverheadMs.p95 >
      baseline.response.summary.localResponseOverheadMs.p95
    ) {
      failures.push("localResponseOverheadMs p95 did not preserve the baseline");
    }
  }
  if (failures.length > 0)
    throw new Error(`Refactor performance contract failed:\n- ${failures.join("\n- ")}`);
}

function measureResponsePath() {
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/refactor-response-performance.ts"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    const parsed = JSON.parse(output.trim());
    if (parsed.sampleCount !== 1 || parsed.samples.length !== 1) {
      throw new Error(`Response performance probe ${index + 1} returned an invalid sample`);
    }
    samples.push(parsed.samples[0]);
    console.log(
      `[response ${index + 1}/${sampleCount}] overhead=${parsed.samples[0].localResponseOverheadMs.toFixed(2)}ms`,
    );
  }
  return { sampleCount, samples };
}

function mannWhitneyWorsePValue(candidate, baseline) {
  const candidateCount = candidate.length;
  const pooled = [
    ...candidate.map((value) => ({ value, candidate: true })),
    ...baseline.map((value) => ({ value, candidate: false })),
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
  enumerateRankSums(ranks, candidateCount, 0, 0, (rankSum) => {
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

function requireImprovement(failures, metric, current, baseline, ratio) {
  const target = baseline.summary[metric].median * (1 - ratio);
  if (current.summary[metric].median > target) {
    failures.push(
      `${metric}=${current.summary[metric].median.toFixed(2)} missed ${(ratio * 100).toFixed(0)}% target ${target.toFixed(2)}`,
    );
  }
}

function requireResponseImprovement(failures, metric, current, baseline, ratio) {
  const target = baseline.response.summary[metric].median * (1 - ratio);
  if (current.response.summary[metric].median > target) {
    failures.push(
      `${metric}=${current.response.summary[metric].median.toFixed(2)} missed ${(ratio * 100).toFixed(0)}% target ${target.toFixed(2)}`,
    );
  }
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MiB`;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
