import {
  ClarifyProviderRuntimeInputPacketSchema,
  ClarifyRuntimePacketSchema,
  ThothSubmitTaskCardInputSchema,
  type ClarifyProviderRuntimeInputPacket,
  type ClarifyRuntimeCode,
  type ClarifyRuntimePacket,
  type ThothRuntimeSkillRef,
} from "@thoth/protocol/thoth-runtime-contract";
import {
  buildClarifyRepairInputPacket,
  buildClarifySessionStartInputPacket,
  buildClarifyTransitionInputPacket,
  buildClarifyTurnInputPacket,
  CLARIFY_SKILL_ID,
  loadRuntimeSkillArtifact,
} from "./contract.js";

export interface ClarifyUserSimulationTurn {
  id: string;
  userInput: string;
  inputPacket: ClarifyProviderRuntimeInputPacket;
  outputPacket: ClarifyRuntimePacket;
  uiProjection: string;
  expectedBehavior: readonly string[];
}

export interface ClarifyUserSimulationReport {
  sessionId: string;
  transcriptVerbatim: string;
  approvedCeoTaskCardVerbatim: string;
  turns: readonly ClarifyUserSimulationTurn[];
  auxiliaryTurns: readonly ClarifyUserSimulationTurn[];
  repairPacket: ClarifyProviderRuntimeInputPacket;
  repairOutputPacket: ClarifyRuntimePacket;
}

export interface ClarifyUserSimulationValidation {
  passed: boolean;
  failures: string[];
}

const mainSessionId = "sec_user_sim_pathtracing";
const cleanupSessionId = "sec_user_sim_cleanup";
const conflictSessionId = "sec_user_sim_conflict";

const transcriptVerbatim = [
  "User: hi",
  "Assistant: 你好，我在。你想推进什么？",
  "User: 我想把项目做成真正可用的 3D 渲染系统",
  "Q: 这次最需要先切掉哪条错误路线？",
  "Q: 真实可用先在哪个交付场景闭环？",
  "A: 要做完整 Three.js PathTracing 引擎，先在现有项目里真实使用。",
  "Q: 完整引擎目标不变，优先按哪种真实使用路线？",
  "Q: 真实集成优先保留哪条渲染路径？",
  "A: 选画质优先；注意要能集成真实项目，并保留现有渲染路径。",
  "Q: 什么证据出现才算这条引擎路线完成？",
  "Q: 性能基线按哪类真实负载取样？",
  "A: 不选，补充：验收要有路径追踪截图、交互负载性能基线和测试，不能做 demo 降级。",
  "Q: 这次最需要提前保护哪类风险边界？",
  "Q: 出问题时必须保住哪条恢复边界？",
  "A: 集成风险优先，必须保留可关闭回退。",
  "Q: PathTracing 与现有渲染主链怎样共存？",
  "Q: 真实集成优先保留哪条渲染路径？",
  "Q: 这条集成通过什么方式向真实用户启用？",
  "A: 增量接入，先不替换现有主链，通过功能开关逐步启用。",
  "Q: 场景、材质和相机数据按哪种合同接入？",
  "Q: 场景数据的更新所有权按哪种边界处理？",
  "A: 沿用现有应用状态源，通过适配层消费，不复制应用状态源。",
  "Q: 资源和交互预算优先保护什么？",
  "Q: 资源接近上限时优先保住什么？",
  "A: 优先保持交互响应，资源接近上限时降低路径追踪负担。",
  "Q: 性能基线按哪类真实负载和设备档位取样？",
  "Q: 性能基线优先约束哪类设备档位？",
  "A: 用交互场景和目标设备档位。",
  "Q: 兼容与发布验证最少覆盖什么？",
  "Q: 兼容性变化用哪种发布边界验证？",
  "A: 覆盖现有调用方和新渲染路径的相关回归。",
  "Q: 交付前的变更控制最先看哪类证据？",
  "Q: 完成后哪类剩余风险必须进入证据包？",
  "A: 先看画质结果，再看性能和回归；画质偏差和运行边界都进入证据包；具体技术路线你决定，优先用最稳方式。",
].join("\n");

const stopTranscriptVerbatim = [
  ...transcriptVerbatim.split("\n").slice(0, 11),
  "User: 够了，不要再问，按刚才整理 Task Card",
].join("\n");

const approvedCeoTaskCardVerbatim = [
  "CEO Task Card: 完整 Three.js PathTracing 引擎",
  "目标: 在项目中落地真实可用的 Three.js PathTracing 引擎。",
  "约束: 不降级为 demo/mock/MVP；技术路线由 agent 选择最稳方式；保留画质优先和真实集成。",
  "验收: 路径追踪截图、性能基线和测试证据齐全。",
].join("\n");

