# Architecture And Milestones

## Current Design

当前 checkout 的真实结构是一个双宿主插件代码仓，核心组成如下：

- 公开命令定义：`commands/`
- 内部合同层：`contracts/`
- Codex installable marketplace/package：`.agents/plugins/marketplace.json` 与 `plugins/thoth/`
- 插件脚本：`scripts/`
- 模板与生成物：`templates/`
- hooks：`hooks/`
- 单元与集成测试：`tests/`
- canonical Python 实现骨架：`thoth/objects`、`thoth/surface`、`thoth/plan`、`thoth/run`、`thoth/init`、`thoth/observe`

当前已实现事实：

- 公开命令面是 Claude `/thoth:*` 与 Codex `$thoth <command>`
- Codex 以 executor-mode 进入 `run` / `loop` / `review`
- `/thoth:init` 采用 audit-first adopt/init，并生成最小 `.thoth/objects/` authority tree 与 `.thoth/docs/` 只读视图
- strict planning authority 已收敛为统一对象图：`.thoth/objects/discussion/`、`.thoth/objects/decision/`、`.thoth/objects/work_item/`、`.thoth/objects/controller/`、`.thoth/objects/run/`、`.thoth/objects/phase_result/`、`.thoth/objects/artifact/` 与 `.thoth/objects/doc_view/`
- 独立 `Contract` kind 已删除；原 contract 的 goal、context、constraints、execution plan、eval contract、runtime policy 与 decisions 均进入 `work_item.payload`
- `run` / `loop` 已收敛为 strict work execution：默认只接受 ready runnable `--work-id`，缺少 `--work-id` 时只能召回候选并停止
- `review` 已收敛为 live-only；CLI 允许显式 `--work-id`，也可按 review target 反推绑定 work item
- 当前 work 级当前结论写入 `.thoth/docs/work-results/*.result.json` 只读视图；原始执行真相来自 `.thoth/objects/run`、`.thoth/objects/phase_result`、`.thoth/objects/artifact` 与 `.thoth/runs/*` ledger
- 当前单次运行结果同时写入 object graph 与 `.thoth/runs/<run_id>/result.json`，不再把 `acceptance.json` 当主结果文件
- 当前 run ledger 的长期 canonical 文件集已收敛为 `run.json`、`state.json`、`events.jsonl`、`result.json`、`artifacts.json`
- 当前 `run` 已收敛为统一 RuntimeDriver 四阶段链：`plan -> execute -> validate -> reflect`；四个 agentic phase 均通过宿主 executor 运行，`validate.passed` 决定 terminal success/failure，`reflect` 总是总结证据、风险与下一步建议
- 当前 phase 产物固定为 `plan.json`、`execute.json`、`validate.json`、`reflect.json`；`result.json.result` 固定包含 `phase_statuses`、`validate_passed`、`final_summary`、`artifacts`、`next_hint`
- 当前 `loop` 已收敛为 controller service：controller 记录预算与 child lineage，每轮显式创建独立 child `run`，child run 与普通 run 复用同一 `plan -> execute -> validate -> reflect` RuntimeDriver
- heartbeat 当前写入 `state.json.last_heartbeat_at`，而不是单独的 `heartbeat.json`
- active run/controller 引用的 `work_item` 完全锁定；`Store.update/tombstone/link/unlink` 对该 work item 必须拒绝，直到执行进入 terminal 状态
- 当前 prompt authority 已显式拆成 `thoth/prompt_specs.py` 与 `thoth/prompt_validators.py`：前者现已收敛为压缩 authority source，只保存 `route_class` / `intelligence_tier` / `packet_authority_mode` / `objective` / `hard_stops` / `reply_budget` 等最小字段，后者只负责 phase/review 输出校验
- Claude `commands/*.md` 当前已收敛为 runtime-first 薄包装：保留 bridge 执行、最小 fail-fast 规则与一条结果约束，不再重复展开大段 scope/runtime/shared-authority 文本
- Codex 当前已收敛为“薄 dispatcher + per-command micro prompt files”：根 `plugins/thoth/skills/thoth/SKILL.md` 不再内联全量命令合同，按命令拆分的 micro prompt surface 固定生成到 `plugins/thoth/skills/thoth/commands/*.md`
- `review` packet 当前显式区分 `exact_match` 与 `open_ended` 两条内部路由；`run/loop` packet 当前只声明 RuntimeDriver 生命周期，不再把 `next-phase` / `submit-phase` 作为 live 宿主手动协议暴露
- dashboard 模板可以把 `.thoth/runs/*` 与 `.thoth/objects/*` 的 active run、history run 和事件日志绑定回 work item 视图
- dashboard 前端主壳已从旧多页导航切到单一 workbench shell，并保留 `/overview`、`/tasks`、`/milestones`、`/dag`、`/timeline`、`/todo`、`/activity` 的兼容入口
- dashboard 已新增 `overview-summary` 与 `gantt` 只读读面；驾驶舱、Work Detail 与时间线面板均只消费 `.thoth/objects` authority、work result read view、runtime ledger 与 `.agent-os` 派生结果
- dashboard 模板已收敛为单套共享前端源码，并通过 `tools/dashboard/frontend/src/generated/locale.ts` 固化 init/sync 生成时的默认语言
- 仓库公开 selftest 已收敛为 atomic case registry：`python -m thoth.selftest` 只接受显式 `--case` 列表，报告顶层固定为 `selected_cases` 与 `results[case_id]`
- repo-local object-kernel 原子 case 固定包含 `discuss.subtree.close`、`run.phase_contract`、`run.locked_work`、`loop.controller`、`orchestration.controller`、`auto.queue`、`observe.object_graph`
- host-surface 原子 case 首批固定为 `surface.codex.*` 与 `surface.claude.*` 两组 capability matrix，覆盖 `init/status/doctor/discuss/run/loop/review/dashboard/sync` 的 live/sleep/watch/stop prepare 语义
- `run` / `loop` / `controller` 的原子验证已按 surface 能力与 runtime 能力拆开：host-surface case 只验证 public command / bridge / handoff / watch / stop 协议，repo-local case 单独验证 object graph、controller、phase result、validator、reflect、lock 与 terminal result shape
- 仓库级 pytest 默认只允许 targeted runs：显式 file/nodeid 或 `--thoth-target`；裸 `pytest`、目录级 `pytest` 与 `--thoth-tier` broad runs 默认禁止，只有 `--thoth-allow-broad` 或 `THOTH_ALLOW_BROAD_TESTS=1` 时才允许豁免
- `thoth/test_targets.py` 固化 `target_id -> selectors / recommended selftest cases` 映射，`scripts/recommend_tests.py` 负责把 changed paths 翻译成精确验证命令

