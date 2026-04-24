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

当前已实现事实：

- 公开命令面是 Claude `/thoth:*` 与 Codex `$thoth <command>`
- Codex 以 executor-mode 进入 `run` / `loop` / `review`
- `/thoth:init` 采用 audit-first adopt/init，并生成最小 `.thoth/` authority tree
- `.thoth/project/` 已包含 strict planning authority：`decisions/`、`contracts/`、生成的 `tasks/`
- `run` / `loop` 已收敛为 strict task execution：默认只接受 `--task-id`
- dashboard 模板可以把 `.thoth/runs/*` 的 active run、history run 和事件日志绑定回 task 视图
- 仓库具备双层自测试系统：`hard` 为默认 repo-real gate，`heavy` 追加浏览器层与宿主矩阵

## Target Architecture

未来 `Thoth V2` 的目标方向保持不变：

- `.thoth/` 作为机器权威层
- repo ledger 为 authority，SQLite 只作派生索引
- `Thoth 主控`，外部 Codex 作为 worker
- adoption/init 走 audit-first preview/apply 流程
- durable runtime 具备 attach / lease / resume / stop 等完整生命周期

## Workstreams

- `WS-001` `[active]`: 分支治理与 `main` 隔离
- `WS-002` `[active]`: `.thoth` authority runtime 收敛
- `WS-003` `[active]`: 当前插件产品稳定化
- `WS-004` `[active]`: 官方平台资料真源治理

## Milestones

- `MS-001` `[ready]`: `dev` 控制平面文档系统公开化并保持可恢复
- `MS-002` `[backlog]`: `dev -> main` 分离策略机制化
- `MS-003` `[backlog]`: 当前插件产品面稳定化
- `MS-004` `[backlog]`: Thoth V2 迁移设计冻结

## Major Planning Decisions

- 2026-04-22: 目标架构收敛为 `Thoth 主控 + .thoth authority + durable runtime`
- 2026-04-23: 当前 repo 明确采用 `dev` 控制平面 / `main` 发布面的双分支职责模型
- 2026-04-23: 当前插件产品面以显式 `/thoth:*` 和 executor-mode Codex 为准，不再公开内部模块或 `:codex` 变体
- 2026-04-23: `Codex` / `Claude Code` 官方资料被纳入 `.agent-os/official-sources/`，并受 authority / freshness 规则治理