const linearGoalsCard = {
  title: "完整 Three.js PathTracing 引擎",
  summary: "按线性里程碑完成真实集成、画质、性能与可复核验收。",
  goals_count_rationale:
    "完整引擎包含八个可独立 Review 的线性边界，覆盖接入、合同、核心、保护、性能和证据。",
  goals: [
    {
      id: "goal-01-current-render-map",
      order: 1,
      title: "建立现有渲染入口证据",
      goal: "确认当前场景、相机和渲染生命周期的真实接入边界。",
      constraints: ["不改变既有渲染行为。"],
      acceptance: ["入口与生命周期证据可复核。"],
      provenance: "来自真实项目集成与增量接入决定。",
    },
    {
      id: "goal-02-integration-contract",
      order: 2,
      title: "冻结增量集成合同",
      goal: "定义 PathTracing 与现有 renderer 的启用、回退和数据边界。",
      constraints: ["保留可关闭回退路径。"],
      acceptance: ["集成合同覆盖启用和回退。"],
      provenance: "来自集成边界与恢复要求。",
    },
    {
      id: "goal-03-scene-data-contract",
      order: 3,
      title: "建立场景数据合同",
      goal: "明确可被路径追踪消费的场景、材质和相机数据。",
      constraints: ["兼容现有项目数据所有权。"],
      acceptance: ["数据输入与错误边界可验证。"],
      provenance: "来自 API 与数据契约决定。",
    },
    {
      id: "goal-04-pathtracing-core",
      order: 4,
      title: "落地路径追踪核心",
      goal: "实现画质优先的真实路径追踪核心路径。",
      constraints: ["不降级为 demo、mock 或孤立样例。"],
      acceptance: ["目标场景可生成可核对的路径追踪结果。"],
      provenance: "来自完整引擎目标与画质优先决定。",
    },
    {
      id: "goal-05-progressive-control",
      order: 5,
      title: "接入渐进渲染控制",
      goal: "让渲染收敛、重置和交互变化遵守真实项目生命周期。",
      constraints: ["不破坏现有交互渲染路径。"],
      acceptance: ["相机或场景变化后的收敛行为可证明。"],
      provenance: "来自交互负载与兼容性边界。",
    },
    {
      id: "goal-06-resource-guardrails",
      order: 6,
      title: "建立资源保护边界",
      goal: "约束显存、内存和异常场景下的安全退化与恢复。",
      constraints: ["保留用户确认的可关闭回退。"],
      acceptance: ["资源异常不会静默破坏现有路径。"],
      provenance: "来自资源预算与回滚边界。",
    },
    {
      id: "goal-07-benchmark-and-regression",
      order: 7,
      title: "形成性能与回归基线",
      goal: "在真实交互负载下记录性能并验证相关回归。",
      constraints: ["基线覆盖用户选择的真实负载。"],
      acceptance: ["性能数据与相关测试证据齐全。"],
      provenance: "来自性能基线和测试范围决定。",
    },
    {
      id: "goal-08-evidence-pack",
      order: 8,
      title: "封存可审查验收证据",
      goal: "汇总画质截图、性能基线、测试结果和剩余风险。",
      constraints: ["证据可定位到每个验收项。"],
      acceptance: ["所有已批准验收项都有可复核证据。"],
      provenance: "来自用户确认的截图、性能和测试验收。",
    },
  ],
} as const;

function materialCompanionQuestions(input: { id: string; node: string }): Array<{
  id: string;
  question: string;
  node: string;
  choices: Array<{ id: string; label: string; description: string }>;
}> {
  switch (input.node) {
    case "goal_route":
      return [
        {
          id: `${input.id}_delivery`,
          question: "真实可用先在哪个交付场景闭环？",
          node: "delivery_context",
          choices: [
            { id: "existing", label: "现有项目", description: "先接入当前场景" },
            { id: "package", label: "独立模块", description: "先形成可复用边界" },
          ],
        },
      ];
    case "target_grade":
      return [
        {
          id: `${input.id}_integration`,
          question: "真实集成优先保留哪条渲染路径？",
          node: "integration_boundary",
          choices: [
            { id: "incremental", label: "增量接入", description: "保留现有渲染链" },
            { id: "replace", label: "替换主链", description: "优先统一新渲染路径" },
          ],
        },
      ];
    case "integration_boundary":
      return [
        {
          id: `${input.id}_enablement`,
          question: "这条集成通过什么方式向真实用户启用？",
          node: "integration_enablement",
          choices: [
            { id: "feature", label: "功能开关", description: "可逐步验证和回退" },
            { id: "default", label: "默认接管", description: "新路径作为默认渲染" },
          ],
        },
      ];
    case "api_data_contract":
      return [
        {
          id: `${input.id}_ownership`,
          question: "场景数据的更新所有权按哪种边界处理？",
          node: "scene_data_ownership",
          choices: [
            { id: "existing", label: "沿用现有", description: "不复制应用状态源" },
            { id: "adapter", label: "适配快照", description: "由适配层维护渲染快照" },
          ],
        },
      ];
    case "resource_budget":
      return [
        {
          id: `${input.id}_fallback`,
          question: "资源接近上限时优先保住什么？",
          node: "resource_fallback",
          choices: [
            { id: "quality", label: "画质稳定", description: "降低吞吐但保持效果" },
            { id: "responsiveness", label: "交互响应", description: "优先保持操作流畅" },
          ],
        },
      ];
    case "benchmark_workload":
      return [
        {
          id: `${input.id}_device`,
          question: "性能基线优先约束哪类设备档位？",
          node: "device_baseline",
          choices: [
            { id: "target", label: "目标设备", description: "服务当前主要用户" },
            { id: "broad", label: "兼容下限", description: "优先覆盖较广设备" },
          ],
        },
      ];
    case "compatibility_envelope":
      return [
        {
          id: `${input.id}_release`,
          question: "兼容性变化用哪种发布边界验证？",
          node: "release_validation",
          choices: [
            { id: "existing", label: "现有用例", description: "先守住当前调用方" },
            { id: "expanded", label: "扩展场景", description: "同步覆盖新渲染路径" },
          ],
        },
      ];
    case "change_control":
      return [
        {
          id: `${input.id}_evidence`,
          question: "完成后哪类剩余风险必须进入证据包？",
          node: "release_risk_reporting",
          choices: [
            { id: "quality", label: "画质偏差", description: "记录收敛和可见差异" },
            { id: "runtime", label: "运行边界", description: "记录性能和兼容限制" },
          ],
        },
      ];
    case "acceptance_boundary":
      return [
        {
          id: `${input.id}_baseline`,
          question: "性能基线按哪类真实负载取样？",
          node: "benchmark_workload",
          choices: [
            { id: "static", label: "静态场景", description: "固定相机与资产" },
            { id: "interactive", label: "交互场景", description: "含相机和材质变化" },
          ],
        },
      ];
    case "risk_resource_boundary":
      return [
        {
          id: `${input.id}_guardrail`,
          question: "出问题时必须保住哪条恢复边界？",
          node: "rollback_boundary",
          choices: [
            { id: "toggle", label: "可关闭回退", description: "随时回到旧路径" },
            { id: "snapshot", label: "状态可恢复", description: "保留诊断和恢复证据" },
          ],
        },
      ];
    case "contradiction_resolution":
      return [
        {
          id: `${input.id}_validation`,
          question: "若允许修复，验证范围至少覆盖什么？",
          node: "repair_validation_scope",
          choices: [
            { id: "targeted", label: "目标回归", description: "覆盖问题与边界" },
            { id: "suite", label: "相关套件", description: "同时检查相邻影响" },
          ],
        },
      ];
    default:
      return [
        {
          id: `${input.id}_scope`,
          question: "这条决定影响的边界优先按哪种范围处理？",
          node: `${input.node}_scope`,
          choices: [
            { id: "narrow", label: "当前路径", description: "只覆盖本次目标" },
            { id: "shared", label: "共享边界", description: "兼顾已有调用方" },
          ],
        },
      ];
  }
}

