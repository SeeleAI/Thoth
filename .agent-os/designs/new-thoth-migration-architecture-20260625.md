# New Thoth: Migration Control Plane Architecture

## Status

- Date: `2026-06-25`
- Scope: 将用户本轮关于“全新版本 Thoth”的原始目标、输入、参考资料、调研结论与当前设计方案压缩沉淀为单一详细文档
- Nature: planning/design artifact, no implementation in this document
- Intended follow-up: feed `TD-003` and future `MS-004` design freeze / migration planning

## 1. 原始用户目标与输入

本轮用户要做的不是现有 Thoth 的小修小补，而是一个“完全全新版本”的 `Thoth`。目标不是追随某一代 harness，而是从未来 `5` 年仍然能成立的价值出发，最大程度减少人的心智负担。

用户明确给出的目标与约束如下。

### 1.1 顶层目标

1. 从结果倒推，设计一个未来 `5` 年后仍然有作用的 `Thoth`
2. 以“最大程度减少人的心智负担”为第一原则
3. 让 Thoth 更像“数字员工 / digital employee control plane”，而不是某个单一 coding agent 的 UI 包装

### 1.2 产品形态要求

1. 同时有 `TUI` 和 `APP` 两种形态
2. 底层接口必须完全一致
3. `UI` 只是壳，不能拥有自己的业务语义
4. `TUI` 明确要求使用 `OpenTUI`
5. `APP` 形态当时尚未拍板，需要结合参考项目调研后给出建议

### 1.3 用户入口与工作方式

1. 用户入口包括：
   - 各个 workspace 下开启对话
   - 一个全局 chat
2. 用户可以像对数字员工一样，直接把需求、想法、背景一股脑说出来
3. Thoth 负责主动拆解、追问、澄清，而不是要求用户事先写好结构化 prompt
4. 澄清重点必须放在：
   - 假设
   - 目标
   - 约束
   - 验收标准
5. 只有当任务被拆清楚之后，才注册成一个任务，类似 `issue`
6. 一旦注册，后续交给固定 role 的 agent 异步执行
7. 用户不关心具体执行时间，希望像“老板给数字员工下发任务”一样
8. 用户睡觉时，AI 也应该继续运行

### 1.4 Loop 要求

1. 执行者要建立在“当前 loop engineering”的概念上
2. 注册任务时，本质上也是在注册一个 `loop`
3. 任务不是一次 turn，而是一个可长期运行、可恢复、可审查的 loop contract

### 1.5 多端同步要求

1. APP 端需要类似 `Paseo`
2. 手机端和电脑端需要能够同步 session 和进度
3. 用户希望远程查看、远程跟进、远程批准，而不要求完整桌面开发体验搬到手机

### 1.6 宿主无关要求

用户明确要求新 Thoth 宿主无关，至少要能支持：

- `cc` / Claude Code
- `codex`
- `opencode`
- `hermes`
- `openclaw`
- `qwencode` / QwenCode 一类 harness

这里的要求不是“表面支持”，而是要真正理解：

1. 如何做到 agent / harness 工具无关
2. 如何接这么多 harness
3. role 分配怎么做
4. prompt engineering 怎么做

### 1.7 生命周期与对抗要求

用户明确要求每个任务生命周期至少有三个独立阶段，而且每个阶段都应该是独立 role、独立 session，并且要有对抗。

至少包含：

1. 向用户澄清需求、假设、引导用户的阶段
2. 执行任务 loop 的阶段
3. 审查、验证、反思的阶段

用户强调：

- 每个阶段都应该是独立 role 设计
- 每个阶段都应该是独立 session
- 必须有对抗，不要把“执行者自评为成功”当成系统成功

### 1.8 用户要求重点讨论和调研的点

用户要求重点讨论与设计：

1. 所有的预设 prompt
2. 记忆和上下文设计
3. 如何做到宿主无关
4. 如何做到多端同步
5. 如何做到多阶段间的上下文和记忆
6. 架构设计

### 1.9 用户给出的参考资料与关注重点

#### 参考一：数字员工 / 多 harness / agent 控制面

- Upstream: `https://github.com/multica-ai/multica`
- 本地 clone: `<harness-workspace>/multica`
- 本地 HEAD: `343ace8`

用户要求重点看：

1. 如何做到 agent、harness 工具无关
2. 如何调用这么多 harness 工具
3. role 分配
4. prompt engineering

#### 参考二：APP 远程 / 手机同步 / 多 provider / 多平台打包

- Upstream: `https://github.com/getpaseo/paseo`
- 本地 clone: `<harness-workspace>/paseo`
- 本地 HEAD: `507345d`

用户要求重点看：

1. 如何做到支持这么多 harness 工具
2. 如何做到 Windows、macOS、Android、iOS 都能打包出 app
3. 用的是什么框架
4. 多端同步怎么做

#### 参考三：TUI 方案

- Skill path: `<codex-skills>/opentui`
- 核心 docs:
  - `<codex-skills>/opentui/docs/getting-started.mdx`
  - `<codex-skills>/opentui/docs/bindings/react.mdx`

用户明确要求：

- `TUI` 用 `OpenTUI`

## 2. 当前 Thoth 基线

本设计不是完全脱离当前仓库状态的空想，必须从当前 Thoth 已经收敛出来的长期有效部分出发。

依据当前仓库状态文档，现有 Thoth 已经形成以下几个重要基线：

