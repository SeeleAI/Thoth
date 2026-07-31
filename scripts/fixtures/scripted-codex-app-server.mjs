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

let threadId = `scripted-thread-${process.pid}`;
let dynamicToolNames = [];
let buffer = "";
let turnOrdinal = 0;
let nextServerRequestId = 1_000_000 + process.pid * 100;
const pendingServerRequests = new Map();
const activeTurns = new Set();
let foregroundFlow = "core";
let awaitingNativePlanImplementation = false;

const decisionMap = {
  effectiveStrength: "light",
  publicSummary: "The packaged objective is grounded and two material Human branches remain.",
  nodes: [
    {
      id: "packaged-scope",
      parentIds: [],
      title: "Packaged execution scope",
      owner: "human",
      materiality: "structural",
      status: "awaiting_human",
      resolutionRef: null,
      sourceRefs: ["fixture:packaged-request"],
    },
    {
      id: "packaged-evidence",
      parentIds: ["packaged-scope"],
      title: "Packaged evidence boundary",
      owner: "human",
      materiality: "material",
      status: "awaiting_human",
      resolutionRef: null,
      sourceRefs: ["fixture:packaged-request"],
    },
  ],
};

const clarifyCard = {
  title: "Packaged flow decisions",
  whyNow: "The execution scope and evidence boundary change the Task Anchor.",
  publicSummary: "The packaged flow is waiting for two prescribed Human decisions.",
  questions: [
    {
      nodeId: "packaged-scope",
      question: "Use the fixed packaged scope?",
      selectionMode: "single",
      choices: [
        { id: "scope-yes", label: "Use scope", description: "Continue fixed flow" },
        { id: "scope-no", label: "Stop flow", description: "Exercise cancel path" },
      ],
      recommendedChoiceId: "scope-yes",
      note: "The fixed scope keeps the acceptance run deterministic.",
    },
    {
      nodeId: "packaged-evidence",
      question: "Use the fixed packaged evidence?",
      selectionMode: "single",
      choices: [
        { id: "evidence-yes", label: "Use evidence", description: "Record fixed evidence" },
        { id: "evidence-no", label: "Reject evidence", description: "Exercise alternate path" },
      ],
      recommendedChoiceId: "evidence-yes",
      note: "The fixed evidence is visible to the fresh Reviewer.",
    },
  ],
  allowChoiceNotes: true,
  allowNoteOnly: true,
  allowSubtreeDelegation: true,
};

const intentContract = {
  contract: {
    title: "Packaged foreground and Loop flow",
    objective: "Verify installed Decision Map, Quick and target-anchored Loop authority.",
    nonGoals: ["Do not exercise an alternate Provider product path."],
    invariants: ["Use only fixed fixture actions.", "Do not mutate unrelated Workspace files."],
    acceptance: ["The packaged daemon records a checkpoint and fresh Review decision."],
    riskBoundary: ["Stop before any action outside the isolated fixture Workspace."],
    humanDecisionRefs: ["packaged-scope", "packaged-evidence"],
    escalationPolicy: {
      returnToHumanWhen: ["The Task Anchor must change."],
      finalConfirmation: "automatic",
    },
  },
  decisionNodeRefs: ["packaged-scope", "packaged-evidence"],
  publicSummary: "The fixed Human decisions now form one stable Intent Contract.",
};

const stopIntentContract = {
  ...intentContract,
  contract: {
    ...intentContract.contract,
    title: "Packaged Stop lifecycle flow",
    objective: "Verify that Stop fences and settles an active packaged Loop execution.",
    acceptance: ["The active execution becomes canceled or explicitly orphaned without a spinner."],
  },
};

const checkpointInputs = ["CYCLE_1", "CYCLE_2"].map((marker) => ({
  title: `Packaged checkpoint ${marker}`,
  activeGap: "Prove the stable Task Anchor against Workspace reality.",
  progressClaim: `Prescribed packaged reality increment ${marker}.`,
  unresolvedGap: marker === "CYCLE_1" ? "Fresh Review must redirect once." : "",
  evidenceRefs: [],
}));

const reviewDecisions = [
  {
    decision: "continue",
    reason: "The first packaged checkpoint made progress but one acceptance gap remains.",
    evidenceRefs: [],
    nextFocus: "Close the remaining acceptance gap with a second reality increment.",
    rejectedRoutes: ["Repeat the first checkpoint without new evidence."],
    acceptanceEvidence: {},
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
    return { checkpoint: 0, review: 0 };
  }
}