function askPacket(input: {
  sessionId: string;
  id: string;
  title: string;
  question: string;
  node: string;
  choices: Array<{ id: string; label: string; description: string }>;
  strength?: "none" | "auto" | "light" | "balanced" | "dive" | "deep";
  treeDepth?: number;
  qaRoundCount?: number;
  extraQuestions?: Array<{
    id: string;
    question: string;
    node: string;
    choices: Array<{ id: string; label: string; description: string }>;
  }>;
}): ClarifyRuntimePacket {
  const extraQuestions = input.extraQuestions ?? materialCompanionQuestions(input);
  const questions = [
    {
      id: input.id,
      question: input.question,
      behavior_tree_node: input.node,
      selection_mode: "single" as const,
      choices: input.choices,
    },
    ...extraQuestions.map((question) => ({
      id: question.id,
      question: question.question,
      behavior_tree_node: question.node,
      selection_mode: "single" as const,
      choices: question.choices,
    })),
  ];
  const questionCard = {
    question_id: input.id,
    title: input.title,
    behavior_tree_node: input.node,
    why_now: "这是当前最能减少做偏风险的分叉。",
    questions,
    allow_choice_notes: true,
    allow_note_only: true,
  };
  const strength = input.strength ?? "balanced";

  return {
    type: "clarify",
    code: "C_ASK",
    session_id: input.sessionId,
    task_id: null,
    content: {
      question_card: questionCard,
      public_badge_summary: `正在收敛 ${input.title}：本轮只处理 ${input.node} 这一条材料分叉。`,
      frontier_ledger: {
        clarify_strength: strength,
        grounded_user_decisions: [],
        remaining_material_user_owned_assumptions: [input.node],
        agent_owned_assumptions: [`${input.node} 的实现策略由 agent 决定。`],
        discoverable_assumptions: [`${input.node} 的仓库事实由 agent 查证。`],
        why_this_round: "当前问题切掉最高影响的用户材料分叉。",
        convergence_state: "not_converged",
      },
      decision_delta: {
        affected_contract_fields: ["goal", "constraints", "acceptance"],
        safe_if_unanswered: "保持当前已确认边界，不擅自扩展。",
        eliminated_routes: ["与当前用户分叉相冲突的路线"],
        irreversible_or_cost_impact: "该选择会影响后续集成、验证或资源成本。",
        downstream_refs: ["task_card", "goals_card", "review"],
      },
      meta: {
        effective_clarify_strength: strength,
        decision_tree_depth: input.treeDepth ?? 1,
        qa_round_count: input.qaRoundCount ?? 1,
        remaining_material_assumptions: [
          {
            id: input.node,
            owner: "user_must_decide",
            summary: "这个分叉会改变后续 Task Card。",
            impact: "high",
          },
        ],
        assumptions: [
          {
            id: input.node,
            owner: "user_must_decide",
            summary: "当前卡片处理的高影响用户分叉。",
            impact: "high",
          },
          {
            id: `${input.node}_agent_owned`,
            owner: "agent_can_decide",
            summary: "实现策略由 agent 在合同边界内决定。",
            impact: "medium",
          },
          {
            id: `${input.node}_discoverable`,
            owner: "agent_can_discover",
            summary: "仓库与运行时事实由 agent 自行查证。",
            impact: "medium",
          },
          {
            id: `${input.node}_standard`,
            owner: "standard_answer/common_sense",
            summary: "通用工程惯例不需要用户逐项确认。",
            impact: "low",
          },
        ],
        question_value_reason: "当前问题切掉最高影响的 user_must_decide 分叉。",
      },
    },
    ui: {
      kind: "clarify_card",
      title: input.title,
      question_card: questionCard,
    },
    next: "C_ASK",
    errors: [],
  };
}

function directPacket(sessionId: string, message: string): ClarifyRuntimePacket {
  return {
    type: "clarify",
    code: "C_DIRECT",
    session_id: sessionId,
    task_id: null,
    content: {
      message,
    },
    ui: {
      kind: "message",
      text: message,
    },
    next: "C_DIRECT",
    errors: [],
  };
}

function taskCardPacket(): ClarifyRuntimePacket {
  return {
    type: "clarify",
    code: "C_TASK_CARD",
    session_id: mainSessionId,
    task_id: null,
    content: {
      task_card: {
        title: "完整 Three.js PathTracing 引擎",
        goal: "在项目中落地真实可用的 Three.js PathTracing 引擎，画质优先并保持真实集成。",
        constraints: ["不降级为 demo/mock/MVP", "技术路线由 agent 选择最稳方式"],
        acceptance: ["路径追踪截图", "性能基线", "测试证据"],
      },
      provenance: {
        clarify_transcript_verbatim: transcriptVerbatim,
      },
      convergence_review: {
        frontier_ledger: {
          clarify_strength: "dive",
          grounded_user_decisions: [
            "真实 Three.js PathTracing 引擎并集成现有项目",
            "画质优先，保留现有渲染路径和可关闭回退",
            "以截图、交互负载性能基线和测试作为验收证据",
          ],
          remaining_material_user_owned_assumptions: [],
          agent_owned_assumptions: ["具体技术路线由 agent 选择最稳方式"],
          discoverable_assumptions: ["现有渲染入口、应用状态源和目标设备事实由 agent 查证"],
          why_this_round: "十轮 Clarify 已覆盖交付、集成、验收、风险、资源和发布边界。",
          convergence_state: "ready_for_task",
        },
        why_task_is_now_grounded: "所有适用的高影响用户边界均已由完整 transcript 明确。",
      },
    },
    ui: {
      kind: "task_registration_card",
      title: "确认后台任务",
    },
    next: "C_GOAL_CARD",
    errors: [],
  };
}

