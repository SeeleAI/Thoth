import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ClarifyAnswerPacketSchema,
  ClarifyOutputMetaSchema,
  ClarifyQuestionCardSchema,
  ClarifyRuntimePacketSchema,
  type ClarifyQuestionCard,
  type ClarifyQuestionItem,
} from "@thoth/protocol/thoth-runtime-contract";
import {
  buildClarifyProviderInputEnvelope,
  buildClarifyRepairInputPacket,
  buildClarifyTransitionInputPacket,
  isInsideGlobalProviderSkillDir,
  loadRuntimeSkillArtifact,
  mountRuntimeSkillForSession,
  validateClarifyRuntimeSkillArtifact,
} from "./contract.js";
import { type ClarifyGoldenScenario, CLARIFY_GOLDEN_SCENARIOS } from "./golden.js";
import {
  buildClarifyUserSimulationReport,
  validateClarifyUserSimulationReport,
} from "./user-simulation.js";

export interface ClarifyEvalScenarioResult {
  id: string;
  passed: boolean;
  failures: string[];
}

export interface ClarifyEvalReport {
  passed: boolean;
  scenarioCount: number;
  results: ClarifyEvalScenarioResult[];
}

function questionItems(questionCard: ClarifyQuestionCard): ClarifyQuestionItem[] {
  if ("questions" in questionCard) {
    return questionCard.questions;
  }
  return [
    {
      id: questionCard.question_id,
      question: questionCard.question,
      behavior_tree_node: questionCard.behavior_tree_node,
      selection_mode: "single",
      choices: questionCard.choices,
    },
  ];
}

function visibleQuestionText(questionCard: ClarifyQuestionCard): string {
  const questions = questionItems(questionCard);
  return [
    questionCard.title,
    questionCard.behavior_tree_node,
    ...questions.flatMap((question) => [
      question.question,
      question.behavior_tree_node,
      ...question.choices.flatMap((choice) => [choice.label, choice.description]),
      question.note ?? "",
    ]),
  ].join("\n");
}

function validateAskScenario(scenario: ClarifyGoldenScenario, failures: string[]): void {
  const contentCardParse = ClarifyQuestionCardSchema.safeParse(
    scenario.fixturePacket.content.question_card,
  );
  if (!contentCardParse.success) {
    failures.push("C_ASK content.question_card failed schema validation");
    return;
  }

  const uiCardParse = ClarifyQuestionCardSchema.safeParse(scenario.fixturePacket.ui.question_card);
  if (!uiCardParse.success) {
    failures.push("C_ASK ui.question_card failed schema validation");
    return;
  }

  const questionCard = contentCardParse.data;
  const questions = questionItems(questionCard);
  if (
    questionCard.behavior_tree_node !== scenario.expectedBehaviorTreeNode &&
    !questions.some((question) => question.behavior_tree_node === scenario.expectedBehaviorTreeNode)
  ) {
    failures.push(
      `expected behavior tree node ${scenario.expectedBehaviorTreeNode}, got ${questionCard.behavior_tree_node}`,
    );
  }
  if (
    scenario.expectedQuestionCount !== undefined &&
    questions.length !== scenario.expectedQuestionCount
  ) {
    failures.push(
      `expected ${scenario.expectedQuestionCount} card questions, got ${questions.length}`,
    );
  }

  const visibleText = visibleQuestionText(questionCard);
  for (const forbidden of scenario.forbidden) {
    if (visibleText.includes(forbidden)) {
      failures.push(`visible question contains forbidden text: ${forbidden}`);
    }
  }

  for (const question of questions) {
    if (scenario.priorTranscript?.includes(question.question)) {
      failures.push("question repeats a prior transcript question instead of advancing");
    }
  }

  const parsedMeta = ClarifyOutputMetaSchema.safeParse(scenario.fixturePacket.content.meta);
  if (!parsedMeta.success) {
    failures.push("C_ASK missing valid internal meta");
    return;
  }
  if (
    scenario.clarifyStrength &&
    scenario.clarifyStrength !== "none" &&
    parsedMeta.data.effective_clarify_strength !== scenario.clarifyStrength
  ) {
    failures.push(
      `expected effective clarify strength ${scenario.clarifyStrength}, got ${parsedMeta.data.effective_clarify_strength}`,
    );
  }
  if (parsedMeta.data.remaining_material_assumptions.length === 0) {
    failures.push("C_ASK meta must record remaining material assumptions");
  }
  if (!parsedMeta.data.question_value_reason.includes("user_must_decide")) {
    failures.push("C_ASK meta must explain why this user-owned question has value");
  }
}

