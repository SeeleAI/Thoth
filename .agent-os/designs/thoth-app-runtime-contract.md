# Thoth App Runtime Contract

## Status

1. 日期：`2026-07-07`
2. 性质：Thoth APP 信息架构、runtime skill、runtime tool bridge、AgentTimeline 与 authority card 合同
3. 适用范围：`packages/app`、`packages/desktop`、`packages/daemon`、`packages/drivers`、`packages/protocol`、`packages/client`
4. 代码合同：`packages/protocol/src/thoth-runtime-contract.ts`、`packages/protocol/src/agent-types.ts`、`packages/protocol/src/messages.ts`
5. 状态：canonical design authority；`NTH-CD-041` 锁定 restored Paseo production app surface，`NTH-CD-042` 锁定 Quick / Clarify / Loop phase split，`NTH-CD-045` 锁定 Loop background 主路径为 Goals Card -> durable Task -> PlanExec / Review phases，`NTH-CD-053` 锁定一个可见 Agent 只有一条连续 foreground provider thread，`NTH-CD-054` 锁定每次发送冻结该轮控制快照、已有 Card 不跟随 composer 热切换，`NTH-CD-060` 将 Runtime Tool Bridge 升级为所有 provider/ACP 共用的 HarnessAdapter + RuntimeBundle + ToolGateway，并把 Workspace / Task / Execution 设为唯一 authority。
6. 取代范围：本文件覆盖此前三视图 toy shell、assistant JSON/outputSchema packet、`submit_clarify_packet` 主路、Workspace Secretary `liveEvents` 摘要流、fake background running/review 口径，以及旧 Pyramid Plan / `registered_pending` 作为 Loop 主路径的口径。旧 packet / state-code / golden 资料只能作为 legacy/internal evidence 或 Loop-1 历史，不驱动当前 Loop acceptance。

## 0. 当前最高口径

### 0.1 Frontend Surface

`NTH-CD-041` 仍然是 APP 主界面的最高约束：

1. Loop-2 主入口必须是 restored Paseo production app surface。
2. Paseo 是 frontend substrate，不是临时参考或 toy shell。
3. 主路径必须保留 stream、timeline、composer、card、settings、host/provider、attachments、file links、terminal/browser/file panes、desktop/mobile responsive layout、keyboard/focus/accessibility 和 e2e/test substrate。
4. `packages/app/src/thoth-app/thoth-app-shell.tsx` 这类 toy shell 不得作为用户主入口。
5. Composer 的原 `Models` / `Think` / `Feature` 控件映射为 Thoth `Provider` / `Clarify` / `Mode`。
6. 用户可见产品心智是 Thoth Workspace Secretary / task loop，而不是 Paseo agent manager，也不是 debug protocol viewer。

### 0.2 Runtime Phase

`NTH-CD-042` 仍然定义 Quick / Clarify / Loop 的 phase 分界：

1. 一个 Workspace Secretary topic 永远对应一条连续的 foreground provider conversation；Thoth 开关、Clarify 强度和 Quick/Loop 只决定下一轮的 harness policy，绝不作为 provider session identity。
2. `Quick + none` 是裸 provider / Paseo foreground turn：不加载 `thoth.clarify`、不包 Clarify envelope、不期待 structured output、不进入 Clarify repair，也不创建 card、Task/Goals authority 或 Loop registration。
3. `Quick + clarify` 复用这同一个 Workspace Secretary topic/provider session，并在 structured phases 中进入 `thoth.clarify`。
4. `Quick + clarify` phases：`clarify`、`approval_task`、`approval_breakdown`、`quick_exec`、`repair`。
5. `quick_exec` 是普通 provider execution stream，不 packet 化；它必须继续显示 provider reasoning、shell、edit、read、write、search、fetch、web、todo、error、permission 等 AgentTimeline 事件。
6. `Loop` 经 `NTH-CD-045` 升级为 Clarify 与两张确认卡后注册 durable Loop task，并由后台 scheduler 启动 PlanExec / Review；旧 `registered_pending` 只保留为 legacy/recovery 兼容。
7. 每次用户发送时，daemon 将该轮有效 `mode / clarifyStrength / loopStrength` 持久化为 turn controls。它们属于运行真相，只决定这一轮 authority flow 的 Clarify、Task Card、Goals Card 与 Quick/Loop handoff，不进入 Agent Harness 的任务语义。
8. 用户在 Card pending 期间切换 Thoth、Clarify 或 Quick/Loop，只修改下一次发送的偏好。Task/Goals Card 自身的 frozen turn controls 优先于当前 composer 或迟到 clean model；刷新、重连、daemon 重启与 provider session 恢复均不得改写。
9. Quick-owned Task/Goals Card 只能继续前台执行；Loop-owned Task/Goals Card 只能注册后台任务。App 负责按 Card 投影正确 action，daemon 仍以同一 Card snapshot 校验 intent 和 Loop strength，任何相反 intent 保持 pending 并返回显式冲突。