function stopClarifyTaskCardPacket(): ClarifyRuntimePacket {
  return {
    type: "clarify",
    code: "C_TASK_CARD",
    session_id: mainSessionId,
    task_id: null,
    content: {
      task_card: {
        title: "完整 Three.js PathTracing 引擎",
        goal: "用户要求停止澄清，按已有 transcript 编译真实可用 PathTracing 引擎任务。",
        constraints: ["不降级为 demo/mock/MVP", "技术路线由 agent 选择最稳方式"],
        acceptance: ["路径追踪截图", "性能基线", "测试证据"],
      },
      provenance: {
        clarify_transcript_verbatim: stopTranscriptVerbatim,
      },
      convergence_review: {
        frontier_ledger: {
          clarify_strength: "dive",
          grounded_user_decisions: [
            "真实 Three.js PathTracing 引擎并集成现有项目",
            "用户明确要求停止继续澄清并按现有 transcript 编译 Task Card",
          ],
          remaining_material_user_owned_assumptions: [],
          agent_owned_assumptions: ["具体技术路线由 agent 选择最稳方式"],
          discoverable_assumptions: ["现有仓库、渲染入口和运行环境由 agent 查证"],
          why_this_round: "用户明确终止 Clarify，现有答案足以形成可审批的 Task 边界。",
          convergence_state: "ready_for_task",
        },
        why_task_is_now_grounded: "用户显式停止提问并授权基于已有 transcript 形成 Task Card。",
        below_soft_target_rationale:
          "用户明确停止 Clarify；尚未查明的仓库与实现事实均由 agent 发现或决定，不再占用用户认知。",
      },
    },
    ui: {
      kind: "task_registration_card",
      title: "确认后台任务",
    },
    next: "C_GOAL_CARD",
    errors: [],
  };
}

function goalCardPacket(): ClarifyRuntimePacket {
  return {
    type: "clarify",
    code: "C_GOAL_CARD",
    session_id: mainSessionId,
    task_id: null,
    content: {
      goals_card: linearGoalsCard,
      provenance: {
        clarify_transcript_verbatim: transcriptVerbatim,
        approved_ceo_task_card_verbatim: approvedCeoTaskCardVerbatim,
      },
    },
    ui: {
      kind: "goal_contract_card",
      title: "确认线性目标拆分",
    },
    next: "C_REGISTER",
    errors: [],
  };
}

function registerPacket(): ClarifyRuntimePacket {
  return {
    type: "clarify",
    code: "C_REGISTER",
    session_id: mainSessionId,
    task_id: "task_user_sim_pathtracing",
    content: {
      task_card: {
        title: "完整 Three.js PathTracing 引擎",
        goal: "在项目中落地真实可用的 Three.js PathTracing 引擎，画质优先并保持真实集成。",
        constraints: ["不降级为 demo/mock/MVP", "技术路线由 agent 选择最稳方式"],
        acceptance: ["路径追踪截图", "性能基线", "测试证据"],
      },
      goals_card: linearGoalsCard,
      provenance: {
        clarify_transcript_verbatim: transcriptVerbatim,
        approved_ceo_task_card_verbatim: approvedCeoTaskCardVerbatim,
      },
    },
    ui: {
      kind: "registered_card",
      title: "已注册后台任务",
    },
    next: "C_REGISTER",
    errors: [],
  };
}

function turn(
  id: string,
  userInput: string,
  inputPacket: ClarifyProviderRuntimeInputPacket,
  outputPacket: ClarifyRuntimePacket,
  uiProjection: string,
  expectedBehavior: readonly string[],
): ClarifyUserSimulationTurn {
  return {
    id,
    userInput,
    inputPacket,
    outputPacket,
    uiProjection,
    expectedBehavior,
  };
}

function transitionPacket(
  from: ClarifyRuntimeCode,
  to: ClarifyRuntimeCode,
  userInput: string,
  transcriptVersion: number,
  skillRef: ThothRuntimeSkillRef,
  clarify: "none" | "auto" | "light" | "balanced" | "dive" | "deep" = "balanced",
): ClarifyProviderRuntimeInputPacket {
  return buildClarifyTransitionInputPacket({
    sessionId: mainSessionId,
    from,
    to,
    userInput,
    transcriptRef: `transcript:${mainSessionId}:v${transcriptVersion}`,
    clarify,
    mode: "loop",
    loop: "balanced",
    skillRef,
  });
}

function packetProvenance(packet: ClarifyRuntimePacket): Record<string, unknown> | undefined {
  const provenance = packet.content.provenance;
  if (typeof provenance === "object" && provenance !== null) {
    return provenance as Record<string, unknown>;
  }
  return undefined;
}