本轮已经完成的结构性收敛：

- 旧的顶层内部主实现 `thoth/runtime.py`、`thoth/task_contracts.py`、`thoth/project_init.py`、`thoth/claude_bridge.py`、`thoth/host_hooks.py` 已从主链删除
- `thoth/cli.py` 与 `thoth/selftest.py` 仅保留公共入口角色
- `scripts/status.py`、`scripts/report.py`、`scripts/doctor.py`、`scripts/sync.py`、`scripts/init.py` 均已退化为 canonical Python API wrapper，而不再承载平行实现
- dashboard 控制面已切到 `thoth.observe.dashboard` Python service，不再以 `scripts/dashboard.sh` 作为 CLI 主逻辑
- `thoth/run/lifecycle.py` 已删除，Run 主实现拆入 `model.py`、`io.py`、`lease.py`、`ledger.py`、`packets.py`、`worker.py`、`service.py`、`status.py`
- Object graph 主实现落在 `thoth/objects.py`；`Store` 是 `.thoth/objects` 的唯一 durable 写入口，并统一负责 envelope、kind payload、status machine、typed links、revision conflict 与 active work lock
- Plan 主实现已拆为 `paths.py`、`store.py`、`validators.py`、`compiler.py`、`results.py`、`legacy_import.py`、`doctor.py`；`compiler.py` 只保留 legacy compiler removed shim 与 object graph 编译边界
- Plan 当前只保留 work-level read view 词汇；`work_result` 不再是 authority，Observe 读面也不再回退读取 task 内嵌 `verdict`
- Init 主实现已拆为 `audit.py`、`preview.py`、`migration.py`、`generators.py`、`planner.py`、`apply.py`、`render.py` 与 orchestration-only `service.py`
- Init migration backup 现在会跳过 `node_modules`、`dist`、`__pycache__`、`.pytest_cache` 这类可再生成目录，避免 `re-init` 把 dashboard 第三方依赖整棵复制进 migration ledger
- Surface handler 已拆为 `envelope.py`、`project_commands.py`、`plan_commands.py`、`run_commands.py`、`protocol_commands.py`、`observe_commands.py`，`handlers.py` 只做 registry dispatch
- Observe 已新增 `read_model.py`，`status` / `report` / `dashboard` 共享只读派生模型，不在读面隐式修 authority
- Selftest 已拆为 `model.py`、`recorder.py`、`processes.py`、`capabilities.py`、`fixtures.py`、`registry.py`、`atomic_cases.py`、`host_common.py`、`host_codex.py`、`host_claude.py`，`runner.py` 只保留 atomic CLI 与总编排入口；其中 `CommandResult` / `CheckResult` 已回收为 `model.py` 单一 authority，host adapters 只保留宿主差异逻辑
- 新增 `scripts/measure_tracked_source.py` 作为 tracked-source 行数账本入口，统计面显式区分 `hard_metric` 与 `dashboard_frontend`