### 0.3 Runtime Tool Bridge

`NTH-CD-043` 覆盖 `NTH-CD-042` 中 `submit_clarify_packet` 作为主路的旧描述：

1. Structured Workspace Secretary 主路使用 provider-neutral HarnessAdapter；Codex `dynamicTools`、Claude/OpenCode/Pi MCP 与 ACP tool surface 只是同一 semantic tool catalog 的 driver 映射。
2. 模型在 structured phases 中调用 Thoth semantic runtime tools，而不是输出 assistant JSON、markdown packet、native `outputSchema` packet 或 `submit_clarify_packet`。
3. 当前 Codex 主路工具名：
   - `thoth_submit_clarify_card`
   - `thoth_submit_task_card`
   - `thoth_submit_pyramid_plan`
   - `thoth_report_blocked`
4. Daemon 接收 tool call input 后做 schema、phase、authority、provenance、permission 和 pending-decision 校验，再构造内部 authority event / card model。
5. 用户回答 Card 后，daemon 先追加 Human Decision，再在同一 ProviderThread 启动新的 continuation ExecutionAttempt；不得恢复旧 tool-call Promise 或依赖旧 call stack 存活。
6. `submit_clarify_packet` / `submit_runtime_packet` 只能作为 legacy/internal/test-isolated 兼容词，不得作为 Loop-2 acceptance 主路径，不得出现在用户可见 UI。
7. 当前 Codex、Claude Code、OpenCode、Pi 和 ACP adapter 必须实现并通过完整 bridge conformance；未来 provider 若缺少声明所需能力，必须 honest unsupported，不能退回 outputSchema/assistant markdown JSON 冒充通过。

## 1. 核心判断

Thoth APP 不是 dashboard，不是 Paseo 换皮，不是 agent/session manager。

Thoth 在 restored Paseo surface 上提供任务控制平面：

1. 用户进入 workspace。
2. 用户在当前 Workspace Secretary topic 中发送一句 prompt。
3. `Provider` 选择真实 HarnessAdapter/ProviderThread；Codex做真实认证验收，Claude Code、OpenCode、Pi和ACP做各自transport-level端到端conformance。
4. `Clarify` 选择 `none` / `light` / `balanced` / `dive` 等强度。
5. `Mode` 选择 `Quick` 或 `Loop`。
6. `Quick + none` 走裸 provider stream。
7. `Quick + clarify` 通过 runtime tools 进入 Clarify Card -> Task Card -> Goals Card -> same-session `quick_exec`。
8. `Loop` 通过 runtime tools 进入 Clarify Card -> Task Card -> Goals Card -> durable background Loop task；legacy Pyramid Plan / `registered_pending` 不再是主路径。

用户不需要理解 provider session、PlanExec、Review、skill、packet、state code、repair、authority store、driver、MCP、dynamic tool 或 raw tool call。

## 2. RuntimeToolBridge Contract

Thoth 的产品层只依赖 provider capability，不依赖某个 transport 名称。

当前 capability model：

```ts
type ClarifyTransport =
  | "codex_dynamic_tool"
  | "native_question"
  | "mcp_runtime_tool"
  | "output_schema_degraded"
  | "unsupported";
```

Loop-2 verification 只通过 `codex_dynamic_tool`。

Provider-neutral bridge 职责：

1. 注册或启用 provider session-scoped runtime tools。
2. 归一 provider native question、custom tool、MCP tool 或 dynamic tool call。
3. 把 Thoth-owned card submission 转成 persisted pending authority decision。
4. 阻塞或持久化等待用户回答。
5. 将用户回答序列化回 provider-specific tool result。
6. 记录 capability、pending id、provider agent id、topic id、call id、phase、tool name、validated card、status、timestamps 和 redacted raw input hash。

Codex adapter 当前职责：

