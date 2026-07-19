#!/usr/bin/env node

import fs from "node:fs";

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.100.0\n");
  process.exit(0);
}

const capturePath = process.env.THOTH_FAKE_CODEX_CAPTURE;
const statePath = process.env.THOTH_FAKE_CODEX_STATE;
if (!capturePath || !statePath) {
  process.stderr.write("THOTH_FAKE_CODEX_CAPTURE and THOTH_FAKE_CODEX_STATE are required\n");
  process.exit(2);
}

const threadId = `scripted-thread-${process.pid}`;
let dynamicToolNames = [];
let buffer = "";
let turnOrdinal = 0;
let nextServerRequestId = 1_000_000 + process.pid * 100;
const pendingServerRequests = new Map();

const clarifyCard = {
  title: "Packaged flow authority",
  why_now: "Verify the installed runtime tool bridge with fixed answers.",
  public_badge_summary: "The packaged flow is waiting for its prescribed answers.",
  frontier_ledger: {
    clarify_strength: "light",
    grounded_user_decisions: ["This is a deterministic packaged transport test."],
    remaining_material_user_owned_assumptions: [],
    agent_owned_assumptions: ["No workspace mutation is required."],
    discoverable_assumptions: [],
    why_this_round: "Verify the installed authority lifecycle without model improvisation.",
    convergence_state: "ready_for_task",
  },
  decision_delta: {
    affected_contract_fields: ["goal", "acceptance"],
    safe_if_unanswered: "Stop at this authority card.",
    eliminated_routes: ["Unscripted provider behavior"],
    irreversible_or_cost_impact: "No workspace mutation is allowed.",
    downstream_refs: ["task_card.goal", "task_card.acceptance"],
  },
  questions: [
    {
      id: "packaged-scope",
      question: "Use the fixed packaged scope?",
      behavior_tree_node: "packaged_scope",
      selection_mode: "single",
      choices: [
        { id: "scope-yes", label: "Use scope", description: "Continue fixed flow" },
        { id: "scope-no", label: "Stop flow", description: "Exercise cancel path" },
      ],
    },
    {
      id: "packaged-evidence",
      question: "Use the fixed packaged evidence?",
      behavior_tree_node: "packaged_evidence",
      selection_mode: "single",
      choices: [
        { id: "evidence-yes", label: "Use evidence", description: "Record fixed evidence" },
        { id: "evidence-no", label: "Reject evidence", description: "Exercise alternate path" },
      ],
    },
  ],
  allow_choice_notes: true,
  allow_note_only: true,
};

const taskCard = {
  task_card: {
    title: "Packaged foreground and Loop flow",
    goal: "Verify installed Clarify, Quick and background Loop authority.",
    constraints: ["Do not modify workspace files.", "Use only fixed fixture values."],
    acceptance: ["The packaged daemon completes every prescribed phase."],
  },
  provenance: {
    clarify_transcript_verbatim: "The fixed packaged answer was submitted through the card.",
  },
  convergence_review: {
    frontier_ledger: {
      clarify_strength: "light",
      grounded_user_decisions: ["The fixed packaged answer was submitted."],
      remaining_material_user_owned_assumptions: [],
      agent_owned_assumptions: ["No implementation decision remains."],
      discoverable_assumptions: [],
      why_this_round: "Every prescribed authority answer is available.",
      convergence_state: "ready_for_task",
    },
    why_task_is_now_grounded: "The deterministic packaged contract is complete.",
  },
};

const goalsCard = {
  goals_card: {
    title: "Packaged linear goals",
    summary: "Two checkpoints verify retry and linear advancement.",
    goals_count_rationale: "The transport smoke intentionally uses two atomic goals.",
    goals: [
      {
        id: "packaged-goal-1",
        order: 1,
        title: "Retry checkpoint",
        goal: "Exercise one failed Review and its automatic retry.",
        constraints: ["Do not modify workspace files."],
        acceptance: ["The retry Review passes after one continue verdict."],
        provenance: "Fixed packaged contract.",
      },
      {
        id: "packaged-goal-2",
        order: 2,
        title: "Completion checkpoint",
        goal: "Advance to the second goal and complete the task.",
        constraints: ["Do not modify workspace files."],
        acceptance: ["The final Review passes and the task becomes done."],
        provenance: "Fixed packaged contract.",
      },
    ],
  },
  provenance: {
    clarify_transcript_verbatim: "The fixed packaged answer was supplied.",
    approved_ceo_task_card_verbatim: "The packaged Task Card was approved.",
  },
};