## Target Architecture

未来 `Thoth V2` 的目标方向保持不变，但本轮已经把共同骨架推进到统一对象图与 controller/runtime kernel：

- `.thoth/objects/<kind>/<object_id>.json` 作为唯一 canonical authority
- `.thoth/docs` 与 dashboard / report / status 只作为派生读面
- `Thoth 主控`，外部 Codex 作为 worker
- adoption/init 走 audit-first preview/apply 流程
- durable runtime 具备 `work_id@revision`、phase result、controller lineage、attach / lease / resume / stop 等完整生命周期

本轮冻结的最高层骨架如下：

1. `Surface`
   - 只包含 public command contract 和 host adapter
   - 负责统一命令语义、参数、输出信封，以及 Claude/Codex 宿主适配
   - 不承载 authority 逻辑
2. `Plan`
   - 只通过 `Store` 写 `discussion`、`decision`、`work_item` 与 typed links
   - `discuss` 是闭环 work subtree compiler：未闭环只能写 `discussion.status=inquiring`，闭环后生成 ready gate 通过的 work subtree
   - 不直接承载运行结果，也不管理 work result read view
3. `Run`
  - 包含 runtime protocol、minimal run phase chain、controller service 与 project materialization
  - `run` 固定绑定 `work_id@revision` 并执行一次 `plan -> execute -> validate -> reflect`
  - `loop`、`orchestration`、`auto` 均通过 `controller` object 表达，不扩展 `run` 语义
  - 这是唯一承接 prompt-bearing control commands 与 packet authority 的核心实现层
4. `Observe`
   - 包含 `status` / `doctor` / `dashboard` / `report` / `selftest`
   - 纯读 authority 与当前态文件，不承担修复、同步或隐式写入
   - `dashboard` 明确冻结为纯 Observe 读面

四层内部进一步细分为七个实现子层：

- `Surface / Command Contract`
- `Surface / Host Adapter`
- `Plan / Planning Authority`
- `Run / Runtime Protocol`
- `Run / Execution Orchestration`
- `Run / Project Materialization`
- `Observe / Read Model And Verification`

层间依赖方向固定为：

- `Surface -> Store-backed Domain Services -> Observe`
- `Plan / DiscussService` 只产出 `discussion`、`decision`、`work_item` 与 `.thoth/docs` read view，不读写执行结果
- `RunService` 可以消费 ready runnable `work_item`，并写 `run`、`phase_result`、`artifact` 与运行时 ledger
- `ControllerService` 可以消费 ready runnable `work_item` 与 `depends_on` links，并写 `controller` lineage
- `Observe` 只读 object graph、runtime ledger 与 docs read view
- hooks / scripts / validators 只是辅助执行或读面工具，不是 authority

结果模型与 authority 写边界在本轮也一并冻结：

- `ThothObject` envelope 是所有长期 authority 对象的统一外壳，固定字段为 `schema_version`、`object_id`、`kind`、`status`、`title`、`summary`、`revision`、`created_at`、`updated_at`、`source`、`links`、`payload`、`history`
- `RunResult` 是单次控制命令结果 read/ledger 对象，主落在 `.thoth/runs/<run_id>/result.json`，对应 object graph 中的 `run` / `phase_result` / `artifact`
- work-level 当前结论只作为 `.thoth/docs/work-results/<work_id>.result.json` read view；原始执行真相仍以 object graph 与 run 历史为准
- `sync` 可以按 canonical object graph 与 run 历史重建 docs read view
- 允许写 authority 的只剩 `Store` API 及其上的 Domain Service
- `Observe`、hooks、validators 和任何 read model 都不得偷偷修 authority
- `review` 的 public contract 冻结为 live-only，不保留 `--sleep` 口子
- `loop` 只通过 `controller` 对同一个 `work_id@revision` 反复创建 child run，直到 validated、budget exhausted、failed 或 stopped
- `eval_contract` 与 `runtime_policy` 已成为 runnable `work_item` 的 runtime-hard 合同；CLI 不提供高优先级覆盖入口

