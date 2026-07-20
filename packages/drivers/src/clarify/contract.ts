import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClarifyProviderRuntimeInputPacketSchema,
  ClarifyRepairInputPacketSchema,
  ClarifySessionStartInputPacketSchema,
  ClarifyTransitionInputPacketSchema,
  ClarifyTurnInputPacketSchema,
  type ClarifyControlsChanged,
  type ClarifyInputControls,
  type ClarifyProviderRuntimeInputPacket,
  type ClarifyRepairInputPacket,
  type ClarifyRuntimeCode,
  type ClarifySessionStartInputPacket,
  type ClarifyTransitionInputPacket,
  type ClarifyTurnInputPacket,
  type ThothProviderInputEnvelope,
  type ThothRuntimeClarifyStrength,
  type ThothRuntimeSkillRef,
  ThothProviderInputEnvelopeSchema,
} from "@thoth/protocol/thoth-runtime-contract";

export const CLARIFY_SKILL_ID = "thoth.clarify" as const;
export const CLARIFY_SKILL_FOLDER = "thoth-clarify" as const;
export const LOOP_SKILL_ID = "thoth.loop" as const;
export const LOOP_SKILL_FOLDER = "thoth-loop" as const;

const GLOBAL_PROVIDER_SKILL_DIR_SUFFIXES = [
  ".codex/skills",
  ".claude/skills",
  ".agents/skills",
] as const;

export interface RuntimeSkillFrontmatter {
  name: string;
  description: string;
  userInvocable?: boolean;
  xThothRuntime?: string;
  xThothRequired?: boolean;
  xThothScope?: string;
  xThothStatus?: string;
}

export interface RuntimeSkillArtifact {
  id: "thoth.clarify" | "thoth.loop";
  folderName: string;
  path: string;
  source: string;
  body: string;
  frontmatter: RuntimeSkillFrontmatter;
  digest: `sha256:${string}`;
}

export interface RuntimeSkillMount {
  skillRef: ThothRuntimeSkillRef;
  sourcePath: string;
  mountedPath: string;
  sessionSkillHome: string;
}

export interface BuildClarifyProviderInputOptions {
  sessionId: string;
  taskId?: string | null;
  currentState: ClarifyRuntimeCode;
  userInput: string;
  clarify: ThothRuntimeClarifyStrength;
  effectiveClarify?: ThothRuntimeClarifyStrength;
  mode: "quick" | "loop";
  loop: null | "auto" | "one_plan_one_do" | "light" | "balanced" | "run_until_stopped";
  transcriptRef: string;
  assumptionLedgerRef?: string;
  decisionTreeFrontierRef?: string;
  contextSummary?: string;
  taskCardProvenanceRef?: string;
  inputPacket?: ClarifyProviderRuntimeInputPacket;
  inject?: "none" | "state_refresh" | "full";
  turnPhase?: "clarify" | "approval_task" | "approval_breakdown" | "quick_exec" | "repair";
}

export interface BuildClarifyTransitionInputOptions {
  sessionId: string;
  from: ClarifyRuntimeCode;
  to: ClarifyRuntimeCode;
  userInput: string;
  clarify?: ThothRuntimeClarifyStrength;
  effectiveClarify?: ThothRuntimeClarifyStrength;
  mode?: "quick" | "loop";
  loop?: null | "auto" | "one_plan_one_do" | "light" | "balanced" | "run_until_stopped";
  transcriptRef: string;
  assumptionLedgerRef?: string;
  decisionTreeFrontierRef?: string;
  contextSummary?: string;
  controlsChanged?: ClarifyControlsChanged;
  skillRef?: ThothRuntimeSkillRef;
}

export interface BuildClarifySessionStartInputOptions {
  sessionId: string;
  currentState: ClarifyRuntimeCode;
  userInput: string;
  clarify?: ThothRuntimeClarifyStrength;
  effectiveClarify?: ThothRuntimeClarifyStrength;
  mode?: "quick" | "loop";
  loop?: null | "auto" | "one_plan_one_do" | "light" | "balanced" | "run_until_stopped";
  transcriptRef?: string;
  assumptionLedgerRef?: string;
  decisionTreeFrontierRef?: string;
  contextSummary?: string;
  skillRef?: ThothRuntimeSkillRef;
}