1. 对支持 native tools 的 Workspace Secretary provider thread，在 thread/start 时注册会话级 `dynamicTools`，以便同一 topic 后续可从 raw Provider turn 进入 Thoth turn 而不切换会话。
2. 处理 `item/tool/call`。
3. 只接受当前 phase 允许的 semantic tools：Clarify phase 使用 `thoth_submit_clarify_card`、`thoth_submit_task_card`、`thoth_submit_goals_card`、`thoth_report_blocked`；Loop phase 使用 PlanExec / Review / blocked tools。`thoth_submit_pyramid_plan` 仅 legacy。
4. 返回 `DynamicToolCallResponse`。
5. raw `Quick + none` turn 即使位于一个已注册会话级 tools 的 thread 中，也必须被 daemon 的 per-turn authority fence 拒绝；它不能创建 card、pending decision、Task/Goals authority 或 Loop task。
6. 在 Clarify structured session 中把 Codex native `request_user_input` 视为违规问题路径，repair 或 block，而不是转成 Thoth card。

Claude/OpenCode 方向：

1. Claude `AskUserQuestion` 和 OpenCode `question` 是 provider-native question transport，不等同 Thoth-owned authority submission。
2. Claude SDK custom tools / in-process MCP、OpenCode custom tools / MCP 可以作为未来 `RuntimeToolBridge` adapters。
3. 它们未纳入 Loop-2 verified scope；UI/daemon 必须 honest unsupported 或 degraded，不得假装通过。

## 3. Authority And Pending Decisions

Clarify / Task / Goals 都走同一种 lifecycle：

1. Provider model calls semantic runtime tool。
2. Daemon validates tool input。
3. Daemon persists pending decision。
4. Frontend renders typed authority card inside AgentTimeline。
5. 用户选择、批注、接受、取消或请求修改。
6. Daemon records authority event。
7. Daemon returns provider tool result。
8. Provider continues in same topic/session。

Pending decision status：

```text
pending
answered
rejected
expired
blocked
```

不允许：

1. 前端本地生成 Task / Goals card。
2. 前端本地修改 authority card 内容。
3. 前端替用户选择第一个选项。
4. daemon 在没有用户动作时默认接受。
5. provider 自然语言自报“已确认”后直接推进。
6. assistant text / markdown JSON / code fence 被解析成 authority。

## 4. AgentTimeline Contract

Loop-2 的实时 UI stream 是 AgentTimeline，不是 Workspace Secretary `liveEvents` 摘要主路。

AgentTimeline 必须保留 provider 原始生命周期语义：

1. `user_message`
2. `assistant_message`
3. `reasoning` / thought
4. `tool_call`
5. shell / command
6. edit / file change
7. read / write / search / fetch / web
8. todo
9. error / activity
10. compaction
11. permission / provider-native question
12. Thoth authority cards

Tool call 是生命周期更新：同一个 `callId` 从 running 更新到 completed / failed / canceled，前端合并为同一个 badge，而不是重复新增 start/end 两条。

Thoth authority cards 也是 timeline items：

1. `clarify_card`
2. `task_card`
3. `goal_card`，用户可见主路径为 Goals Card，wire 兼容旧名
4. `registered_task`

Workspace Secretary 可以保留 snapshot/model 字段做恢复和兼容，但用户主链路不得依赖 `liveEvents` 这种降级摘要流来替代 provider timeline。

### 4.1 Foreground Delivery And Rewind Identity

1. 每次 Send 先由 daemon Workspace authority 接受完整冻结快照；App 不写 optimistic `user_message`，也不保存第二份 Queue。
2. 每个 Agent 最多一个 active foreground execution。`queue` 等待 terminal/fence；`interrupt` 先持久化，再停止旧 turn，禁止上下两条 provider stream 并行。
3. canonical `messageId` 属于 Thoth Timeline。HarnessAdapter 把它绑定到版本化 opaque provider anchor receipt；daemon 和 App 不解释 provider 原生 id。
4. conversation/both rewind 从目标 canonical user row 开始截断并生成新 Timeline epoch；App 清空旧 cursor/head/tail 后完整读取新 epoch。无法确定的旧 anchor 明确不可回退。
5. Workspace 图片始终由当前 daemon/Relay 二进制读取。预览只使用临时 Blob/data URI，并在切换、关闭或卸载时释放；不得复制进附件持久化目录。

## 5. Cards And Contracts

### 5.1 Clarify Card

Clarify Card 是 Thoth decision card，不是 provider-native `request_user_input` / `AskUserQuestion` / permission question 的换皮。

约束：

1. 一张 card 2-4 道紧密相关问题。
2. 每题 2-4 个选项。
3. 选项 label 不超过 15 个字。
4. 选项 description 不超过 30 个字。
5. 支持 per-option note。
6. 支持 note-only。
7. 支持“你推荐”作为结构化用户意图，不是前端默认选择；`你决定` 仅 legacy。
8. 不默认预选，不默认推荐。
9. 提交后立即折叠为 readonly/submitted summary。
10. 多轮 Clarify card 保留在同一 topic timeline，不覆盖历史。