2026-04-29 对上述模型作出替换性收敛：

- `Plan` 不再是 `Decision -> Contract -> Task` compiler；它现在只通过 `Store` 写 `discussion`、`decision`、`work_item` 对象，并生成 `.thoth/docs` 只读视图。
- `Contract` 不再是对象 kind；原 contract 的 goal、context、constraints、execution plan、eval contract、runtime policy 与 decisions 已并入 `work_item.payload`。
- `work_result` 不再是 `.thoth/project/tasks` authority；work-level 当前结论只作为 `.thoth/docs/work-results/*.result.json` read view，原始执行真相仍来自 `run`、`phase_result` 与 `artifact` 对象及 `.thoth/runs/*` ledger。
- `run` 固定绑定 `work_id@revision`，只做一次 `plan -> execute -> validate -> reflect` 最小执行尝试。
- `loop`、`orchestration`、`auto` 是 `controller` service：loop 产生 child runs，orchestration 记录 depends_on DAG batches，auto 记录线性 queue cursor。
- active run/controller 引用的 `work_item` 完全锁定；`Store.update/tombstone/link/unlink` 对该 work item 必须拒绝。

## Workstreams

- `WS-001` `[active]`: 分支治理与 `main` 隔离
- `WS-002` `[active]`: `.thoth` authority runtime 收敛
- `WS-003` `[active]`: 当前插件产品稳定化
- `WS-004` `[active]`: 官方平台资料真源治理
- `WS-005` `[active]`: 整体架构简化、高维分层冻结与冗余包装清理

## Milestones

- `MS-001` `[ready]`: `dev` 控制平面文档系统公开化并保持可恢复
- `MS-002` `[backlog]`: `dev -> main` 分离策略机制化
- `MS-003` `[backlog]`: 当前插件产品面稳定化
- `MS-004` `[backlog]`: Thoth V2 迁移设计冻结
- `MS-005` `[active]`: 在不丢功能和不改验收语义的前提下完成 Thoth 的整体简化重构，并以 `heavy` 双宿主命令协议 gate 收口

## Major Planning Decisions

- 2026-04-22: 目标架构收敛为 `Thoth 主控 + .thoth authority + durable runtime`
- 2026-04-23: 当前 repo 明确采用 `dev` 控制平面 / `main` 发布面的双分支职责模型
- 2026-04-23: 当前插件产品面以显式 `/thoth:*` 和 executor-mode Codex 为准，不再公开内部模块或 `:codex` 变体
- 2026-04-23: `Codex` / `Claude Code` 官方资料被纳入 `.agent-os/official-sources/`，并受 authority / freshness 规则治理
- 2026-04-25: 本轮实现优先级改为“整体简化 + 高维分层清晰化 + 协议确定化”；closing gate 已由用户收窄为 `Codex-only`
- 2026-04-25: 本轮最高层架构固定为 `Surface / Plan / Run / Observe`，并在其内冻结七个实现子层
- 2026-04-25: 本轮结果模型固定为 `RunResult + work_result`，run ledger canonical 文件集固定为 `run/state/events/result/artifacts`
- 2026-04-25: 旧顶层内部模块路径不再保留兼容主链；canonical Python 实现统一迁入 `thoth/surface`、`thoth/plan`、`thoth/run`、`thoth/init`、`thoth/observe`
- 2026-04-26: 用户最新收口计划锁定为 `dev` only：完成 Codex-only fast gate 后只提交并推送 `dev`，本轮不 cherry-pick 到 `main`、不 push `main`、不刷新本机 Claude/Codex 安装
- 2026-04-28: 用户已批准恢复标准分支收尾流程；本轮在 `dev` 验证并提交后，需要仅将发布面代码 `cherry-pick` 到 `main`、推送两个分支，并刷新本机 Claude/Codex 的 Thoth 安装
- 2026-04-28: 用户重新锁定当前验证合同为“atomic selftest cases + targeted pytest runs”：`python -m thoth.selftest` 只允许显式 `--case`，发布/回归/关闭门改为显式 case list；`pytest` 默认只允许显式 file/nodeid 或 `--thoth-target`，broad sweeps 仅保留给显式豁免场景
- 2026-04-29: 用户锁定“统一对象图 + Agent Runtime Kernel”重构：`.thoth/objects/<kind>/<object_id>.json` 成为唯一 canonical authority；`Contract` kind 删除并并入 `work_item.payload`；`run` 固定为 `work_id@revision` 的最小 phase chain；`loop` / `orchestration` / `auto` 收敛为 controller service；active run/controller 引用的 work item 完全不可变。