export function buildClarifyUserSimulationReport(
  skillRef: ThothRuntimeSkillRef = {
    id: CLARIFY_SKILL_ID,
    digest: loadRuntimeSkillArtifact(CLARIFY_SKILL_ID).digest,
  },
): ClarifyUserSimulationReport {
  const turns: ClarifyUserSimulationTurn[] = [
    turn(
      "hi",
      "hi",
      buildClarifySessionStartInputPacket({
        sessionId: mainSessionId,
        currentState: "C_DIRECT",
        userInput: "hi",
        transcriptRef: `transcript:${mainSessionId}:v0`,
        skillRef,
      }),
      directPacket(mainSessionId, "你好，我在。你想推进什么？"),
      "你好，我在。你想推进什么？",
      ["该直答时直答", "新 provider session 第一轮带 skill digest"],
    ),
    turn(
      "vague-large-task",
      "我想把项目做成真正可用的 3D 渲染系统",
      transitionPacket(
        "C_DIRECT",
        "C_ASK",
        "我想把项目做成真正可用的 3D 渲染系统",
        1,
        skillRef,
        "dive",
      ),
      askPacket({
        sessionId: mainSessionId,
        id: "q_goal_route",
        title: "先定路线",
        question: "这次最需要先切掉哪条错误路线？",
        node: "goal_route",
        strength: "dive",
        choices: [
          { id: "ship", label: "交付闭环", description: "按可用结果推进" },
          { id: "quality", label: "质量优先", description: "先修最大风险" },
          { id: "research", label: "研究验证", description: "先证明关键假设" },
        ],
      }),
      "先定路线：这次最需要先切掉哪条错误路线？",
      ["问最高杠杆行为树分叉", "不问字段问卷"],
    ),
    turn(
      "threejs-pathtracing",
      "要做完整 Three.js PathTracing 引擎，先在现有项目里真实使用。",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "要做完整 Three.js PathTracing 引擎，先在现有项目里真实使用。",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v2`,
      }),
      askPacket({
        sessionId: mainSessionId,
        id: "q_target_grade",
        title: "先定交付级",
        question: "完整引擎目标不变，优先按哪种真实使用路线？",
        node: "target_grade",
        strength: "dive",
        treeDepth: 2,
        choices: [
          { id: "prod", label: "产品可用", description: "重视稳定集成" },
          { id: "quality", label: "画质优先", description: "重视渲染正确" },
          { id: "perf", label: "性能优先", description: "重视帧率预算" },
        ],
      }),
      "先定交付级：完整引擎目标不变，优先按哪种真实使用路线？",
      ["保留完整 PathTracing 目标", "不兜底降级"],
    ),
    turn(
      "branch-choice-answer",
      "选画质优先；注意要能集成真实项目，并保留现有渲染路径。",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "选画质优先；注意要能集成真实项目，并保留现有渲染路径。",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v3`,
      }),
      askPacket({
        sessionId: mainSessionId,
        id: "q_acceptance",
        title: "先锁验收",
        question: "什么证据出现才算这条引擎路线完成？",
        node: "acceptance_boundary",
        strength: "dive",
        treeDepth: 3,
        choices: [
          { id: "screens", label: "截图证明", description: "画质可核对" },
          { id: "perf", label: "性能基线", description: "帧耗有记录" },
          { id: "tests", label: "测试通过", description: "回归可证明" },
        ],
      }),
      "先锁验收：什么证据出现才算这条引擎路线完成？",
      ["吸收用户分支选择", "验收不清时只问验收证据"],
    ),
    turn(
      "note-only-answer",
      "不选，补充：验收要有路径追踪截图、交互负载性能基线和测试，不能做 demo 降级。",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "不选，补充：验收要有路径追踪截图、交互负载性能基线和测试，不能做 demo 降级。",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v4`,
      }),
      askPacket({
        sessionId: mainSessionId,
        id: "q_risk_boundary",
        title: "先守边界",
        question: "这次最需要提前保护哪类风险边界？",
        node: "risk_resource_boundary",
        strength: "dive",
        treeDepth: 4,
        qaRoundCount: 3,
        choices: [
          { id: "integration", label: "集成风险", description: "不破坏现有渲染" },
          { id: "quality", label: "画质风险", description: "先保正确性" },
          { id: "rollback", label: "回滚路径", description: "保留恢复手段" },
        ],
      }),
      "先守边界：这次最需要提前保护哪类风险边界？",
      ["支持 note-only 回答", "继续推进到新分叉"],
    ),
    turn(
      "integration-boundary",
      "集成风险优先，必须保留可关闭回退。",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "集成风险优先，必须保留可关闭回退。",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v5`,
      }),
      askPacket({
        sessionId: mainSessionId,
        id: "q_integration",
        title: "锁集成边界",
        question: "PathTracing 与现有渲染主链怎样共存？",
        node: "integration_boundary",
        strength: "dive",
        treeDepth: 5,
        qaRoundCount: 5,
        choices: [
          { id: "incremental", label: "增量接入", description: "保留现有主链" },
          { id: "replace", label: "替换主链", description: "统一走新路径" },
        ],
      }),
      "锁集成边界：PathTracing 与现有渲染主链怎样共存？",
      ["把集成边界留给用户决定", "不把现有项目事实推回用户"],
    ),
    turn(
      "scene-data-contract",
      "增量接入，先不替换现有主链，通过功能开关逐步启用。",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "增量接入，先不替换现有主链，通过功能开关逐步启用。",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v6`,
      }),
      askPacket({
        sessionId: mainSessionId,
        id: "q_scene_data",
        title: "锁数据合同",
        question: "场景、材质和相机数据按哪种合同接入？",
        node: "api_data_contract",
        strength: "dive",
        treeDepth: 6,
        qaRoundCount: 6,
        choices: [
          { id: "existing", label: "沿用状态源", description: "适配既有场景数据" },
          { id: "snapshot", label: "渲染快照", description: "建立独立消费快照" },
        ],
      }),
      "锁数据合同：场景、材质和相机数据按哪种合同接入？",
      ["明确数据所有权", "保持真实项目集成目标"],
    ),
    turn(
      "resource-budget",
      "沿用现有应用状态源，通过适配层消费，不复制应用状态源。",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "沿用现有应用状态源，通过适配层消费，不复制应用状态源。",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v7`,
      }),
      askPacket({
        sessionId: mainSessionId,
        id: "q_resource_budget",
        title: "锁资源预算",
        question: "资源和交互预算优先保护什么？",
        node: "resource_budget",
        strength: "dive",
        treeDepth: 7,
        qaRoundCount: 7,
        choices: [
          { id: "responsive", label: "交互响应", description: "优先保持操作流畅" },
          { id: "quality", label: "画质稳定", description: "优先保持采样质量" },
        ],
      }),
      "锁资源预算：资源和交互预算优先保护什么？",
      ["资源取舍由用户决定", "保留回退边界"],
    ),
    turn(
      "benchmark-profile",
      "优先保持交互响应，资源接近上限时降低路径追踪负担。",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "优先保持交互响应，资源接近上限时降低路径追踪负担。",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v8`,
      }),
      askPacket({
        sessionId: mainSessionId,
        id: "q_benchmark_profile",
        title: "锁基线口径",
        question: "性能基线按哪类真实负载和设备档位取样？",
        node: "benchmark_workload",
        strength: "dive",
        treeDepth: 8,
        qaRoundCount: 8,
        choices: [
          { id: "interactive", label: "交互目标设备", description: "反映真实使用压力" },
          { id: "static", label: "静态兼容下限", description: "优先覆盖更广设备" },
        ],
      }),
      "锁基线口径：性能基线按哪类真实负载和设备档位取样？",
      ["性能口径是材料验收分叉", "不把 benchmark 工具细节推回用户"],
    ),
    turn(
      "compatibility-envelope",
      "用交互场景和目标设备档位。",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "用交互场景和目标设备档位。",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v9`,
      }),
      askPacket({
        sessionId: mainSessionId,
        id: "q_compatibility",
        title: "锁兼容范围",
        question: "兼容与发布验证最少覆盖什么？",
        node: "compatibility_envelope",
        strength: "dive",
        treeDepth: 9,
        qaRoundCount: 9,
        choices: [
          { id: "both", label: "旧新两路", description: "覆盖既有和新渲染路径" },
          { id: "new", label: "新路径优先", description: "重点验证新能力" },
        ],
      }),
      "锁兼容范围：兼容与发布验证最少覆盖什么？",
      ["明确兼容性验收", "不压缩成演示范围"],
    ),
    turn(
      "change-control",
      "覆盖现有调用方和新渲染路径的相关回归。",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "覆盖现有调用方和新渲染路径的相关回归。",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v10`,
      }),
      askPacket({
        sessionId: mainSessionId,
        id: "q_change_control",
        title: "锁交付顺序",
        question: "交付前的变更控制最先看哪类证据？",
        node: "change_control",
        strength: "dive",
        treeDepth: 10,
        qaRoundCount: 10,
        choices: [
          { id: "visual", label: "画质优先", description: "先确认真实渲染结果" },
          { id: "runtime", label: "运行优先", description: "先确认性能与回归" },
        ],
      }),
      "锁交付顺序：交付前的变更控制最先看哪类证据？",
      ["完成 dive 材料 frontier", "为 Task Card 提供验收优先级"],
    ),
    turn(
      "you-decide-task-card",
      "先看画质结果，再看性能和回归；画质偏差和运行边界都进入证据包；具体技术路线你决定，优先用最稳方式。",
      transitionPacket(
        "C_ASK",
        "C_TASK_CARD",
        "先看画质结果，再看性能和回归；画质偏差和运行边界都进入证据包；具体技术路线你决定，优先用最稳方式。",
        11,
        skillRef,
        "dive",
      ),
      taskCardPacket(),
      "确认后台任务：完整 Three.js PathTracing 引擎",
      ["用户说你决定时记录 agent-owned assumption", "C_TASK_CARD 带完整 transcript"],
    ),
    turn(
      "task-card-confirm",
      "确认 Task Card，进入 Goal Card",
      transitionPacket(
        "C_TASK_CARD",
        "C_GOAL_CARD",
        "确认 Task Card，进入 Goal Card",
        12,
        skillRef,
      ),
      goalCardPacket(),
      "确认线性目标拆分：8 个可验证目标",
      ["Task Card 确认后进入 C_GOAL_CARD", "Goal Card 带 transcript 和 approved CEO Task Card"],
    ),
    turn(
      "goal-card-confirm",
      "确认 Goal Card，注册后台任务",
      transitionPacket("C_GOAL_CARD", "C_REGISTER", "确认 Goal Card，注册后台任务", 13, skillRef),
      registerPacket(),
      "已注册后台任务：完整 Three.js PathTracing 引擎",
      ["Goal Card 确认后进入注册", "不暴露 provider/session internals"],
    ),
  ];

  const auxiliaryTurns: ClarifyUserSimulationTurn[] = [
    turn(
      "stop-clarify-enough",
      "够了，不要再问，按刚才整理 Task Card",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "够了，不要再问，按刚才整理 Task Card",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v5`,
      }),
      stopClarifyTaskCardPacket(),
      "确认后台任务：完整 Three.js PathTracing 引擎",
      ["用户说够了时停止 Clarify", "按已有 transcript 出 Task Card"],
    ),
    turn(
      "unclear-acceptance",
      "注册个后台任务，把设置页整理一下",
      buildClarifySessionStartInputPacket({
        sessionId: "sec_user_sim_acceptance",
        currentState: "C_DIRECT",
        userInput: "注册个后台任务，把设置页整理一下",
        clarify: "balanced",
        effectiveClarify: "balanced",
        mode: "loop",
        loop: "balanced",
        skillRef,
      }),
      askPacket({
        sessionId: "sec_user_sim_acceptance",
        id: "q_acceptance_settings",
        title: "先锁验收",
        question: "整理到什么证据出现，才算这任务完成？",
        node: "acceptance_boundary",
        choices: [
          { id: "screens", label: "截图通过", description: "关键页面可核对" },
          { id: "tests", label: "测试通过", description: "门禁能证明" },
        ],
        extraQuestions: [
          {
            id: "q_acceptance_settings_surface",
            question: "这次验收最先覆盖哪个设置入口？",
            node: "settings_surface",
            choices: [
              { id: "desktop", label: "桌面入口", description: "覆盖常用桌面路径" },
              { id: "mobile", label: "移动入口", description: "覆盖移动布局与操作" },
            ],
          },
        ],
      }),
      "先锁验收：整理到什么证据出现，才算这任务完成？",
      ["验收不清时问验收", "不问可发现事实"],
    ),
    turn(
      "risk-delete-boundary",
      "清掉这个仓库里没用的东西，越快越好",
      buildClarifySessionStartInputPacket({
        sessionId: cleanupSessionId,
        currentState: "C_DIRECT",
        userInput: "清掉这个仓库里没用的东西，越快越好",
        clarify: "balanced",
        effectiveClarify: "balanced",
        mode: "loop",
        loop: "balanced",
        skillRef,
      }),
      askPacket({
        sessionId: cleanupSessionId,
        id: "q_cleanup_boundary",
        title: "先定边界",
        question: "这次清理最该优先保护哪条边界？",
        node: "risk_resource_boundary",
        choices: [
          { id: "audit", label: "先出清单", description: "确认后再删除" },
          { id: "safe", label: "安全清理", description: "先排除成果" },
          { id: "space", label: "最大释放", description: "先标高占用项" },
        ],
      }),
      "先定边界：这次清理最该优先保护哪条边界？",
      ["删除风险先问边界", "不默认删除"],
    ),
    turn(
      "contradictory-demand",
      "不要改代码，但把这个 bug 修好并跑通",
      buildClarifySessionStartInputPacket({
        sessionId: conflictSessionId,
        currentState: "C_DIRECT",
        userInput: "不要改代码，但把这个 bug 修好并跑通",
        clarify: "balanced",
        effectiveClarify: "balanced",
        mode: "loop",
        loop: "balanced",
        skillRef,
      }),
      askPacket({
        sessionId: conflictSessionId,
        id: "q_conflict",
        title: "先解冲突",
        question: "“不改代码”和“修好”冲突，按哪条边界走？",
        node: "contradiction_resolution",
        choices: [
          { id: "diagnose", label: "只诊断", description: "不改文件给证据" },
          { id: "patch", label: "允许修复", description: "最小改动并验证" },
        ],
      }),
      "先解冲突：“不改代码”和“修好”冲突，按哪条边界走？",
      ["矛盾需求只问一个决策", "不擅自改目标"],
    ),
  ];

  const repairOutputPacket = turns.find((turn) => turn.id === "branch-choice-answer")!.outputPacket;
  const malformedRepairOutput = {
    ...repairOutputPacket,
    ui: {
      kind: "clarify_card",
      title: repairOutputPacket.ui.title,
    },
  };

  return {
    sessionId: mainSessionId,
    transcriptVerbatim,
    approvedCeoTaskCardVerbatim,
    turns,
    auxiliaryTurns,
    repairPacket: buildClarifyRepairInputPacket({
      sessionId: mainSessionId,
      previousState: "C_ASK",
      intendedOutputState: "C_ASK",
      clarify: "dive",
      effectiveClarify: "dive",
      mode: "loop",
      loop: "balanced",
      badOutput: JSON.stringify(malformedRepairOutput),
      schemaErrors: ["C_ASK packets must include a valid ui.question_card"],
      transitionErrors: [],
      skillRef,
    }),
    // Repair restores the exact existing frontier card after a malformed copy; it must not
    // invent a fresh user decision while repairing shape/state/provenance.
    repairOutputPacket,
  };
}