### 5.2 Task Card

Task Card 是 compact CEO overview。

只允许：

1. `title`
2. `goal`
3. `constraints`
4. `acceptance`

不允许：

1. risk 字段。
2. why_loop 字段。
3. implementation plan。
4. 文件路径。
5. 命令。
6. 代码级步骤。

Task Card 必须带完整 Clarify transcript provenance。用户批注或修改要求必须回到 agent harness，不能前端本地改 authority。

### 5.3 Goals Card

Goals Card 是第二张确认卡。它替代旧用户可见 “Pyramid Plan Card” 心智，但 wire 可继续兼容
`goal_card` / `C_GOAL_CARD` 名称，旧 Pyramid Plan 仅 legacy parse-only。

它表达：

1. 线性 ordered goals。
2. 每个 goal 的 title / goal / constraints / acceptance。
3. goal provenance。
4. 执行顺序。

不允许：

1. 重复 Task Card 全文。
2. risk 字段。
3. implementation plan。
4. 文件路径。
5. shell 命令。
6. 代码步骤。

Goals Card 必须带完整 Clarify transcript + 已确认 Task Card provenance。

## 6. Mode Semantics

### 6.1 Quick + none

`Quick + none` 是 bare Provider / Paseo foreground turn：

1. 复用当前 topic 已有的 provider session、上下文和 provider-native conversation state。
2. 不挂载 `thoth.clarify`，不要求 `outputSchema` 或 packet，也不进入 Clarify repair。
3. 不创建 Thoth authority card、Task/Goals authority 或 Loop task。
4. provider 的会话级 tool catalog 可以为未来 Thoth turn 常驻；daemon 必须按当前 raw turn fence 拒绝任何 remembered Thoth authority tool call。
5. 普通 assistant text、reasoning、tool、permission 通过 AgentTimeline 显示。
6. Provider-native `request_user_input` 若由裸 provider 自己触发，按原生 Paseo permission/question lifecycle 渲染。

### 6.2 Quick + clarify

`Quick + clarify` 是 phase-aware secretary session：

1. `clarify`: provider 调用 `thoth_submit_clarify_card`，或判断应进入 Task。
2. `approval_task`: provider 调用 `thoth_submit_task_card`。
3. `approval_breakdown`: provider 主路径调用 `thoth_submit_goals_card`；`thoth_submit_pyramid_plan` 仅 legacy。
4. `quick_exec`: provider 按已确认 Task + Goals Card 正常执行，显示原生 AgentTimeline。
5. `repair`: provider 修复 tool input shape / phase / provenance，不重新解释用户目标。

两张卡确认后进入同一个 topic/provider session 的 `quick_exec`，不注册后台 task。

### 6.3 Loop

Loop path after `NTH-CD-045`：

```text
clarify -> Task Card -> Goals Card -> durable Loop task -> current goal PlanExec -> Review -> pass/retry/block -> next goal
```

旧 Loop-2 `registered_pending` 只作为 legacy recovery 兼容；当前主路径必须启动真实后台
PlanExec / Review task state，但仍不得显示 fake running、fake review 或 fake evidence。

注册后的 minimum UI：

1. 主 timeline 显示 Goals approval / background task handoff。
2. Background Tasks 列表可查看真实 Loop tasks。
3. Task detail 按线性 goals 展示状态，当前 goal/phase spinner，其余灰态。
4. Phase detail 嵌入对应 PlanExec / Review agent 的 AgentTimeline。
5. 刷新、重连、移动端 deep link 后仍能恢复。
6. Review 只有在提交 `continue` / `reframe_current_goal` 后才构成 failed Review，并自动回到同一 goal 的下一轮 PlanExec；provider 尚未形成 verdict 时的启动、配置或 transport 错误不属于 Review fail。
7. Provider infrastructure failure 进入 `interrupted`，不消耗 failed-Review budget，Resume 从当前 phase cursor 继续。用户修复真实前提后，也可以显式 Resume 一个 `blocked` phase。
8. Goals Card 注册成功后，Workspace Secretary 前台必须投影为 `background_handoff + ready`。Composer 热切换或历史 timeline 中残留的 running tool 不得重新制造前台 spinner。

## 7. Daemon Mechanical Responsibilities

Daemon 只做机械 authority，不做语义智能：

1. 根据 Mode / Clarify / phase 选择 bare stream 或 runtime tool bridge。
2. 注册 Codex `dynamicTools`。
3. 校验 tool input schema。
4. 校验 phase transition。
5. 校验 Task / Goals provenance。
6. 校验用户审批 gate。
7. 落盘 pending decision 和 authority event。
8. 广播 AgentTimeline updates。
9. 把用户回答返回 provider runtime。
10. 对 unsupported bridge 显示 honest blocked。

