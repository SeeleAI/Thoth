import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLARIFY_SKILL_ID = "thoth.clarify" as const;
export const CLARIFY_SKILL_FOLDER = "thoth-clarify" as const;
export const LOOP_SKILL_ID = "thoth.loop" as const;
export const LOOP_SKILL_FOLDER = "thoth-loop" as const;

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
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Runtime skill artifact not found: ${folderName}/SKILL.md`);
}

function parseScalar(value: string): string | boolean {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed.replace(/^["']|["']$/g, "");
}

export function parseRuntimeSkillFrontmatter(source: string): {
  frontmatter: RuntimeSkillFrontmatter;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error("Runtime skill must start with YAML frontmatter");

  const raw: Record<string, string | boolean> = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    raw[line.slice(0, separator).trim()] = parseScalar(line.slice(separator + 1));
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
    digest: `sha256:${createHash("sha256").update(source).digest("hex")}`,
  };
}

const COMMON_REQUIRED_PHRASES = ["## Runtime Tools", "provider session", "Do not expose"];

const CLARIFY_REQUIRED_PHRASES = [
  "Decision Map",
  "GROUND -> EXPAND_MAP -> AUTO_RESOLVE",
  "thoth_clarify_update_map",
  "thoth_clarify_ask",
  "thoth_clarify_propose_contract",
  "thoth_clarify_report_blocked",
  "Human-owned",
  "Evidence-owned",
  "Agent-owned",
  "one-shot Challenger",
  "Intent Contract",
  "no question-count cap",
];

const LOOP_REQUIRED_PHRASES = [
  "Task Anchor",
  "Working Set",
  "Work Unit",
  "fresh Review",
  "thoth_loop_checkpoint",
  "thoth_loop_review_decision",
  "thoth_loop_request_human_decision",
  "thoth_loop_report_blocked",
  "context pressure",
  "read-only",
];

export function validateRuntimeSkillArtifact(artifact: RuntimeSkillArtifact): string[] {
  const failures: string[] = [];
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
    failures.push("runtime skill must remain provider-neutral");
  }
  const required = [
    ...COMMON_REQUIRED_PHRASES,
    ...(artifact.id === CLARIFY_SKILL_ID ? CLARIFY_REQUIRED_PHRASES : LOOP_REQUIRED_PHRASES),
  ];
  for (const phrase of required) {
    if (!artifact.source.toLowerCase().includes(phrase.toLowerCase())) {
      failures.push(`SKILL.md missing required phrase: ${phrase}`);
    }
  }
  return failures;
}

export function validateClarifyRuntimeSkillArtifact(
  artifact: RuntimeSkillArtifact = loadRuntimeSkillArtifact(CLARIFY_SKILL_ID),
): string[] {
  if (artifact.id !== CLARIFY_SKILL_ID) return ["expected thoth.clarify artifact"];
  return validateRuntimeSkillArtifact(artifact);
}

export function validateLoopRuntimeSkillArtifact(
  artifact: RuntimeSkillArtifact = loadRuntimeSkillArtifact(LOOP_SKILL_ID),
): string[] {
  if (artifact.id !== LOOP_SKILL_ID) return ["expected thoth.loop artifact"];
  return validateRuntimeSkillArtifact(artifact);
}