const planExecInputs = ["G1_R1", "G1_R2", "G2_R1"].map((marker) => ({
  plan_summary: `Prescribed packaged plan ${marker}.`,
  execution_summary: `Prescribed packaged execution ${marker}.`,
  evidence: [`Prescribed packaged evidence ${marker}.`],
  validation_performed: [`Prescribed packaged validation ${marker}.`],
  remaining_risks: [],
  next_review_focus: `Validate packaged marker ${marker}.`,
}));

const reviewIndependentInputs = ["G1_R1", "G1_R2", "G2_R1"].map((marker) => ({
  observations: [`Independent packaged observation ${marker}.`],
  working_theory: `Independent packaged theory ${marker}.`,
  inspection_focus: [`Independent packaged focus ${marker}.`],
}));

const reviewVerdicts = [
  {
    outcome: "continue",
    summary: "The first packaged Review prescribes one retry.",
    evidence_summary: "The fixed first-attempt marker requires correction.",
    direction_memo: {
      conclusion: "Retry the first packaged checkpoint.",
      reality: ["The first fixed marker intentionally fails once."],
      diagnosis: "PACKAGED_FIXED_ROOT_CAUSE",
      abandon: ["PACKAGED_FIRST_ATTEMPT_ROUTE"],
      reframe: "Use the prescribed second-attempt marker.",
      next_direction: "PACKAGED_RETRY_DIRECTION",
    },
  },
  {
    outcome: "pass",
    summary: "The packaged retry passes.",
    evidence_summary: "The prescribed retry marker is present.",
  },
  {
    outcome: "pass",
    summary: "The packaged second goal passes.",
    evidence_summary: "The prescribed final marker is present.",
  },
];

function record(value) {
  fs.appendFileSync(capturePath, `${JSON.stringify({ pid: process.pid, ...value })}\n`);
}

function writeMessage(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function readSharedState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return { planExec: 0, review: 0 };
  }
}

function takeSharedIndex(key) {
  const state = readSharedState();
  const index = Number.isInteger(state[key]) ? state[key] : 0;
  state[key] = index + 1;
  fs.writeFileSync(statePath, JSON.stringify(state));
  return index;
}

function resultFor(method, params) {
  switch (method) {
    case "initialize":
      return {};
    case "collaborationMode/list":
      return { data: [{ id: "auto", label: "Auto" }] };
    case "config/read":
    case "getUserSavedConfig":
      return { config: {} };
    case "model/list":
      return {
        data: [
          {
            id: "gpt-5.4",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }],
          },
        ],
      };
    case "skills/list":
      return { data: [] };
    case "thread/start":
      dynamicToolNames = Array.isArray(params?.dynamicTools)
        ? params.dynamicTools.map((tool) => tool.name).filter(Boolean)
        : [];
      record({ kind: "thread_start", threadId, dynamicToolNames, cwd: params?.cwd ?? null });
      return { thread: { id: threadId } };
    case "thread/resume":
      return { thread: { id: params?.threadId ?? threadId, turns: [] } };
    case "thread/read":
      return { thread: { id: params?.threadId ?? threadId, turns: [] } };
    case "thread/loaded/list":
      return { data: [] };
    case "turn/start": {
      const turnId = `scripted-turn-${process.pid}-${++turnOrdinal}`;
      record({
        kind: "turn_start",
        threadId: params?.threadId ?? threadId,
        turnId,
        input: params?.input ?? null,
        dynamicToolNames,
      });
      setImmediate(() => void runTurn(params, turnId));
      return { turn: { id: turnId } };
    }
    default:
      record({ kind: "unhandled_request", method });
      return {};
  }
}