1. `.thoth/objects` 作为 authority 的基本方向已经成立
2. `work_id@revision`、`run`、`controller`、`phase_result`、`artifact` 的执行模型已经存在
3. `run` 的固定阶段链已经收敛为 `plan -> execute -> validate -> reflect`
4. `auto` 已经不是一次性命令，而是 durable controller worker service
5. `Observe` 已经明确为 authority 的只读派生层
6. `argue` 已经引入 attacker / adjudicator 这种对抗思路
7. 当前仓库已经开始区分：
   - authority truth
   - runtime ledger
   - read model / docs / dashboard

当前仓库的基线事实可见 [architecture-milestones.md](<thoth-repo>/.agent-os/architecture-milestones.md:16) 与 [todo.md](<thoth-repo>/.agent-os/todo.md:19)。

对 new Thoth 有长期价值、建议继承的部分：

1. `work_item` 作为任务 authority 的核心单位
2. `acceptance_spec` 作为验收真相的中心
3. `run` 与 `controller/loop` 分层
4. `Observe` 只读、不得偷偷修 authority
5. `argue` / adversarial review 的系统化入口
6. 宿主 adapter 与 runtime truth 分离

对 new Thoth 需要明显升级或替换的部分：

1. 入口不能再以命令为中心，而要以 conversation / digital employee intake 为中心
2. 生命周期不能只停留在 `plan/execute/validate/reflect`，还要把“澄清与冻结合同”显式抬到执行前
3. 当前 TUI / dashboard / host projection 更像 tool surface；new Thoth 需要统一 daemon protocol 下的多壳客户端
4. 当前宿主主要围绕 Claude/Codex；new Thoth 要提升到 harness-neutral driver layer

## 3. 参考资料调研结论

### 3.1 Multica：值得吸收的部分

#### 3.1.1 产品定位

Multica 把 coding agent 当成真正“同事 / teammate”，而不是一次性的 prompt runner。

它强调：

1. `Agents as Teammates`
2. `Squads`
3. `Autonomous Execution`
4. `Autopilots`
5. `Reusable Skills`
6. `Unified Runtimes`
7. `Multi-Workspace`

见 [Multica README](<harness-workspace>/multica/README.md:30)。

这与用户想要的“数字员工”方向高度一致。

#### 3.1.2 多 harness 支持的真实方式

Multica 的 provider matrix 非常重要，因为它说明“宿主无关”不是把差异消掉，而是把差异限制在 adapter/capability 层。

它明确支持多个工具，但文档同时强调：

1. 它们都实现同一个上层接口
2. 但 capability 细节差异非常大
3. 差异包括：
   - session resumption
   - MCP 支持
   - skill 注入路径
   - model 选择

见 [providers.mdx](<harness-workspace>/multica/apps/docs/content/docs/providers.mdx:8)。

这意味着：

1. 新 Thoth 不能假装所有 harness 一样
2. 必须有 capability matrix
3. 必须把 provider-specific 行为收敛进 driver adapter

#### 3.1.3 技术实现层的统一接口

Multica 在 `server/pkg/agent/agent.go` 中定义了一个简洁但有效的统一接口：

1. `Backend.Execute(ctx, prompt, opts)`
2. `ExecOptions` 包含：
   - `Cwd`
   - `Model`
   - `SystemPrompt`
   - `ThreadName`
   - `MaxTurns`
   - `Timeout`
   - `SemanticInactivityTimeout`
   - `ResumeSessionID`
   - `ExtraArgs`
   - `CustomArgs`
   - `McpConfig`
   - `ThinkingLevel`
   - `OpenclawMode`
3. `Session` 提供：
   - `Messages <-chan Message`
   - `Result <-chan Result`

见 [agent.go](<harness-workspace>/multica/server/pkg/agent/agent.go:15)。

这说明上层语义上至少需要统一：

1. 执行入口
2. session resume
3. streaming
4. final result
5. MCP/materialization
6. reasoning/effort
7. provider-specific runtime knobs

#### 3.1.4 对宿主配置文件的处理方式

Multica 在 `runtime_config.go` 里做了一个非常关键的设计：

1. 不直接覆盖用户仓库已有的 `AGENTS.md` / `CLAUDE.md`
2. 用 marker block 注入自己管理的 runtime brief
3. 下次运行时做 idempotent replace
4. 清理时恢复用户原始文件字节级状态

并且它明确区分：

1. Claude / CodeBuddy 写 `CLAUDE.md`
2. Codex / Copilot / OpenCode / OpenClaw / Hermes / Pi / Cursor / Kimi / Kiro / Antigravity / Qoder 写 `AGENTS.md`

见 [runtime_config.go](<harness-workspace>/multica/server/internal/daemon/execenv/runtime_config.go:156)。

这对新 Thoth 的启示是：

1. 宿主无关不等于“一个统一文件”
2. 应该在 driver 层 materialize provider-native context
3. 永远不要粗暴覆盖用户已有的 repo-local 指令文件
4. 注入与 cleanup 要成对设计

### 3.2 Multica：不应直接照搬的部分

1. 它更强在任务队列、issue board、runtime dispatch
2. 但它的“需求澄清 -> 验收冻结 -> authority graph”不是核心护城河
3. 对用户来说，它更像 managed agents platform，而不是“把模糊老板意图编译成 loop contract 的系统”

因此：

1. 任务板 / runtime / agent teammate 模型值得吸收
2. 但 new Thoth 的核心不能落在“issue board”
3. Thoth 的真正价值应该在 `clarification compiler + acceptance compiler + loop controller + evidence authority`

### 3.3 Paseo：值得吸收的部分