function result(id: string, failures: string[]): ClarifyEvalScenarioResult {
  return {
    id,
    passed: failures.length === 0,
    failures,
  };
}

function answerHasAnyChoiceOrNote(answerPacket: ClarifyGoldenScenario["answerPacket"]): boolean {
  if (!answerPacket) {
    return false;
  }
  if ("answers" in answerPacket) {
    return (
      answerPacket.answers.some(
        (answer) => answer.choice_ids.length > 0 || Boolean(answer.note?.trim()),
      ) || Boolean(answerPacket.note?.trim())
    );
  }
  return answerPacket.choice_ids.length > 0 || Boolean(answerPacket.note?.trim());
}

function evaluateSkillArtifactChecks(): ClarifyEvalScenarioResult[] {
  const artifact = loadRuntimeSkillArtifact("thoth.clarify");
  const failures = validateClarifyRuntimeSkillArtifact(artifact);
  if (
    !/[\\/]packages[\\/]drivers[\\/](?:src|dist)[\\/]runtime-skills[\\/]thoth-clarify[\\/]SKILL\.md$/.test(
      artifact.path,
    )
  ) {
    failures.push(`unexpected skill path: ${artifact.path}`);
  }
  if (artifact.source.includes("allowed-tools:")) {
    failures.push("SKILL.md must not contain Codex-only allowed-tools metadata");
  }
  return [result("packaged-runtime-skill-authority", failures)];
}