function writeSharedState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state));
}

function persistDynamicToolNames(nativeThreadId, toolNames) {
  const state = readSharedState();
  const existing =
    state.dynamicToolNamesByThreadId && typeof state.dynamicToolNamesByThreadId === "object"
      ? state.dynamicToolNamesByThreadId
      : {};
  state.dynamicToolNamesByThreadId = {
    ...existing,
    [nativeThreadId]: [...toolNames],
  };
  writeSharedState(state);
}

function restoreDynamicToolNames(nativeThreadId) {
  const stored = readSharedState().dynamicToolNamesByThreadId?.[nativeThreadId];
  return Array.isArray(stored)
    ? stored.filter((toolName) => typeof toolName === "string" && toolName.length > 0)
    : [];
}

function takeSharedIndex(key) {
  const state = readSharedState();
  const index = Number.isInteger(state[key]) ? state[key] : 0;
  state[key] = index + 1;
  writeSharedState(state);
  return index;
}

function resultFor(method, params) {
  switch (method) {
    case "initialize":
      return {};
    case "collaborationMode/list":
      return {
        data: [
          { name: "Code", mode: "code" },
          { name: "Plan", mode: "plan" },
        ],
      };
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
      persistDynamicToolNames(threadId, dynamicToolNames);
      record({ kind: "thread_start", threadId, dynamicToolNames, cwd: params?.cwd ?? null });
      return { thread: { id: threadId } };
    case "thread/resume": {
      if (typeof params?.threadId === "string" && params.threadId.length > 0) {
        threadId = params.threadId;
      }
      dynamicToolNames = restoreDynamicToolNames(threadId);
      record({
        kind: "thread_resume",
        threadId,
        dynamicToolNames,
      });
      return { thread: { id: threadId, turns: [] } };
    }
    case "thread/read":
      return { thread: { id: params?.threadId ?? threadId, turns: [] } };
    case "thread/loaded/list":
      return { data: [] };
    case "turn/start": {
      const turnId = `scripted-turn-${process.pid}-${++turnOrdinal}`;
      activeTurns.add(turnId);
      record({
        kind: "turn_start",
        threadId: params?.threadId ?? threadId,
        turnId,
        input: params?.input ?? null,
        dynamicToolNames,
        collaborationMode: params?.collaborationMode ?? null,
      });
      setImmediate(() => void runTurn(params, turnId));
      return { turn: { id: turnId } };
    }
    case "turn/interrupt": {
      const turnId = params?.turnId;
      record({ kind: "turn_interrupt", threadId: params?.threadId ?? threadId, turnId });
      if (typeof turnId === "string" && activeTurns.delete(turnId)) {
        setImmediate(() => {
          writeMessage({
            method: "turn/completed",
            params: {
              threadId: params?.threadId ?? threadId,
              turn: { id: turnId, status: "interrupted", error: null },
            },
          });
        });
      }
      return {};
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

function requestUserInput(turnId) {
  const id = nextServerRequestId++;
  const itemId = `scripted-question-${process.pid}-${turnId}`;
  record({ kind: "provider_question_request", threadId, turnId, itemId });
  writeMessage({
    jsonrpc: "2.0",
    id,
    method: "item/tool/requestUserInput",
    params: {
      threadId,
      turnId,
      itemId,
      questions: [
        {
          id: "target",
          header: "Target",
          question: "Which target should the Plan report?",
          options: [
            { label: "Local", description: "Report the local target." },
            { label: "CI", description: "Report the CI target." },
          ],
          multiSelect: false,
          isOther: false,
          isSecret: false,
        },
      ],
    },
  });
  return new Promise((resolve, reject) => {
    pendingServerRequests.set(id, { resolve, reject, tool: "request_user_input" });
  });
}

function emitCompletedAssistantMessage(turnId, text) {
  writeMessage({
    method: "item/completed",
    params: {
      threadId,
      turnId,
      item: {
        id: `scripted-agent-message-${process.pid}-${turnId}`,
        type: "agentMessage",
        text,
      },
    },
  });
}

async function runNativePlanQuestion(turnId) {
  const response = await requestUserInput(turnId);
  const selectedTarget = response?.answers?.target?.answers?.[0];
  if (selectedTarget !== "Local") {
    throw new Error(`Expected structured Local answer, received ${JSON.stringify(response)}`);
  }
  const plan = [
    "1. Inspect the selected Local target.",
    "2. Report the Local target without changing files.",
  ].join("\n");
  record({
    kind: "provider_question_answer",
    threadId,
    turnId,
    questionId: "target",
    values: [selectedTarget],
  });
  writeMessage({
    method: "item/completed",
    params: {
      threadId,
      turnId,
      item: {
        id: `scripted-native-plan-${process.pid}-${turnId}`,
        type: "plan",
        text: plan,
      },
    },
  });
  awaitingNativePlanImplementation = true;
  record({ kind: "native_plan_completed", threadId, turnId, plan });
}

async function requireTool(tool, argumentsValue, turnId) {
  const response = await callTool(tool, argumentsValue, turnId);
  if (response?.success !== true) {
    throw new Error(`Tool ${tool} failed: ${JSON.stringify(response)}`);
  }
  return response;
}

function toolResponseText(response) {
  return Array.isArray(response?.contentItems)
    ? response.contentItems
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .filter(Boolean)
        .join("\n")
    : "";
}

async function runPackagedBrowserFlow(turnId) {
  const baseUrl = process.env.THOTH_FAKE_BROWSER_URL?.replace(/\/$/u, "");
  if (!baseUrl?.startsWith("http://127.0.0.1:")) {
    throw new Error("PACKAGED_BROWSER_AUTOMATION requires an isolated local fixture URL");
  }
  for (const tool of [
    "browser_list_tabs",
    "browser_new_tab",
    "browser_snapshot",
    "browser_navigate",
    "browser_close_tab",
  ]) {
    if (!dynamicToolNames.includes(tool)) {
      throw new Error(`Packaged browser flow is missing dynamic tool ${tool}`);
    }
  }

  await requireTool("browser_list_tabs", {}, turnId);
  const created = await requireTool("browser_new_tab", { url: `${baseUrl}/start` }, turnId);
  const createdText = toolResponseText(created);
  const browserId = /browserId=([^\s]+)/u.exec(createdText)?.[1];
  if (!browserId) {
    throw new Error(`browser_new_tab did not return a browserId: ${createdText}`);
  }

  const startSnapshot = toolResponseText(
    await requireTool("browser_snapshot", { browserId }, turnId),
  );
  if (!startSnapshot.includes("PACKAGED_BROWSER_START")) {
    throw new Error(`Browser start snapshot omitted fixture content: ${startSnapshot}`);
  }

  const wrongBrowser = await callTool(
    "browser_snapshot",
    { browserId: "11111111-1111-4111-8111-111111111111" },
    turnId,
  );
  if (wrongBrowser?.success !== false) {
    throw new Error(`Unknown browserId unexpectedly succeeded: ${JSON.stringify(wrongBrowser)}`);
  }

  await requireTool("browser_navigate", { browserId, url: `${baseUrl}/complete` }, turnId);
  const completeSnapshot = toolResponseText(
    await requireTool("browser_snapshot", { browserId }, turnId),
  );
  if (!completeSnapshot.includes("PACKAGED_BROWSER_COMPLETE")) {
    throw new Error(`Browser complete snapshot omitted fixture content: ${completeSnapshot}`);
  }

  await requireTool("browser_close_tab", { browserId }, turnId);
  const finalTabs = toolResponseText(await requireTool("browser_list_tabs", {}, turnId));
  if (!finalTabs.includes("No Thoth browser tabs are open")) {
    throw new Error(`Browser tab remained after close: ${finalTabs}`);
  }
  record({
    kind: "browser_flow",
    threadId,
    turnId,
    browserId,
    startSnapshot: true,
    completeSnapshot: true,
    wrongBrowserRejected: true,
    closed: true,
  });
}

function promptText(input) {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return JSON.stringify(input ?? null);
  return input
    .map((item) => (typeof item?.text === "string" ? item.text : JSON.stringify(item)))
    .join("\n");
}

function semanticRefs(text, prefix) {
  const matches = text.match(new RegExp(`${prefix}[A-Za-z0-9._:-]+`, "gu")) ?? [];
  return [...new Set(matches)];
}

async function waitForExecuteRelease(turnId) {
  while (readSharedState().holdExecute === true && activeTurns.has(turnId)) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return activeTurns.has(turnId);
}

async function submitLoopCheckpoint(turnId) {
  if (readSharedState().holdExecute === true) {
    record({ kind: "execute_hold", threadId, turnId });
    const released = await waitForExecuteRelease(turnId);
    if (!released) return;
  }
  const index = takeSharedIndex("checkpoint");
  await requireTool(
    "thoth_loop_checkpoint",
    checkpointInputs[index] ?? checkpointInputs.at(-1),
    turnId,
  );
}

async function runTurn(params, turnId) {
  writeMessage({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
  try {
    const inputText = promptText(params?.input);
    if (inputText.includes("PACKAGED_LOOP_STOP")) foregroundFlow = "stop";
    if (awaitingNativePlanImplementation) {
      if (params?.collaborationMode?.mode === "plan") {
        throw new Error("Native Plan implementation did not return to Provider default mode");
      }
      awaitingNativePlanImplementation = false;
      emitCompletedAssistantMessage(turnId, "PACKAGED_NATIVE_PLAN_IMPLEMENTED");
      record({ kind: "native_plan_implemented", threadId, turnId });
    } else if (inputText.includes("PACKAGED_NATIVE_PLAN_UI")) {
      if (params?.collaborationMode?.mode !== "plan") {
        throw new Error("PACKAGED_NATIVE_PLAN_UI did not start in native Plan mode");
      }
      await runNativePlanQuestion(turnId);
    } else if (inputText.includes("PACKAGED_BROWSER_AUTOMATION")) {
      await runPackagedBrowserFlow(turnId);
    } else if (inputText.includes("Judge this proposed Intent Contract once.")) {
      await requireTool(
        "thoth_clarify_judge_contract",
        {
          decision: "stable",
          reason:
            "The packaged Decision Map covers the objective, evidence, risk and acceptance frontier.",
          missingNodes: [],
        },
        turnId,
      );
    } else if (
      inputText.includes("Implement the completed native Plan now in this same Provider thread.") ||
      inputText.includes("Your turn ended without the required semantic checkpoint.")
    ) {
      await submitLoopCheckpoint(turnId);
    } else if (inputText.includes("Act as the Executor for one meaningful real increment")) {
      if (params?.collaborationMode?.mode === "plan") {
        const index = readSharedState().checkpoint ?? 0;
        const checkpoint = checkpointInputs[index] ?? checkpointInputs.at(-1);
        const plan = `Orient to the Task Anchor and produce ${checkpoint.title}.`;
        record({ kind: "plan_ready", threadId, turnId, plan });
        writeMessage({
          method: "item/completed",
          params: {
            threadId,
            turnId,
            item: {
              id: `scripted-plan-${process.pid}-${turnId}`,
              type: "plan",
              text: plan,
            },
          },
        });
      } else {
        await submitLoopCheckpoint(turnId);
      }
    } else if (inputText.includes("Act as a fresh independent Reviewer")) {
      const index = takeSharedIndex("review");
      const evidenceRefs = semanticRefs(inputText, "evidence-checkpoint-");
      const claimRefs = semanticRefs(inputText, "acceptance-claim-");
      const review = reviewDecisions[index] ?? {
        decision: "complete",
        reason: "Fresh inspection confirms every packaged Acceptance Claim.",
        evidenceRefs,
        nextFocus: undefined,
        rejectedRoutes: [],
        acceptanceEvidence: Object.fromEntries(claimRefs.map((claimId) => [claimId, evidenceRefs])),
      };
      await requireTool("thoth_loop_review_decision", review, turnId);
    } else if (
      dynamicToolNames.includes("thoth_clarify_update_map") &&
      inputText.includes("Follow the installed thoth.clarify skill")
    ) {
      if (inputText.includes("Propagate the latest Human Decision")) {
        await requireTool(
          "thoth_clarify_propose_contract",
          foregroundFlow === "stop" ? stopIntentContract : intentContract,
          turnId,
        );
      } else {
        await requireTool("thoth_clarify_update_map", decisionMap, turnId);
        await requireTool("thoth_clarify_ask", clarifyCard, turnId);
      }
    } else if (inputText.includes("Execute the complete approved task now")) {
      emitCompletedAssistantMessage(turnId, "PACKAGED_QUICK_EXECUTED");
      record({ kind: "quick_executed", threadId, turnId });
    }
    if (!activeTurns.has(turnId)) return;
    record({ kind: "turn_complete", threadId, turnId });
    activeTurns.delete(turnId);
    writeMessage({
      method: "turn/completed",
      params: { threadId, turn: { id: turnId, status: "completed", error: null } },
    });
  } catch (error) {
    if (!activeTurns.has(turnId)) return;
    activeTurns.delete(turnId);
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