#### 3.3.1 架构分层

Paseo 的总体结构非常清楚：

1. `daemon`
2. `app`（Expo）
3. `cli`
4. `desktop`（Electron）
5. `relay`
6. `protocol`
7. `client`

而且所有客户端都围绕同一个 daemon 与 protocol 展开。

见 [architecture.md](<harness-workspace>/paseo/docs/architecture.md:3)。

这对新 Thoth 的启示非常直接：

1. `TUI` 和 `APP` 不应该是两套产品
2. 它们应该是同一个 `thothd` 的两个 client
3. 业务语义必须归 daemon / authority / protocol 持有

#### 3.3.2 多 provider 的抽象方式

Paseo 区分两种 provider integration pattern：

1. `ACP` provider：
   - 推荐
   - 复用 `ACPAgentClient`
   - 基类处理 process spawn、stdio transport、session lifecycle、streaming、permissions、model discovery
2. `Direct` provider：
   - 直接实现 `AgentClient` 和 `AgentSession`
   - 完全自己管 process、stream、permission、history、session persistence

见 [providers.md](<harness-workspace>/paseo/docs/providers.md:5)。

这说明新 Thoth 最合理的做法不是发明“超级统一 provider 标准”，而是：

1. 对支持 ACP 的 harness，走 ACP adapter
2. 对强个性的 provider，走 direct adapter
3. 上层只消费统一 session/timeline/permission/capability 接口

#### 3.3.3 AgentClient / AgentSession 模型

Paseo 的 direct provider checklist 中展示了两个非常实用的抽象：

1. `AgentClient`
   - createSession
   - resumeSession
   - fetchCatalog
   - listImportableSessions
   - importSession
   - isAvailable
2. `AgentSession`
   - run
   - startTurn
   - subscribe
   - streamHistory
   - getRuntimeInfo
   - getAvailableModes
   - getCurrentMode
   - setMode
   - getPendingPermissions
   - respondToPermission
   - describePersistence
   - interrupt
   - close

见 [providers.md](<harness-workspace>/paseo/docs/providers.md:321)。

这个抽象比 Multica 更适合 new Thoth，因为 new Thoth 不只是“派发任务”，而是要真正跨阶段管理 session、permission、history、resume、review。

#### 3.3.4 Timeline sync 不变量

Paseo 的 `timeline-sync.md` 有一个必须吸收的不变量：

1. live stream 只负责 immediacy
2. authoritative history 负责 correctness
3. presence 不是 delivery
4. catch-up 可以分页，但必须完整
5. resume 时如果有 cursor，就从 cursor 后补完，而不是简单拉 tail

见 [timeline-sync.md](<harness-workspace>/paseo/docs/timeline-sync.md:3)。

这个设计非常关键，因为新 Thoth 的 loop 很可能是长时间后台运行，手机端/桌面端/TUI 反复 attach/detach，如果没有这个不变量，就会出现：

1. 中间阶段消息丢失
2. 权限卡点不可见
3. 最终报告与中间 timeline 对不上

#### 3.3.5 Agent lifecycle / subagent / archive

Paseo 对 agent lifecycle 的处理也值得参考：

1. agent 有明确状态：
   - `initializing`
   - `idle`
   - `running`
   - `error`
   - `closed`
2. agent 可以有：
   - `subagent`
   - `detached`
3. archive 是 global lifecycle action，不是单 client 行为
4. tab 关闭与 archive 解耦

见 [agent-lifecycle.md](<harness-workspace>/paseo/docs/agent-lifecycle.md:5)。

这给新 Thoth 的启发是：

1. role session / subagent session 必须是 lifecycle object
2. UI 里的关闭视图不等于销毁任务
3. review/verifier/adversary 可以是 `subagent-like` session，但 authority 仍归任务系统

#### 3.3.6 APP 与 Desktop 技术路线

Paseo 的现有实现已经验证了一条现实可行的技术路线：

1. `packages/app` 用 `Expo`
2. 覆盖：
   - iOS
   - Android
   - Web
3. `packages/desktop` 用 `Electron`
4. 用 `electron-builder` 产出：
   - macOS: `dmg` / `zip`
   - Linux: `AppImage` / `deb` / `rpm` / `tar.gz`
   - Windows: `nsis` / `zip`

见 [package.json](<harness-workspace>/paseo/packages/app/package.json:7) 与 [electron-builder.yml](<harness-workspace>/paseo/packages/desktop/electron-builder.yml:27)。

这说明对新 Thoth 来说：

1. APP 路线优先选 `Expo React Native`
2. Desktop 路线优先选 `Electron`
3. 不要先在 APP 技术栈上发明新轮子

### 3.4 Paseo：不应直接照搬的部分

1. Paseo 的 authority 主要是 daemon session / timeline / runtime state
2. 它天然理解的是“agent session”，不是 `.thoth` authority graph
3. 它并不原生理解：
   - `work_id@revision`
   - `acceptance_spec`
   - `phase_result`
   - `validate.passed`
   - `artifact provenance`

因此：

1. Paseo 的 protocol、provider adapter、多端同步值得吸收
2. 但 Thoth 不能把自己的 authority 退化成“只是一个更漂亮的 agent session manager”

### 3.5 OpenTUI：值得吸收的部分

OpenTUI 的角色很明确：

1. 它是高性能 TUI renderer/core
2. Zig native core + TypeScript bindings
3. 可以从 React binding 构建 TUI
4. 提供：
   - layout
   - input
   - diff/code/markdown
   - keyboard hooks