Daemon 不允许：

1. 私自调用通用 LLM API。
2. 用本地自然语言启发式判断用户意图。
3. 用 provider 自然语言自报替代 tool call。
4. 用 outputSchema / assistant JSON fallback 冒充 runtime tool bridge。
5. 跳过用户确认创建后台 task。
6. 把 packet/schema/repair/tool internals 暴露给用户。
7. 把 task/goal/phase/run id、session handle、event revision、预算、retry count、envelope、receipt hash、manifest/baseline 或 recovery state 注入 Clarify、PlanExec、Review 或 audit session 的认知上下文。
8. 因为 agent 未填写机械字段或未复述 PlanExec checklist，就把独立 Review 的语义判断视为无效；daemon 只能把最小语义结论绑定到自己已知的 authority state。

Agent Harness context boundary：

1. Clarify、PlanExec、Review 与 audit session 面对的是用户目标、已确认合同、相关 workspace 现实、可检查的工作产物和必要的历史判断。
2. Review 面对的是独立纠偏任务：挑战当前方法、识别真实症结、必要时否定错误路径，并指出下一步方向；它不是 daemon checklist executor。
3. Runtime tool transport 可以把 Review 的最小语义结论交回 daemon，但 tool schema/prompt 不得要求 agent 传递或思考 daemon 的恢复、预算、phase、receipt、manifest 字段。

## 8. Frontend Responsibilities

Frontend 只渲染 protocol / daemon 提供的 typed AgentTimeline items 和 authority card models。

Frontend 可以：

1. 渲染 provider assistant / reasoning / tool timeline。
2. 渲染 Clarify / Task / Goals / background task cards。
3. 采集用户选择、批注、接受、取消、修改请求。
4. 把结构化 answer 发送回 daemon。
5. 在提交后立即把卡片折叠为 readonly/submitted 状态。

Frontend 不得：

1. 从 assistant 文本推断状态。
2. 解析 markdown JSON / code fence / raw packet。
3. 生成 Task / Goals card。
4. 修改 authority card 内容。
5. 替用户选择默认项。
6. 把 `Quick + none` 包装成 Clarify。
7. 显示 `submit_clarify_packet`、`dynamicTools`、MCP tool、raw JSON、schema error、repair prompt、skill name、provider role 或 state code。

## 9. Verification Boundary

`NTH-EV-029` verifies the strengthened Loop-2 Clarify path, with known remaining gaps.
`NTH-EV-030` code-verifies the merged Loop background implementation, but real-provider local/public
acceptance is still pending.

1. Restored Paseo surface is the main path.
2. Quick+none `hi` is a bare provider stream with no Clarify card.
3. Quick+Dive uses Codex `dynamicTools` and produces multi-round Clarify cards.
4. Task Card is compact.
5. Goals Card is linear in the current main path; legacy Pyramid Plan is parse-only compatibility.
6. Quick approvals continue into same-session `quick_exec`.
7. `quick_exec` shows real Shell/Edit timeline rows.
8. Loop approvals create a durable Loop task and enqueue the scheduler in the current main path.
9. Background Tasks list/detail exposes tasks, goals, PlanExec/Review phases and embedded AgentTimeline.
10. Mobile deep-link recovery works.
11. `npm --workspace=@thoth/app run test`, daemon focused tests, `npm run build:web`, `npm run check:foundation` and `git diff --check` passed.
12. Independent `codex exec` UI/runtime mental-model review passed.

Not fully verified yet:

1. Real Codex local/public Loop background acceptance for PlanExec / Review execution.
2. Golden/judge evidence for `thoth.loop` PlanExec / Review quality.
3. Non-Codex provider runtime-tool adapters.
4. Release build or store distribution.
5. Release build or store distribution.

## 10. Minimal Next Implementation Order

After `NTH-EV-030`, the next top action is `NTH-TD-019` real-provider acceptance:

1. Run real Codex Loop+Single and Loop+Light in throwaway `/tmp` workspaces.
2. Capture local `8082` and public `8148` screenshots/trace/video/log summaries outside the git repo.
3. Verify Goals Card approval creates a durable Loop task, not legacy `registered_pending`.
4. Verify PlanExec and Review phase timelines stream real provider AgentTimeline events.
5. Verify failed Review budget, pass advancement, pause/resume/stop and restart recovery behavior.
6. Promote stable real-provider coverage after acceptance.