export function validateClarifyUserSimulationReport(
  report: ClarifyUserSimulationReport,
): ClarifyUserSimulationValidation {
  const failures: string[] = [];
  const allTurns = [...report.turns, ...report.auxiliaryTurns];
  const requiredTurnIds = [
    "hi",
    "vague-large-task",
    "threejs-pathtracing",
    "branch-choice-answer",
    "note-only-answer",
    "you-decide-task-card",
    "stop-clarify-enough",
    "unclear-acceptance",
    "risk-delete-boundary",
    "contradictory-demand",
    "task-card-confirm",
    "goal-card-confirm",
  ];

  for (const id of requiredTurnIds) {
    if (!allTurns.some((turn) => turn.id === id)) {
      failures.push(`missing user simulation turn: ${id}`);
    }
  }

  for (const turn of allTurns) {
    const inputParse = ClarifyProviderRuntimeInputPacketSchema.safeParse(turn.inputPacket);
    if (!inputParse.success) {
      failures.push(`${turn.id}: input packet failed schema validation`);
    }
    const controls = "controls" in turn.inputPacket ? turn.inputPacket.controls : undefined;
    if (controls && (!controls.clarify_strength || !controls.effective_clarify_strength)) {
      failures.push(`${turn.id}: input packet must carry clarify controls`);
    }
    if (!controls && turn.inputPacket.type !== "clarify_repair") {
      failures.push(`${turn.id}: input packet missing clarify controls`);
    }
    const outputParse = ClarifyRuntimePacketSchema.safeParse(turn.outputPacket);
    if (!outputParse.success) {
      failures.push(`${turn.id}: output packet failed schema validation`);
    }
    if (
      turn.outputPacket.code === "C_TASK_CARD" &&
      !ThothSubmitTaskCardInputSchema.safeParse(turn.outputPacket.content).success
    ) {
      failures.push(`${turn.id}: C_TASK_CARD content failed semantic tool schema validation`);
    }
    const inputJson = JSON.stringify(turn.inputPacket);
    if (inputJson.includes("## State Codes") || inputJson.includes("## Transition Rules")) {
      failures.push(`${turn.id}: input packet repeats full Skill rules`);
    }
    if (turn.inputPacket.type === "clarify_turn" && "skill_ref" in turn.inputPacket) {
      failures.push(`${turn.id}: normal turn must not include skill_ref`);
    }
    if (
      turn.inputPacket.type !== "clarify_turn" &&
      !("skill_ref" in turn.inputPacket) &&
      turn.id !== "hi"
    ) {
      failures.push(`${turn.id}: transition/session packet must include skill_ref`);
    }
    for (const internal of [CLARIFY_SKILL_ID, "skill_ref", "C_ASK", "C_TASK_CARD", "provider"]) {
      if (turn.uiProjection.includes(internal)) {
        failures.push(`${turn.id}: UI projection leaks internal marker ${internal}`);
      }
    }
  }

  let previousTranscriptVersion = -1;
  for (const turn of report.turns) {
    const transcriptRef = (turn.inputPacket as { transcript_ref?: unknown }).transcript_ref;
    if (typeof transcriptRef !== "string") {
      continue;
    }
    const match = /:v(\d+)$/.exec(transcriptRef);
    if (!match) {
      failures.push(`${turn.id}: transcript_ref must end with a numeric version`);
      continue;
    }
    const version = Number(match[1]);
    if (version < previousTranscriptVersion) {
      failures.push(`${turn.id}: transcript_ref version must not move backwards`);
    }
    previousTranscriptVersion = Math.max(previousTranscriptVersion, version);
  }

  const taskTurn = report.turns.find((turn) => turn.id === "you-decide-task-card");
  const goalTurn = report.turns.find((turn) => turn.id === "task-card-confirm");
  const taskProvenance = taskTurn ? packetProvenance(taskTurn.outputPacket) : undefined;
  const goalProvenance = goalTurn ? packetProvenance(goalTurn.outputPacket) : undefined;
  const transcriptInputs = new Set(
    report.transcriptVerbatim.split("\n").flatMap((line) => {
      const match = /^(?:User|A): (.+)$/u.exec(line);
      return match ? [match[1]] : [];
    }),
  );
  const taskTurnIndex = report.turns.findIndex((turn) => turn.id === "you-decide-task-card");
  for (const turn of report.turns.slice(0, taskTurnIndex + 1)) {
    if (!transcriptInputs.has(turn.userInput)) {
      failures.push(`${turn.id}: C_TASK_CARD transcript does not preserve user input verbatim`);
    }
  }
  const clarifiedQuestionTexts = report.turns.flatMap((turn) => {
    if (turn.outputPacket.code !== "C_ASK") {
      return [];
    }
    const questions = (
      turn.outputPacket.content.question_card as { questions?: unknown } | undefined
    )?.questions;
    return Array.isArray(questions)
      ? questions.flatMap((question) =>
          typeof question === "object" &&
          question !== null &&
          typeof (question as { question?: unknown }).question === "string"
            ? [(question as { question: string }).question]
            : [],
        )
      : [];
  });
  for (const question of clarifiedQuestionTexts) {
    if (!report.transcriptVerbatim.includes(`Q: ${question}`)) {
      failures.push(`Clarify transcript omits asked question: ${question}`);
    }
  }
  if (
    taskTurn?.outputPacket.code !== "C_TASK_CARD" ||
    taskProvenance?.clarify_transcript_verbatim !== report.transcriptVerbatim
  ) {
    failures.push("C_TASK_CARD must carry full simulation transcript verbatim");
  }
  if (
    goalTurn?.outputPacket.code !== "C_GOAL_CARD" ||
    goalProvenance?.clarify_transcript_verbatim !== report.transcriptVerbatim ||
    goalProvenance?.approved_ceo_task_card_verbatim !== report.approvedCeoTaskCardVerbatim
  ) {
    failures.push("C_GOAL_CARD must carry transcript plus approved CEO Task Card verbatim");
  }

  if (
    report.repairPacket.type !== "clarify_repair" ||
    !report.repairPacket.repair_instruction.includes("repair packet shape only") ||
    !report.repairPacket.repair_instruction.includes("do not reinterpret user intent") ||
    !report.repairPacket.repair_instruction.includes("do not fabricate transcript") ||
    !report.repairPacket.repair_instruction.includes("do not change approved CEO Task Card")
  ) {
    failures.push("repair packet must repair shape/provenance only without semantic changes");
  }
  const repairOutput = ClarifyRuntimePacketSchema.safeParse(report.repairOutputPacket);
  if (!repairOutput.success || report.repairOutputPacket.code !== "C_ASK") {
    failures.push("repair evidence must include a schema-valid repaired output packet");
  }

  const mainDiveCards = report.turns.filter(
    (turn) =>
      turn.outputPacket.code === "C_ASK" &&
      turn.outputPacket.content.meta &&
      (turn.outputPacket.content.meta as { effective_clarify_strength?: unknown })
        .effective_clarify_strength === "dive",
  );
  if (mainDiveCards.length < 10) {
    failures.push(
      "dive user simulation must cover at least 10 material Clarify cards before Task Card",
    );
  }
  for (const turn of allTurns) {
    if (turn.outputPacket.code !== "C_ASK") {
      continue;
    }
    const questions = (
      turn.outputPacket.content.question_card as { questions?: unknown } | undefined
    )?.questions;
    if (
      Array.isArray(questions) &&
      questions.some(
        (question) =>
          typeof question === "object" &&
          question !== null &&
          typeof (question as { question?: unknown }).question === "string" &&
          (question as { question: string }).question.includes("谁来定"),
      )
    ) {
      failures.push(`${turn.id}: C_ASK must not push assumption ownership back to the user`);
    }
  }

  const registeredTurn = report.turns.find((turn) => turn.id === "goal-card-confirm");
  if (
    JSON.stringify(registeredTurn?.outputPacket.content.goals_card) !==
    JSON.stringify(goalTurn?.outputPacket.content.goals_card)
  ) {
    failures.push("C_REGISTER must preserve the complete approved linear Goals Card");
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