function evaluateMountChecks(): ClarifyEvalScenarioResult[] {
  const tempRoot = mkdtempSync(join(tmpdir(), "thoth-clarify-eval-"));
  try {
    const fakeHome = join(tempRoot, "fake-home");
    const mount = mountRuntimeSkillForSession({
      thothSessionHome: join(tempRoot, "thoth-runtime-home"),
      sessionId: "sec_eval",
      home: fakeHome,
    });

    const globalInstallFailures: string[] = [];
    for (const globalPath of [
      join(fakeHome, ".codex/skills/thoth-clarify/SKILL.md"),
      join(fakeHome, ".claude/skills/thoth-clarify/SKILL.md"),
      join(fakeHome, ".agents/skills/thoth-clarify/SKILL.md"),
    ]) {
      if (globalPath === mount.mountedPath) {
        globalInstallFailures.push(`mounted into global skill path: ${globalPath}`);
      }
    }

    const visibleFailures: string[] = [];
    if (
      !mount.mountedPath.endsWith(
        join("provider-sessions", "sec_eval", "skills", "thoth-clarify", "SKILL.md"),
      )
    ) {
      visibleFailures.push(`unexpected session mount path: ${mount.mountedPath}`);
    }
    if (mount.skillRef.id !== "thoth.clarify") {
      visibleFailures.push("mounted skill ref id mismatch");
    }

    const bareFailures: string[] = [];
    if (isInsideGlobalProviderSkillDir(mount.mountedPath, fakeHome)) {
      bareFailures.push("bare provider skill home can see mounted thoth.clarify");
    }

    return [
      result("skill-not-global-installed", globalInstallFailures),
      result("session-scoped-skill-visible", visibleFailures),
      result("bare-provider-skill-invisible", bareFailures),
    ];
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function evaluateRuntimeInputPacketChecks(): ClarifyEvalScenarioResult[] {
  const normalEnvelope = buildClarifyProviderInputEnvelope({
    sessionId: "sec_eval",
    taskId: null,
    currentState: "C_ASK",
    userInput: "继续",
    clarify: "balanced",
    mode: "loop",
    loop: "balanced",
    transcriptRef: "transcript:sec_eval:v4",
    assumptionLedgerRef: "assumptions:sec_eval:v4",
    decisionTreeFrontierRef: "frontier:sec_eval:v4",
    contextSummary: "workspace facts already discovered",
  });
  const normalInput = JSON.parse(normalEnvelope.input) as Record<string, unknown>;
  const normalFailures: string[] = [];
  if (normalInput.type !== "clarify_turn") {
    normalFailures.push("normal turn must use clarify_turn packet");
  }
  if ("skill_ref" in normalInput) {
    normalFailures.push("normal same-state turn must not include skill_ref");
  }
  if (
    !normalInput.controls ||
    typeof normalInput.controls !== "object" ||
    (normalInput.controls as { clarify_strength?: unknown }).clarify_strength !== "balanced" ||
    (normalInput.controls as { effective_clarify_strength?: unknown })
      .effective_clarify_strength !== "balanced"
  ) {
    normalFailures.push("normal turn must carry clarify controls with effective strength");
  }
  if (normalInput.assumption_ledger_ref !== "assumptions:sec_eval:v4") {
    normalFailures.push("normal turn must carry assumption ledger ref");
  }
  if (normalInput.decision_tree_frontier_ref !== "frontier:sec_eval:v4") {
    normalFailures.push("normal turn must carry decision tree frontier ref");
  }
  if (
    normalEnvelope.input.includes("## State Codes") ||
    normalEnvelope.input.includes("## Transition Rules")
  ) {
    normalFailures.push("normal turn repeated full Skill rules");
  }

  const transition = buildClarifyTransitionInputPacket({
    sessionId: "sec_eval",
    from: "C_ASK",
    to: "C_TASK_CARD",
    userInput: "按刚才说的注册后台任务",
    transcriptRef: "transcript:sec_eval:v5",
    clarify: "dive",
    mode: "loop",
    loop: "balanced",
    controlsChanged: {
      clarify_strength_from: "balanced",
      clarify_strength_to: "dive",
      reason: "user changed clarify strength",
    },
  });
  const transitionFailures: string[] = [];
  if (transition.basis !== "according_to_loaded_skill") {
    transitionFailures.push("transition packet must carry according_to_loaded_skill basis");
  }
  if (!transition.skill_ref.digest.startsWith("sha256:")) {
    transitionFailures.push("transition packet must carry skill digest");
  }
  if (transition.controls.effective_clarify_strength !== "dive") {
    transitionFailures.push("transition packet must carry effective clarify strength");
  }
  if (transition.controls_changed?.clarify_strength_to !== "dive") {
    transitionFailures.push("transition packet must carry controls_changed for strength changes");
  }
  const transitionJson = JSON.stringify(transition);
  if (transitionJson.includes("## State Codes") || transitionJson.includes("## Question Rules")) {
    transitionFailures.push("transition packet repeated full Skill rules");
  }

  const repair = buildClarifyRepairInputPacket({
    sessionId: "sec_eval",
    previousState: "C_ASK",
    intendedOutputState: "C_ASK",
    badOutput: "{}",
    schemaErrors: ["C_ASK packets must include content.question_card"],
    clarify: "balanced",
    mode: "loop",
    loop: "balanced",
  });
  const repairFailures: string[] = [];
  if (!repair.repair_instruction.includes("repair packet shape only")) {
    repairFailures.push("repair packet must restrict repair to packet shape");
  }
  if (!repair.repair_instruction.includes("do not reinterpret user intent")) {
    repairFailures.push("repair packet must forbid semantic reinterpretation");
  }

  return [
    result("normal-turn-does-not-repeat-skill-rules", normalFailures),
    result("transition-turn-carries-skill-reference", transitionFailures),
    result("repair-packet-shape-only", repairFailures),
  ];
}

function evaluateSkillRulesLiveInSkillMd(): ClarifyEvalScenarioResult {
  const artifact = loadRuntimeSkillArtifact("thoth.clarify");
  const required = [
    "## Role",
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
    "frontier_ledger",
    "decision_delta",
    "remaining material user-owned assumptions",
    "user_must_decide",
    "agent_can_discover",
  ];
  const failures = required
    .filter((phrase) => !artifact.source.includes(phrase))
    .map((phrase) => `SKILL.md missing ${phrase}`);
  return result("skill-rules-live-in-skill-md", failures);
}

function findRepoRoot(): string {
  for (const candidate of [process.cwd(), resolve(process.cwd(), "../..")]) {
    const packageJsonPath = resolve(candidate, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
    if (packageJson.name === "thoth") {
      return candidate;
    }
  }
  return process.cwd();
}

function evaluateCodexExecUserSimulationContract(): ClarifyEvalScenarioResult {
  const report = buildClarifyUserSimulationReport();
  const validation = validateClarifyUserSimulationReport(report);
  const failures = [...validation.failures];
  const repoRoot = findRepoRoot();
  const scriptPath = resolve(repoRoot, "scripts/judge-clarify-user-simulation.mjs");
  if (!existsSync(scriptPath)) {
    failures.push("missing scripts/judge-clarify-user-simulation.mjs");
  }

  const packageJsonPath = resolve(repoRoot, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    if (
      !packageJson.scripts?.["judge:clarify:user-simulation"]?.includes(
        "scripts/judge-clarify-user-simulation.mjs",
      )
    ) {
      failures.push("missing root judge:clarify:user-simulation script");
    }
  } else {
    failures.push("missing root package.json");
  }

  return result("codex-exec-user-simulation", failures);
}

function evaluateClarifyStrengthBehaviorChecks(
  scenarios: readonly ClarifyGoldenScenario[],
): ClarifyEvalScenarioResult {
  const failures: string[] = [];
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const none = byId.get("strength-none-pathtracing");
  const light = byId.get("strength-light-pathtracing");
  const balanced = byId.get("strength-balanced-pathtracing");
  const dive = byId.get("strength-dive-pathtracing");
  if (!none || !light || !balanced || !dive) {
    failures.push("missing all four clarify strength PathTracing scenarios");
    return result("clarify-strength-behavior-differs", failures);
  }
  if (none.fixturePacket.code !== "C_DIRECT") {
    failures.push("strength none must stay direct for non-blocked PathTracing prompt");
  }

  const askScenarios = [
    ["light", light, 2],
    ["balanced", balanced, 3],
    ["dive", dive, 4],
  ] as const;
  for (const [strength, scenario, expectedQuestionCount] of askScenarios) {
    if (scenario.fixturePacket.code !== "C_ASK") {
      failures.push(
        `strength ${strength} must ask instead of using ${scenario.fixturePacket.code}`,
      );
      continue;
    }
    const parsedCard = ClarifyQuestionCardSchema.safeParse(
      scenario.fixturePacket.content.question_card,
    );
    const parsedMeta = ClarifyOutputMetaSchema.safeParse(scenario.fixturePacket.content.meta);
    if (!parsedCard.success || !parsedMeta.success) {
      failures.push(`strength ${strength} must have valid question card and meta`);
      continue;
    }
    const questions = questionItems(parsedCard.data);
    if (questions.length !== expectedQuestionCount) {
      failures.push(
        `strength ${strength} expected ${expectedQuestionCount} questions, got ${questions.length}`,
      );
    }
    if (parsedMeta.data.effective_clarify_strength !== strength) {
      failures.push(
        `strength ${strength} meta mismatch: ${parsedMeta.data.effective_clarify_strength}`,
      );
    }
  }

  const diveMeta = ClarifyOutputMetaSchema.safeParse(dive.fixturePacket.content.meta);
  if (diveMeta.success) {
    const owners = new Set(
      diveMeta.data.remaining_material_assumptions.map((assumption) => assumption.owner),
    );
    for (const owner of ["user_must_decide", "agent_can_decide", "agent_can_discover"] as const) {
      if (!owners.has(owner)) {
        failures.push(`dive scenario missing assumption owner ${owner}`);
      }
    }
  }

  return result("clarify-strength-behavior-differs", failures);
}

function validateDirectScenario(scenario: ClarifyGoldenScenario, failures: string[]): void {
  const visible = String(
    scenario.fixturePacket.content.message ?? scenario.fixturePacket.ui.text ?? "",
  );
  for (const forbidden of scenario.forbidden) {
    if (visible.includes(forbidden)) {
      failures.push(`direct response contains forbidden text: ${forbidden}`);
    }
  }
}

function validateBlockedScenario(scenario: ClarifyGoldenScenario, failures: string[]): void {
  const visible = String(
    scenario.fixturePacket.content.message ?? scenario.fixturePacket.ui.text ?? "",
  );
  for (const forbidden of scenario.forbidden) {
    if (visible.includes(forbidden)) {
      failures.push(`blocked response contains forbidden text: ${forbidden}`);
    }
  }
  if (!visible) {
    failures.push("C_BLOCKED must explain why the secretary cannot proceed");
  }
}

function validateTaskCardScenario(scenario: ClarifyGoldenScenario, failures: string[]): void {
  const provenance = scenario.fixturePacket.content.provenance as
    | { clarify_transcript_verbatim?: unknown }
    | undefined;
  if (typeof provenance?.clarify_transcript_verbatim !== "string") {
    failures.push("C_TASK_CARD missing clarify_transcript_verbatim");
    return;
  }
  if (
    scenario.priorTranscript &&
    provenance.clarify_transcript_verbatim !== scenario.priorTranscript
  ) {
    failures.push("C_TASK_CARD transcript provenance does not match prior transcript verbatim");
  }
}

function validateGoalCardScenario(scenario: ClarifyGoldenScenario, failures: string[]): void {
  const provenance = scenario.fixturePacket.content.provenance as
    | {
        clarify_transcript_verbatim?: unknown;
        approved_ceo_task_card_verbatim?: unknown;
      }
    | undefined;
  if (typeof provenance?.clarify_transcript_verbatim !== "string") {
    failures.push("C_GOAL_CARD missing clarify_transcript_verbatim");
  }
  if (typeof provenance?.approved_ceo_task_card_verbatim !== "string") {
    failures.push("C_GOAL_CARD missing approved_ceo_task_card_verbatim");
  }
  if (
    scenario.priorTranscript &&
    provenance?.clarify_transcript_verbatim !== scenario.priorTranscript
  ) {
    failures.push("C_GOAL_CARD transcript provenance does not match prior transcript verbatim");
  }
}

export function evaluateClarifyGoldenScenario(
  scenario: ClarifyGoldenScenario,
): ClarifyEvalScenarioResult {
  const failures: string[] = [];
  const parsedPacket = ClarifyRuntimePacketSchema.safeParse(scenario.fixturePacket);
  if (!parsedPacket.success) {
    failures.push(
      `packet schema failed: ${parsedPacket.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  if (scenario.fixturePacket.code !== scenario.expectedCode) {
    failures.push(`expected code ${scenario.expectedCode}, got ${scenario.fixturePacket.code}`);
  }

  if (scenario.answerPacket) {
    const parsedAnswer = ClarifyAnswerPacketSchema.safeParse(scenario.answerPacket);
    if (!parsedAnswer.success) {
      failures.push("answer packet failed schema validation");
    }
    if (!answerHasAnyChoiceOrNote(scenario.answerPacket)) {
      failures.push("note-only answer packet must preserve freeform note");
    }
  }

  if (scenario.fixturePacket.code === "C_ASK") {
    validateAskScenario(scenario, failures);
  }
  if (scenario.fixturePacket.code === "C_DIRECT") {
    validateDirectScenario(scenario, failures);
  }
  if (scenario.fixturePacket.code === "C_BLOCKED") {
    validateBlockedScenario(scenario, failures);
  }
  if (scenario.fixturePacket.code === "C_TASK_CARD") {
    validateTaskCardScenario(scenario, failures);
  }
  if (scenario.fixturePacket.code === "C_GOAL_CARD") {
    validateGoalCardScenario(scenario, failures);
  }

  return {
    id: scenario.id,
    passed: failures.length === 0,
    failures,
  };
}

export function evaluateClarifyGoldenDataset(
  scenarios: readonly ClarifyGoldenScenario[] = CLARIFY_GOLDEN_SCENARIOS,
): ClarifyEvalReport {
  const results = [
    ...scenarios.map((scenario) => evaluateClarifyGoldenScenario(scenario)),
    ...evaluateSkillArtifactChecks(),
    ...evaluateMountChecks(),
    ...evaluateRuntimeInputPacketChecks(),
    evaluateSkillRulesLiveInSkillMd(),
    evaluateClarifyStrengthBehaviorChecks(scenarios),
    evaluateCodexExecUserSimulationContract(),
  ];
  return {
    passed: results.every((result) => result.passed),
    scenarioCount: results.length,
    results,
  };
}

function printReport(report: ClarifyEvalReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Clarify golden eval: ${report.passed ? "PASS" : "FAIL"}`);
  console.log(`Scenarios: ${report.scenarioCount}`);
  for (const result of report.results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id}`);
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const json = process.argv.includes("--json");
  const report = evaluateClarifyGoldenDataset();
  printReport(report, json);
  if (!report.passed) {
    process.exitCode = 1;
  }
}