export interface BuildClarifyRepairInputOptions {
  sessionId: string;
  previousState: ClarifyRuntimeCode;
  intendedOutputState: ClarifyRuntimeCode;
  clarify?: ThothRuntimeClarifyStrength;
  effectiveClarify?: ThothRuntimeClarifyStrength;
  mode?: "quick" | "loop";
  loop?: null | "auto" | "one_plan_one_do" | "light" | "balanced" | "run_until_stopped";
  badOutput: string;
  schemaErrors: string[];
  transitionErrors?: string[];
  skillRef?: ThothRuntimeSkillRef;
}

export function normalizeClarifyStrength(
  strength: ThothRuntimeClarifyStrength,
): ThothRuntimeClarifyStrength {
  return strength === "deep" ? "dive" : strength;
}

function buildClarifyInputControls(options: {
  clarify?: ThothRuntimeClarifyStrength;
  effectiveClarify?: ThothRuntimeClarifyStrength;
  mode?: "quick" | "loop";
  loop?: null | "auto" | "one_plan_one_do" | "light" | "balanced" | "run_until_stopped";
}): ClarifyInputControls {
  const clarify = options.clarify ?? "none";
  return {
    mode: options.mode ?? "quick",
    clarify_strength: clarify,
    effective_clarify_strength: options.effectiveClarify ?? normalizeClarifyStrength(clarify),
    loop: options.loop ?? null,
  };
}

function runtimeSkillRootCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    resolve(here, "../runtime-skills"),
    resolve(here, "../../src/runtime-skills"),
    resolve(process.cwd(), "packages/drivers/src/runtime-skills"),
  ];
}

