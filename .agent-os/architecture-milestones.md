# Architecture And Milestones

## Current Design

当前 checkout 的真实结构是一个双宿主插件代码仓，核心组成如下：

- 公开命令定义：`commands/`
- 内部合同层：`contracts/`
- 内部 worker：`agents/`
- 插件脚本：`scripts/`
- 模板与生成物：`templates/`
- hooks：`hooks/`
- 单元与集成测试：`tests/`
- canonical Python 实现骨架：`thoth/surface`、`thoth/plan`、`thoth/run`、`thoth/init`、`thoth/observe`

当前已实现事实：

- 公开命令面是 Claude `/thoth:*` 与 Codex `$thoth <command>`
- Codex 以 executor-mode 进入 `run` / `loop` / `review`
- `/thoth:init` 采用 audit-first adopt/init，并生成最小 `.thoth/` authority tree
- `.thoth/project/` 已包含 strict planning authority：`decisions/`、`contracts/`、生成的 `tasks/`
- `run` / `loop` 已收敛为 strict task execution：默认只接受 `--task-id`
- `review` 已收敛为 live-only；CLI 允许显式 `--task-id`，也可按 task `review_binding.target` 反推绑定任务
- 当前 task 级当前结论写入 `.thoth/project/tasks/*.result.json`，`sync` 会按 run 历史重建它们
- 当前单次运行结果统一写入 `.thoth/runs/<run_id>/result.json`，不再把 `acceptance.json` 当主结果文件
- 当前 run ledger 的长期 canonical 文件集已收敛为 `run.json`、`state.json`、`events.jsonl`、`result.json`、`artifacts.json`
- heartbeat 当前写入 `state.json.last_heartbeat_at`，而不是单独的 `heartbeat.json`
- `loop` 会按 `task_id + review_binding.target + TaskResult.last_closure_at` 自动吸收新鲜 review findings
- dashboard 模板可以把 `.thoth/runs/*` 的 active run、history run 和事件日志绑定回 task 视图
- 仓库具备双层自测试系统：`hard` 为默认 repo-real gate，`heavy` 追加浏览器层与宿主矩阵
- 仓库级 pytest 已切成三层开发验证面：`light`、`medium`、`heavy`
- `heavy` 主门禁已切到 deterministic Python seed repo，重点验证 `run` / `review` / `loop` 的 ledger 闭环与双宿主 public command 语义

本轮已经完成的结构性收敛：

- 旧的顶层内部主实现 `thoth/runtime.py`、`thoth/task_contracts.py`、`thoth/project_init.py`、`thoth/claude_bridge.py`、`thoth/host_hooks.py` 已从主链删除
- `thoth/cli.py` 与 `thoth/selftest.py` 仅保留公共入口角色
- `scripts/status.py`、`scripts/report.py`、`scripts/doctor.py`、`scripts/sync.py`、`scripts/init.py` 均已退化为 canonical Python API wrapper，而不再承载平行实现
- dashboard 控制面已切到 `thoth.observe.dashboard` Python service，不再以 `scripts/dashboard.sh` 作为 CLI 主逻辑

## Target Architecture

未来 `Thoth V2` 的目标方向保持不变，但本轮先冻结一套更清晰的高维分层架构，作为当前代码简化和后续 V2 收敛的共同骨架：

- `.thoth/` 作为机器权威层
- repo ledger 为 authority，SQLite 只作派生索引
- `Thoth 主控`，外部 Codex 作为 worker
- adoption/init 走 audit-first preview/apply 流程
- durable runtime 具备 attach / lease / resume / stop 等完整生命周期

本轮冻结的最高层骨架如下：

1. `Surface`
   - 只包含 public command contract 和 host adapter
   - 负责统一命令语义、参数、输出信封，以及 Claude/Codex 宿主适配
   - 不承载 authority 逻辑
2. `Plan`
   - 只包含 `Decision -> Contract -> Task` compiler
   - `discuss` 写入后立即编译
   - 不直接承载运行结果，也不管理 `TaskResult`
3. `Run`
   - 包含 runtime protocol、execution orchestration、project materialization
   - 负责 `init` / `sync`、`run` / `loop` / `review` / `extend`、live/sleep、lease、worker、结果落账
   - 这是唯一承接 prompt-bearing control commands 的核心实现层
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

- `Surface -> Plan / Run / Observe`
- `Plan` 只产出 task authority，不读写执行结果
- `Run` 可以消费 `Task`，并写运行结果与运行时状态
- `Observe` 只读 `Plan` 和 `Run` 产物
- hooks / scripts / validators 只是辅助执行或读面工具，不是 authority

结果模型与 authority 写边界在本轮也一并冻结：

- `RunResult` 是单次控制命令结果对象，统一覆盖 `run` / `loop` / `review`，主落在 `.thoth/runs/<run_id>/result.json`
- `TaskResult` 是 task 级当前结论对象，主落在 `.thoth/project/tasks/<task_id>.result.json`
- 一个 task 只有一个当前 `TaskResult`，但可以有多个历史 `RunResult`
- `TaskResult` 是正式长期文件，但属于派生当前态；原始执行真相仍以 run 历史为准
- `sync` 可以按 canonical run 历史重建 `TaskResult`
- 允许写 authority 的只剩 `Plan`、`Run` 和 `Run` 内部的 `Project Materialization`
- `Observe`、hooks、validators 和任何 read model 都不得偷偷修 authority
- `review` 的 public contract 冻结为 live-only，不保留 `--sleep` 口子
- `loop` 只消费同 `task_id + target` 且晚于 `TaskResult.last_closure_at` 的 review findings

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
- `MS-005` `[active]`: 在不丢功能和不改验收语义的前提下完成 Thoth 的整体简化重构，并以 `Codex-only` closing gate 收口

## Major Planning Decisions

- 2026-04-22: 目标架构收敛为 `Thoth 主控 + .thoth authority + durable runtime`
- 2026-04-23: 当前 repo 明确采用 `dev` 控制平面 / `main` 发布面的双分支职责模型
- 2026-04-23: 当前插件产品面以显式 `/thoth:*` 和 executor-mode Codex 为准，不再公开内部模块或 `:codex` 变体
- 2026-04-23: `Codex` / `Claude Code` 官方资料被纳入 `.agent-os/official-sources/`，并受 authority / freshness 规则治理
- 2026-04-25: 本轮实现优先级改为“整体简化 + 高维分层清晰化 + 协议确定化”；closing gate 已由用户收窄为 `Codex-only`
- 2026-04-25: 本轮最高层架构固定为 `Surface / Plan / Run / Observe`，并在其内冻结七个实现子层
- 2026-04-25: 本轮结果模型固定为 `RunResult + TaskResult`，run ledger canonical 文件集固定为 `run/state/events/result/artifacts`
- 2026-04-25: 旧顶层内部模块路径不再保留兼容主链；canonical Python 实现统一迁入 `thoth/surface`、`thoth/plan`、`thoth/run`、`thoth/init`、`thoth/observe`