见 [getting-started.mdx](<codex-skills>/opentui/docs/getting-started.mdx:13) 与 [react.mdx](<codex-skills>/opentui/docs/bindings/react.mdx:10)。

但它也有运行时现实：

1. 真正创建 native renderer 时需要 FFI
2. 文档主路径更偏 Bun / Node 26.3 + experimental FFI

这意味着新 Thoth 应该：

1. 用 OpenTUI 做 TUI 壳
2. 不让 daemon/core 依赖 OpenTUI runtime
3. 把 TUI 作为单独 client package

## 4. 当前方案的核心判断

### 4.1 new Thoth 的真正护城河

未来 `5` 年内，最不容易被 harness 替代的不是“执行能力”，而是以下能力：

1. `clarification compiler`
2. `acceptance compiler`
3. `durable authority graph`
4. `loop controller`
5. `multi-role adversarial lifecycle`
6. `evidence/provenance ledger`
7. `host-neutral driver layer`
8. `multi-device evidence cockpit`

换句话说：

- 执行 agent 会越来越强
- 单次对话也会越来越强
- 真正稀缺的是“把老板含混目标稳定编译成可恢复、可验证、可审计 loop contract”的系统

### 4.2 新 Thoth 不是这些东西

新 Thoth 不应该定位成：

1. 另一个 coding agent
2. 另一个 IDE
3. 一个漂亮的 log viewer
4. 一个只支持单宿主的 plugin
5. 一个以手工 prompt 为核心使用方式的工具

### 4.3 新 Thoth 应该是什么

新 Thoth 应该是：

1. `digital employee control plane`
2. `clarification-to-loop compiler`
3. `validator-first orchestration system`
4. `authority + timeline + artifact + report` 的统一真相持有者

## 5. 产品体验目标

### 5.1 用户最理想的体验

1. 用户打开 workspace chat 或 global chat
2. 用户直接描述目标、想法、背景、顾虑
3. Thoth 主动澄清
4. Thoth 把任务冻结成结构化合同
5. 用户只在高风险 / 高影响 / 不可逆决策点拍板
6. Thoth 异步执行
7. 手机、桌面、TUI 都能看到同一任务的进展
8. 完成后 Thoth 给老板式汇报，而不是一堆 agent chatter

### 5.2 用户不应该承担的心智负担

用户不应该被迫管理：

1. provider 差异
2. session resume
3. MCP 注入
4. skill path
5. 具体 prompt 写法
6. 哪个 agent 看了哪些上下文
7. 哪条日志才是关键
8. 是否应该重试
9. 现在该看哪个 run

用户应该主要管理：

1. 目标
2. 边界
3. 风险
4. 验收
5. 必要拍板

## 6. 推荐的 new Thoth 顶层架构

建议把新 new Thoth 划分为以下几个一级模块。

### 6.1 Protocol

职责：

1. 定义所有客户端与 daemon 的统一协议
2. 固化 request/response/event schema
3. 固化 timeline item、permission、artifact summary、report summary

要求：

1. `TUI` / `APP` / `CLI` / `Desktop` 全部使用同一 protocol
2. UI 不得绕过 daemon 直接写 `.thoth`

### 6.2 Daemon

建议名：`thothd`

职责：

1. 本机 authority server
2. 管理 workspace、task、loop、role session、provider session
3. commit timeline / event log
4. broadcast live stream
5. 提供 history catch-up
6. 提供 permission/approval/decision 接口
7. 提供 relay / pairing / notification

### 6.3 Authority Store

职责：

1. 维护 durable truth
2. 支持恢复、审计、read model 重建

建议形态：

1. append-only event log
2. object snapshots
3. read-model projections

推荐持久化组合：

1. daemon 本地使用 `SQLite`
2. workspace 下保留 `.thoth/objects` / `.thoth/events` / `.thoth/artifacts` 可审计导出

### 6.4 Clarification Compiler

职责：

1. 从自然语言 conversation 中提取结构化任务
2. 跟踪假设、冲突、open questions
3. 形成 `work_item + acceptance_spec + loop_contract`

这是新 Thoth 的核心护城河之一。

### 6.5 Loop Controller

职责：

1. 任务注册即 loop 注册
2. 控制每轮执行：
   - 继续
   - 重试
   - 切换 driver
   - 进入验证
   - 升级给用户
   - 停止
3. 不能让 executor 自己判定任务最终成功

### 6.6 Role Session Runtime

职责：

1. 为不同 phase 提供独立 role session
2. 用结构化 context packet 代替全历史对话注入
3. 保持 role 间隔离，同时通过 handoff artifact 连接

### 6.7 Harness Driver Layer

职责：

1. 把 Claude Code、Codex、OpenCode、Hermes、OpenClaw、QwenCode 等抽象成统一上层接口
2. 差异收敛到 capability matrix 与 adapter

### 6.8 Observe / Sync / UI Shells

职责：

1. 提供：
   - TUI
   - APP
   - Desktop
   - CLI
2. 它们只消费 protocol 与 read models
3. 不拥有业务 authority

## 7. 对象模型建议

建议的核心对象如下。

### 7.1 Workspace 相关

#### `workspace`

字段建议：

1. `workspace_id`
2. `root_path`
3. `repo_summary`
4. `trusted_tools`
5. `provider_profiles`
6. `workspace_memory_policy`
7. `default_autonomy_policy`

#### `conversation`

用途：

1. global chat
2. workspace chat

说明：

1. 只是入口
2. 不是最终执行 authority