function callTool(tool, argumentsValue, turnId) {
  const id = nextServerRequestId++;
  const callId = `scripted-call-${process.pid}-${id}`;
  record({ kind: "tool_call", threadId, turnId, callId, tool });
  writeMessage({
    jsonrpc: "2.0",
    id,
    method: "item/tool/call",
    params: {
      threadId,
      turnId,
      callId,
      namespace: null,
      tool,
      arguments: argumentsValue,
    },
  });
  return new Promise((resolve, reject) => {
    pendingServerRequests.set(id, { resolve, reject, tool });
  });
}

async function requireTool(tool, argumentsValue, turnId) {
  const response = await callTool(tool, argumentsValue, turnId);
  if (response?.success !== true) {
    throw new Error(`Tool ${tool} failed: ${JSON.stringify(response)}`);
  }
  return response;
}

async function runTurn(params, turnId) {
  writeMessage({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
  try {
    const inputText = JSON.stringify(params?.input ?? null);
    if (dynamicToolNames.includes("thoth_submit_clarify_convergence_audit")) {
      await requireTool(
        "thoth_submit_clarify_convergence_audit",
        {
          outcome: "proceed",
          summary: "The deterministic packaged task is grounded.",
          missing_material_frontier: [],
          rejected_question_patterns: [],
          task_memory_refs: ["packaged AppImage fixture"],
        },
        turnId,
      );
    } else if (dynamicToolNames.includes("thoth_loop_submit_planexec_result")) {
      const index = takeSharedIndex("planExec");
      await requireTool(
        "thoth_loop_submit_planexec_result",
        planExecInputs[index] ?? planExecInputs.at(-1),
        turnId,
      );
    } else if (dynamicToolNames.includes("thoth_loop_submit_review_verdict")) {
      const index = takeSharedIndex("review");
      await requireTool(
        "thoth_loop_submit_review_independent_assessment",
        reviewIndependentInputs[index] ?? reviewIndependentInputs.at(-1),
        turnId,
      );
      await requireTool(
        "thoth_loop_submit_review_verdict",
        reviewVerdicts[index] ?? reviewVerdicts.at(-1),
        turnId,
      );
    } else if (
      dynamicToolNames.includes("thoth_submit_clarify_card") &&
      inputText.includes("Follow the installed thoth.clarify skill")
    ) {
      if (inputText.includes("Approved Task Card:")) {
        await requireTool("thoth_submit_goals_card", goalsCard, turnId);
      } else if (inputText.includes("Clarification:")) {
        await requireTool("thoth_submit_task_card", taskCard, turnId);
      } else {
        await requireTool("thoth_submit_clarify_card", clarifyCard, turnId);
      }
    }
    record({ kind: "turn_complete", threadId, turnId });
    writeMessage({
      method: "turn/completed",
      params: { threadId, turn: { id: turnId, status: "completed", error: null } },
    });
  } catch (error) {
    record({
      kind: "turn_error",
      threadId,
      turnId,
      error: error instanceof Error ? error.message : String(error),
    });
    writeMessage({
      method: "turn/completed",
      params: {
        threadId,
        turn: {
          id: turnId,
          status: "failed",
          error: { message: error instanceof Error ? error.message : String(error) },
        },
      },
    });
  }
}

function handleMessage(message) {
  if (typeof message?.id === "number" && typeof message?.method === "string") {
    try {
      writeMessage({ id: message.id, result: resultFor(message.method, message.params) });
    } catch (error) {
      writeMessage({
        id: message.id,
        error: { message: error instanceof Error ? error.message : String(error) },
      });
    }
    return;
  }
  if (typeof message?.id === "number" && pendingServerRequests.has(message.id)) {
    const pending = pendingServerRequests.get(message.id);
    pendingServerRequests.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? `Tool ${pending.tool} failed`));
    } else {
      pending.resolve(message.result);
    }
  }
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  for (;;) {
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex < 0) break;
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (error) {
      record({
        kind: "parse_error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

record({ kind: "process_start", argv: process.argv.slice(2), threadId });