export function getRuntimeSkillPath(folderName: string): string {
  for (const root of runtimeSkillRootCandidates()) {
    const candidate = join(root, folderName, "SKILL.md");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Runtime skill artifact not found: ${folderName}/SKILL.md`);
}

function parseScalar(value: string): string | boolean {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

export function parseRuntimeSkillFrontmatter(source: string): {
  frontmatter: RuntimeSkillFrontmatter;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) {
    throw new Error("Runtime skill must start with YAML frontmatter");
  }

  const raw: Record<string, string | boolean> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    raw[key] = parseScalar(value);
  }

  const name = raw.name;
  const description = raw.description;
  if (typeof name !== "string" || !name) {
    throw new Error("Runtime skill frontmatter must include name");
  }
  if (typeof description !== "string" || !description) {
    throw new Error("Runtime skill frontmatter must include description");
  }

  return {
    frontmatter: {
      name,
      description,
      userInvocable: raw["user-invocable"] as boolean | undefined,
      xThothRuntime: raw["x-thoth-runtime"] as string | undefined,
      xThothRequired: raw["x-thoth-required"] as boolean | undefined,
      xThothScope: raw["x-thoth-scope"] as string | undefined,
      xThothStatus: raw["x-thoth-status"] as string | undefined,
    },
    body: match[2],
  };
}

function digestSkillSource(source: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

export function loadRuntimeSkillArtifact(
  id: "thoth.clarify" | "thoth.loop" = CLARIFY_SKILL_ID,
): RuntimeSkillArtifact {
  const folderName = id === CLARIFY_SKILL_ID ? CLARIFY_SKILL_FOLDER : LOOP_SKILL_FOLDER;
  const path = getRuntimeSkillPath(folderName);
  const source = readFileSync(path, "utf8");
  const parsed = parseRuntimeSkillFrontmatter(source);
  if (parsed.frontmatter.name !== id) {
    throw new Error(`Runtime skill name mismatch: expected ${id}, got ${parsed.frontmatter.name}`);
  }
  return {
    id,
    folderName,
    path,
    source,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    digest: digestSkillSource(source),
  };
}

export function validateClarifyRuntimeSkillArtifact(
  artifact: RuntimeSkillArtifact = loadRuntimeSkillArtifact(CLARIFY_SKILL_ID),
): string[] {
  const failures: string[] = [];
  const requiredPhrases = [
    "## Runtime Tools",
    "## Runtime Context",
    "## Clarify Strength",
    "## Assumption Ownership",
    "## Clarify Cards",
    "## Task Card",
    "## Goals Card",
    "## Transition Rules",
    "## Loop And Quick Handoff",
    "## Repair",
    "thoth_submit_clarify_card",
    "thoth_submit_task_card",
    "thoth_submit_goals_card",
    "thoth_report_blocked",
    "current_state",
    "frontier_ledger",
    "public_badge_summary",
    "remaining material user-owned assumptions",
    "decision_delta",
    "selection_mode",
    "user_must_decide",
    "agent_can_decide",
    "agent_can_discover",
    "standard_answer",
    "2-4 choices",
    "Do not require Thoth to paste the skill body into each user prompt",
  ];

  if (artifact.frontmatter.userInvocable !== false) {
    failures.push("frontmatter must set user-invocable: false");
  }
  if (artifact.frontmatter.xThothRuntime !== "hidden") {
    failures.push("frontmatter must set x-thoth-runtime: hidden");
  }
  if (artifact.frontmatter.xThothRequired !== true) {
    failures.push("frontmatter must set x-thoth-required: true");
  }
  if (artifact.frontmatter.xThothScope !== "provider-session") {
    failures.push("frontmatter must set x-thoth-scope: provider-session");
  }
  if (artifact.source.includes("allowed-tools:") || artifact.source.includes("agents/openai")) {
    failures.push("runtime skill must not depend on Codex-only metadata");
  }
  const lowerSource = artifact.source.toLowerCase();
  for (const phrase of requiredPhrases) {
    if (!lowerSource.includes(phrase.toLowerCase())) {
      failures.push(`SKILL.md missing required phrase: ${phrase}`);
    }
  }
  return failures;
}

export function getGlobalProviderSkillDirs(home: string = process.env.HOME ?? ""): string[] {
  if (!home) {
    return [];
  }
  return GLOBAL_PROVIDER_SKILL_DIR_SUFFIXES.map((suffix) => resolve(home, suffix));
}

export function isInsideGlobalProviderSkillDir(
  targetPath: string,
  home: string = process.env.HOME ?? "",
): boolean {
  const resolvedTarget = resolve(targetPath);
  return getGlobalProviderSkillDirs(home).some((globalDir) => {
    const resolvedGlobal = resolve(globalDir);
    const relativeTarget = relative(resolvedGlobal, resolvedTarget);
    return (
      relativeTarget === "" ||
      (relativeTarget !== ".." &&
        !relativeTarget.startsWith(`..${sep}`) &&
        !isAbsolute(relativeTarget))
    );
  });
}

export function mountRuntimeSkillForSession(options: {
  artifact?: RuntimeSkillArtifact;
  thothSessionHome: string;
  sessionId: string;
  home?: string;
}): RuntimeSkillMount {
  const artifact = options.artifact ?? loadRuntimeSkillArtifact(CLARIFY_SKILL_ID);
  const sessionSkillHome = resolve(
    options.thothSessionHome,
    "provider-sessions",
    options.sessionId,
    "skills",
  );
  if (isInsideGlobalProviderSkillDir(sessionSkillHome, options.home)) {
    throw new Error("Refusing to mount a Thoth runtime skill inside a global provider skill dir");
  }

  const mountedDir = join(sessionSkillHome, artifact.folderName);
  const mountedPath = join(mountedDir, "SKILL.md");
  rmSync(mountedDir, { recursive: true, force: true });
  mkdirSync(mountedDir, { recursive: true });
  writeFileSync(mountedPath, artifact.source);

  return {
    skillRef: {
      id: artifact.id,
      digest: artifact.digest,
    },
    sourcePath: artifact.path,
    mountedPath,
    sessionSkillHome,
  };
}

export function buildClarifyTurnInputPacket(
  options: BuildClarifyProviderInputOptions,
): ClarifyTurnInputPacket {
  return ClarifyTurnInputPacketSchema.parse({
    type: "clarify_turn",
    session_id: options.sessionId,
    current_state: options.currentState,
    controls: buildClarifyInputControls(options),
    user_input: options.userInput,
    transcript_ref: options.transcriptRef,
    assumption_ledger_ref: options.assumptionLedgerRef,
    decision_tree_frontier_ref: options.decisionTreeFrontierRef,
    context_summary: options.contextSummary,
    task_card_provenance_ref: options.taskCardProvenanceRef,
  });
}

export function buildClarifySessionStartInputPacket(
  options: BuildClarifySessionStartInputOptions,
): ClarifySessionStartInputPacket {
  const skillRef = options.skillRef ?? {
    id: CLARIFY_SKILL_ID,
    digest: loadRuntimeSkillArtifact(CLARIFY_SKILL_ID).digest,
  };
  return ClarifySessionStartInputPacketSchema.parse({
    type: "clarify_session_start",
    session_id: options.sessionId,
    skill_ref: skillRef,
    current_state: options.currentState,
    controls: buildClarifyInputControls(options),
    user_input: options.userInput,
    transcript_ref: options.transcriptRef,
    assumption_ledger_ref: options.assumptionLedgerRef,
    decision_tree_frontier_ref: options.decisionTreeFrontierRef,
    context_summary: options.contextSummary,
    basis: "session_scoped_skill_loaded",
  });
}

export function buildClarifyTransitionInputPacket(
  options: BuildClarifyTransitionInputOptions,
): ClarifyTransitionInputPacket {
  const skillRef = options.skillRef ?? {
    id: CLARIFY_SKILL_ID,
    digest: loadRuntimeSkillArtifact(CLARIFY_SKILL_ID).digest,
  };
  return ClarifyTransitionInputPacketSchema.parse({
    type: "clarify_transition",
    session_id: options.sessionId,
    skill_ref: skillRef,
    from: options.from,
    to: options.to,
    basis: "according_to_loaded_skill",
    controls: buildClarifyInputControls(options),
    controls_changed: options.controlsChanged,
    transcript_ref: options.transcriptRef,
    assumption_ledger_ref: options.assumptionLedgerRef,
    decision_tree_frontier_ref: options.decisionTreeFrontierRef,
    user_input: options.userInput,
    context_summary: options.contextSummary,
  });
}

export function buildClarifyRepairInputPacket(
  options: BuildClarifyRepairInputOptions,
): ClarifyRepairInputPacket {
  const skillRef = options.skillRef ?? {
    id: CLARIFY_SKILL_ID,
    digest: loadRuntimeSkillArtifact(CLARIFY_SKILL_ID).digest,
  };
  return ClarifyRepairInputPacketSchema.parse({
    type: "clarify_repair",
    session_id: options.sessionId,
    skill_ref: skillRef,
    previous_state: options.previousState,
    intended_output_state: options.intendedOutputState,
    controls: buildClarifyInputControls(options),
    bad_output: options.badOutput,
    schema_errors: options.schemaErrors,
    transition_errors: options.transitionErrors ?? [],
    repair_instruction:
      "repair packet shape only; do not reinterpret user intent; do not change transcript; do not fabricate transcript; do not change approved CEO Task Card; do not downgrade target",
  });
}

export function composeClarifyProviderInput(options: BuildClarifyProviderInputOptions): string {
  const packet = options.inputPacket ?? buildClarifyTurnInputPacket(options);
  return JSON.stringify(ClarifyProviderRuntimeInputPacketSchema.parse(packet));
}

export function buildClarifyProviderInputEnvelope(
  options: BuildClarifyProviderInputOptions,
): ThothProviderInputEnvelope {
  return ThothProviderInputEnvelopeSchema.parse({
    type: "provider_input",
    skill: CLARIFY_SKILL_ID,
    session_id: options.sessionId,
    task_id: options.taskId ?? null,
    code: options.currentState,
    controls: {
      mode: options.mode,
      clarify: options.clarify,
      loop: options.loop,
    },
    turn_phase: options.turnPhase ?? "clarify",
    input: composeClarifyProviderInput(options),
    inject: options.inject ?? "none",
    expect: "clarify",
  });
}