### 7.2 澄清与合同相关

#### `clarification_session`

状态建议：

1. `inquiring`
2. `ready_to_freeze`
3. `frozen`
4. `abandoned`

#### `assumption`

字段建议：

1. `assumption_id`
2. `statement`
3. `source`
4. `confidence`
5. `impact_if_wrong`
6. `default_if_unanswered`
7. `needs_user_decision`

#### `decision`

用途：

1. 用户拍板
2. 高影响系统决定的正式记录

#### `acceptance_spec`

字段建议：

1. `acceptance_kind`
2. `validator_type`
3. `validator_command`
4. `required_artifacts`
5. `required_metrics`
6. `service_state_requirements`
7. `manual_review_requirements`
8. `thresholds`

#### `work_item`

字段建议：

1. `work_id`
2. `goal`
3. `non_goals`
4. `context`
5. `constraints`
6. `acceptance_spec`
7. `risk_policy`
8. `autonomy_policy`
9. `approach_notes`
10. `missing_questions`
11. `status`

#### `loop_contract`

字段建议：

1. `bound_work_ref`
2. `max_iterations`
3. `max_wall_time`
4. `retry_policy`
5. `stop_conditions`
6. `escalation_conditions`
7. `driver_selection_policy`
8. `validator_policy`

### 7.3 执行相关

#### `role_session`

字段建议：

1. `role_session_id`
2. `role`
3. `provider`
4. `native_session_handle`
5. `context_packet_ref`
6. `status`

#### `run`

说明：

1. 一次 loop child attempt
2. 固定绑定 `work_id@revision`
3. 不接收 free-text 执行 authority

#### `phase_result`

建议覆盖：

1. `clarify_result`
2. `contract_freeze_result`
3. `plan_result`
4. `execute_result`
5. `validate_result`
6. `adversarial_review_result`
7. `judge_result`
8. `reflect_result`
9. `report_result`

#### `artifact`

建议包括：

1. diff
2. file
3. metric
4. log
5. receipt
6. screenshot
7. benchmark report
8. service endpoint / health evidence

每个 artifact 都应带 provenance：

1. `producer_role`
2. `run_id`
3. `phase`
4. `timestamp`
5. `hash`
6. `source_path_or_uri`

### 7.4 同步与记忆相关

#### `timeline_event`

用途：

1. live stream
2. history catch-up
3. multi-device rendering

#### `memory_item`

用途：

1. 存放可复用知识
2. 不直接等于 prompt context

## 8. 生命周期设计

### 8.1 用户可见三大阶段

1. `Clarify / Contract`
2. `Execute Loop`
3. `Review / Validate / Reflect`

### 8.2 系统内部建议细分为八个 phase

1. `intake`
2. `clarify`
3. `contract_freeze`
4. `plan`
5. `execute_loop`
6. `validate`
7. `adversarial_review`
8. `reflect_and_report`

### 8.3 每个阶段都应该是独立 role + 独立 session

这样做的好处：

1. 减少上下文污染
2. 让“执行者”和“审查者”真正对抗
3. 更容易做 resume / replay / audit
4. 更容易在 driver 切换时保持结构化 handoff

## 9. 角色设计

### 9.1 澄清阶段角色

#### `Intake Analyst`

职责：

1. 从用户原话中提取候选目标、范围、风险、资源
2. 先形成 draft，不立即提问

#### `Clarification Interviewer`

职责：

1. 只问真正影响执行决策的问题
2. 控制提问预算

#### `Assumption Adversary`

职责：

1. 专门攻击隐含假设
2. 找冲突、歧义、范围偷换

#### `Acceptance Compiler`

职责：

1. 把“完成”翻译成 evidence
2. 形成结构化 `acceptance_spec`

#### `Contract Freezer`

职责：

1. 输出 `work_item + loop_contract`
2. 给用户一个可确认的决策卡

### 9.2 执行阶段角色

#### `Planner`

职责：

1. 把合同翻译成执行计划
2. 不得改写目标与验收

#### `Executor`

职责：

1. 编码
2. 调试
3. 跑命令
4. 产出 artifact

#### `Loop Controller`

职责：

1. 决定是否继续 loop
2. 决定是否切换 driver / retry / escalate
3. 不直接写代码

#### `Tool Specialist`

职责：

1. 针对 GPU / ML / frontend / release / benchmark 等专项支援
2. 不持有任务 authority

### 9.3 审查阶段角色

#### `Verifier`

职责：

1. 运行 `acceptance_spec`
2. 基于证据做机械判定

#### `Adversarial Reviewer`

职责：

1. 假设 executor 可能错了
2. 找范围漂移、伪证据、回归、证据缺失

#### `Judge`

职责：

1. 汇总 verifier 和 adversary
2. 形成最终 verdict

#### `Reflector`

职责：

1. 总结失败模式
2. 形成 memory candidate

#### `Reporter`

职责：

1. 对老板汇报
2. 压缩复杂度，不抛大量日志

## 10. 澄清阶段的重点设计

用户明确强调这部分必须重点设计，因此单独记录。

### 10.1 Assumption Ledger

系统必须显式维护每条关键假设，而不是藏在 prompt 里。

每条记录建议至少包含：

1. `statement`
2. `source`
3. `confidence`
4. `impact_if_wrong`
5. `ask_user | default | reject | defer`
6. `default_if_unanswered`

### 10.2 Question Budget

目标不是问得多，而是问得值。

建议规则：

1. 每轮最多 `3` 个高价值问题
2. 低风险且可逆的决策，默认处理
3. 高风险、不可逆、会改变验收的决策，必须问
4. 明显可以由 executor 通过仓库勘察得到的信息，不问用户

### 10.3 Ready Gate

只有满足以下条件，才允许从 conversation freeze 成 `ready` work：

1. 目标明确
2. 非目标明确
3. workspace / repo / 路径边界明确
4. 验收证据明确
5. 风险与升级策略明确
6. 自动化权限边界明确
7. 剩余 open questions 不会阻断执行

### 10.4 Decision Card

给用户看的应该是一个简洁但完整的确认卡，而不是长 prompt。

卡片至少包含：

1. 我理解的目标
2. 我认为不做的内容
3. 我会默认怎么做
4. 需要你拍板的项目
5. 验收方式
6. 主要风险

### 10.5 No Fake Clarity

如果验收标准不清，系统不能假装 ready。

允许状态：

1. `draft`
2. `needs_input`
3. `blocked`

不允许：

1. 用模糊验收注册成 ready
2. 让 executor 自己在执行期重新定义成功标准

## 11. Prompt 套件建议

新 Thoth 不应依赖单个超长系统 prompt，而应采用：

1. `PromptSpec`
2. `InputSchema`
3. `OutputSchema`
4. `HardStops`
5. `ContextPolicy`

建议的预设 prompt 套件如下。

### `P0 Global Digital Employee`

职责：

1. 将“减少老板心智负担”设为最高目标
2. 决定当前应该进入澄清、注册、执行、审查还是汇报

硬限制：

1. 不得假装任务已完成
2. 不得让用户管理 provider/session/log
3. 不得绕过验收

### `P1 Workspace Intake Analyst`

输入：

1. 用户原话
2. workspace 摘要
3. 最近相关 memory

输出：

1. `intent_candidates`
2. `scope_candidates`
3. `risk_flags`
4. `missing_info`

### `P2 Clarification Interviewer`

输出规则：

1. 最多 `3` 个问题
2. 每个问题都要说明：
   - 为什么需要问
   - 不回答时默认怎么处理
   - 这个答案会影响什么

### `P3 Assumption Adversary`

输入：

1. draft contract

输出：

1. `attack_findings`
2. 按 `blocker/high/medium` 排序

### `P4 Acceptance Spec Compiler`

职责：

1. 将用户语言翻译成 `acceptance_spec`

支持的验收类型示例：

1. `script`
2. `metric`
3. `artifact`
4. `service_state`
5. `benchmark`
6. `visual`
7. `mixed`

### `P5 Work Registrar / Loop Compiler`

职责：

1. 输出 `work_item`
2. 输出 `loop_contract`
3. 输出 role plan

### `P6 Planner`

职责：

1. 输出具体执行计划
2. 识别 authority gap
3. 发现 gap 时返回 `needs_input`

### `P7 Executor`

职责：

1. 实现
2. 调试
3. 产出 artifacts
4. 留可审计收据

限制：

1. 不得声称最终通过
2. 只能声称“已执行 / 已产出”

### `P8 Loop Controller`

职责：

1. 读取本轮执行结果
2. 决定下一步：
   - `continue`
   - `retry`
   - `switch_driver`
   - `validate`
   - `needs_input`
   - `stop_failed`
   - `stop_success`

### `P9 Verifier`

职责：

1. 跑 validator
2. 判断证据是否满足

### `P10 Adversarial Reviewer`

职责：

1. 从反方向审查执行结果
2. 找漏洞、漂移、伪成功

### `P11 Judge / Reflector`

职责：

1. 形成 final verdict
2. 形成 retry hint
3. 产出 memory candidates

### `P12 Reporter`

职责：

1. 将技术执行过程翻译成老板可读报告

### `P13 Memory Curator`

职责：

1. 从完成/失败任务中提取可复用知识
2. 不直接污染长期记忆

### `P14 Context Compiler`

职责：

1. 为不同 role 编译最小充分 context packet
2. 严格控制 token 与污染

## 12. 记忆与上下文设计

### 12.1 Memory 分层

建议至少分为七层。

#### `Global User Memory`

包含：

1. 用户偏好
2. 风格偏好
3. 风险偏好
4. 汇报风格

#### `Workspace Memory`

包含：

1. repo 结构
2. 常用命令
3. 测试入口
4. 部署/运行约束
5. 常见坑

#### `Authority Memory`

包含：

1. decisions
2. assumptions
3. work items
4. acceptance specs

说明：

1. 这是最高可信层

#### `Run Memory`

包含：

1. 执行计划
2. 重试历史
3. 失败原因
4. artifact 索引

#### `Artifact Memory`

包含：

1. 关键文件
2. log
3. screenshot
4. metrics
5. receipts
6. hash / provenance

#### `Provider Capability Memory`

包含：

1. 当前 harness 的能力、模式、限制、是否可用

要求：

1. 带 TTL
2. 支持 refresh

#### `Lessons / Skill Memory`

包含：

1. 可复用经验
2. 失败模式
3. task archetype 级别经验

### 12.2 Context 不等于 Memory

必须明确：

1. memory 是长期可检索信息
2. context packet 是面向某个 role/session 的最小充分输入

建议 packet 结构：

```json
{
  "role": "executor",
  "work_ref": "WORK-123@rev7",
  "goal": "...",
  "non_goals": ["..."],
  "constraints": ["..."],
  "acceptance_spec": {},
  "relevant_decisions": ["DEC-..."],
  "relevant_workspace_facts": ["..."],
  "forbidden_assumptions": ["..."],
  "required_evidence": ["..."]
}
```

### 12.3 多阶段间上下文如何传递

建议通过 handoff artifact，而不是共享整段对话。

例如：

1. 澄清阶段输出：`contract_freeze.json`
2. plan 阶段输出：`plan.json`
3. execute 阶段输出：`execute_receipt.json`
4. validate 阶段输出：`validate_result.json`
5. adversarial 阶段输出：`review_findings.json`
6. judge 阶段输出：`verdict.json`
7. report 阶段输出：`boss_report.md`

## 13. 宿主无关设计

### 13.1 原则

宿主无关不是抹平差异，而是：

1. 定义统一上层 contract
2. 显式建模 capability 差异
3. 把差异关进 adapter

### 13.2 建议的统一上层接口

上层至少应统一这些语义：

1. `createSession`
2. `resumeSession`
3. `startTurn`
4. `streamEvents`
5. `streamHistory`
6. `respondPermission`
7. `interrupt`
8. `close`
9. `fetchCatalog`
10. `describeCapabilities`
11. `materializeSkills`
12. `materializeMcp`
13. `materializeSystemContext`

### 13.3 Capability Matrix

每个 driver 应暴露明确 capability：

1. `supports_session_resume`
2. `supports_streaming`
3. `supports_mcp`
4. `supports_skill_injection`
5. `supports_system_prompt`
6. `supports_permissions`
7. `supports_model_switch`
8. `supports_thinking_level`
9. `supports_import_sessions`
10. `supports_background_safe`
11. `supports_structured_output`
12. `requires_file_context`
13. `skill_path_strategy`
14. `mcp_injection_strategy`
15. `permission_model`

### 13.4 Driver Integration Pattern

建议借鉴 Paseo：

1. 支持 ACP 的 harness：
   - 走 `ACPAdapter`
2. 强个性的 harness：
   - 走 `DirectAdapter`

### 13.5 Provider Materialization 现实

来自参考项目的实证表明：

1. `Claude Code` / `CodeBuddy` 更偏 `CLAUDE.md + .claude/skills + --mcp-config`
2. `Codex` 更偏 `AGENTS.md + $CODEX_HOME + config.toml`
3. `OpenCode` 有自己的动态 MCP 和 variant 模型体系
4. `Hermes` / `OpenClaw` 的 skill path 甚至可能是 fallback path
5. `Pi` 的 resume id 是文件路径，不是普通字符串

因此：

1. 新 Thoth 不应在 authority 层假定统一 materialization 行为
2. 应由 driver 负责：
   - skill 写入
   - AGENTS/CLAUDE 注入
   - MCP 写入
   - model/mode/thinking 参数映射

## 14. 多端同步设计

### 14.1 核心不变量

建议直接采用以下不变量：

1. live stream 负责即时性
2. authoritative history 负责正确性
3. presence 不等于 delivery
4. catch-up 可以分页，但不能丢
5. resumed client 必须能补齐历史

### 14.2 Daemon 为 authority server

建议：

1. 所有 timeline event 先 commit 到 daemon
2. 再广播给各客户端
3. 所有客户端都可以断线重连、按 cursor catch-up

### 14.3 Relay 与远程访问

建议：

1. 同网直连优先
2. 异地走 relay
3. relay 只转发密文
4. 手机扫码拿到 daemon public key
5. 用 E2EE channel 建立通信

### 14.4 手机端应做什么

建议手机端优先做：

1. 看任务列表
2. 看阶段进度
3. 看关键 timeline
4. 回答澄清问题
5. 批准 permission / decision
6. 看最终报告

不建议一开始做：

1. 重型 code diff 编辑
2. 大量 terminal 交互
3. 全 IDE 级操作

## 15. TUI 与 APP 路线建议

### 15.1 TUI

建议：

1. 使用 `OpenTUI`
2. 优先用 `@opentui/react`
3. TUI 只消费 `@thoth/client`
4. 不直接读取 `.thoth`

建议 TUI 的核心视图：

1. Global Inbox
2. Workspace Chat
3. Clarification Queue
4. Work Items
5. Loops / Runs
6. Evidence / Artifacts
7. Permissions / Decisions
8. Reports
9. Provider Health

### 15.2 APP

建议：

1. 第一版采用 `Expo React Native`
2. 同时覆盖：
   - iOS
   - Android
   - Web
3. Desktop 采用 `Electron` 封装 web/app client，并负责 daemon 管理

这条路线的理由：

1. 参考项目已证明多平台打包可行
2. 可以复用协议和 TypeScript 类型
3. 最快达到“手机同步 + 桌面管理”的目标

### 15.3 UI 是壳的具体含义

必须坚持：

1. TUI 不得拥有独立业务规则
2. APP 不得拥有独立任务状态机
3. 任何 phase、permission、verdict、report 的语义都只能由 daemon / authority 层持有

## 16. 推荐技术栈

建议的新仓结构：

1. `packages/protocol`
2. `packages/client`
3. `packages/daemon`
4. `packages/drivers`
5. `packages/core`
6. `packages/tui`
7. `packages/app`
8. `packages/desktop`
9. `packages/mcp`

建议语言选择：

1. `TypeScript`：
   - protocol
   - client
   - daemon
   - app
   - desktop
   - tui
2. `Python`：
   - validator / benchmark / repo-local execution helper
   - 不是 UI/protocol 主干

理由：

1. driver adapter、多端 client、protocol schema 共享类型最重要
2. 现成参考项目也多为 TS/Node daemon 生态

## 17. MVP 路线建议

### `V0` Design Freeze

产物：

1. authority schema
2. protocol schema
3. role lifecycle
4. prompt suite spec

### `V1` Local Daemon + Store

能力：

1. `thothd`
2. event log
3. workspace registry
4. timeline
5. read model
6. mock driver

### `new Thoth` Clarification Compiler

能力：

1. workspace/global chat
2. assumption ledger
3. question budget
4. acceptance compiler
5. work registration

### `V3` One Real Driver

建议先只接：

1. `Codex` 或 `Claude Code`

目标：

1. 跑通完整合同到执行到验证闭环

### `V4` OpenTUI

目标：

1. 提供第一版真正可用的 TUI 控制面

### `V5` APP + Desktop

目标：

1. 手机扫码连 daemon
2. 看 timeline
3. 批准 permission
4. 看报告

### `V6` Multi-provider

目标：

1. 再逐步接入 OpenCode、Hermes、OpenClaw、QwenCode 等
2. 每个 provider 都要有 capability contract 与 conformance tests

### `V7` Autopilot / Night Runs

目标：

1. recurring loops
2. nightly background work
3. digest report
4. memory curation

## 18. 风险与边界

### 18.1 最大风险

1. 澄清阶段问太多，用户嫌烦
2. 验收不硬，系统容易“看起来成功”
3. 多端同步丢历史
4. context 膨胀污染 role session
5. 过早支持太多 provider，核心 authority 不稳

### 18.2 设计边界

1. 先做 `clarification -> loop contract -> validator-first run`
2. 不先追全量 UI 特性
3. 不先追全量 provider 覆盖
4. 不把“漂亮的 dashboard”误当成核心价值

## 19. 当前方案的最终判断

### 19.1 一句话版本

新 new Thoth 的核心不该是“又支持了多少 harness”，而应该是：

**把老板模糊的自然语言意图，编译成可验证、可恢复、可异步执行、可审计的 loop contract，并用任意 harness 去实现。**

### 19.2 对参考项目的组合式吸收

建议组合：

1. 吸收 `Multica` 的：
   - agent teammate / issue / runtime / multi-workspace / managed daemon
2. 吸收 `Paseo` 的：
   - daemon/client/relay/protocol/provider adapter/timeline sync/app+desktop 路线
3. 吸收当前 `Thoth` 的：
   - `.thoth` authority
   - `work_id@revision`
   - `acceptance_spec`
   - `phase_result`
   - `artifact ledger`
   - adversarial review

### 19.3 不可丢失的原则

1. `UI 是壳`
2. `任务注册就是 loop 注册`
3. `至少三阶段，且每阶段独立 role + 独立 session`
4. `验收必须先于成功宣告`
5. `多端同步必须以 authority/history 为准`
6. `宿主无关必须通过 adapter + capability matrix 实现`
7. `减少人的心智负担高于暴露系统内部复杂性`

## 20. 当前仍待拍板的问题

以下问题在实现前仍建议单独做 decision：

1. `thothd` 是否完全采用 `TypeScript/Node`，还是 authority/store 内核单独下沉到 Rust
2. `.thoth` 与 daemon 内部数据库的关系：
   - 单一真相在 SQLite，再投影到 `.thoth`
   - 还是 `.thoth` 作为真相，SQLite 只作 cache/index
3. APP 是否第一阶段就做，还是先把 OpenTUI + CLI 打通
4. 初始首发 provider 是 `Codex` 还是 `Claude Code`
5. 是否要为 review/verifier/judge 引入专门的“不同 provider 对抗”策略
6. memory curation 是全自动，还是默认要用户确认后写入长期 memory

## 21. 本地参考材料清单

本轮设计直接参考的本地材料如下。

### 当前 Thoth 仓库状态

1. `<thoth-repo>/.agent-os/project-index.md`
2. `<thoth-repo>/.agent-os/todo.md`
3. `<thoth-repo>/.agent-os/architecture-milestones.md`
4. `<thoth-repo>/.agent-os/run-log.md`

### Multica

1. `<harness-workspace>/multica/README.md`
2. `<harness-workspace>/multica/CLI_AND_DAEMON.md`
3. `<harness-workspace>/multica/apps/docs/content/docs/providers.mdx`
4. `<harness-workspace>/multica/server/pkg/agent/agent.go`
5. `<harness-workspace>/multica/server/internal/daemon/execenv/runtime_config.go`

### Paseo

1. `<harness-workspace>/paseo/docs/architecture.md`
2. `<harness-workspace>/paseo/docs/providers.md`
3. `<harness-workspace>/paseo/docs/custom-providers.md`
4. `<harness-workspace>/paseo/docs/agent-lifecycle.md`
5. `<harness-workspace>/paseo/docs/timeline-sync.md`
6. `<harness-workspace>/paseo/packages/app/package.json`
7. `<harness-workspace>/paseo/packages/desktop/electron-builder.yml`

### OpenTUI

1. `<codex-skills>/opentui/docs/getting-started.mdx`
2. `<codex-skills>/opentui/docs/bindings/react.mdx`

## 22. 文档用途

本文件用于：

1. 固化本轮用户对全新 new Thoth 的原始目标和约束
2. 固化对 `Multica`、`Paseo`、`OpenTUI` 的关键调研结论
3. 为后续 `TD-003` 的 decision-complete 迁移主线提供统一入口
4. 避免后续实现阶段丢失“减少人的心智负担”这一最上层产品原则
