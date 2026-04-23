# Architecture And Milestones

## Current Design

当前 checkout 的真实结构是一个 Claude-hosted plugin 代码仓，核心组成如下：

- 公开命令定义：`commands/`
- 内部合同层：`contracts/`
- 内部 worker：`agents/`
- 插件脚本：`scripts/`
- 模板与生成物：`templates/`
- hooks：`hooks/`
- 单元与集成测试：`tests/`

当前已实现事实：

- 公开命令面是 `/thoth:*`
- Codex 以 executor-mode 进入 `run` / `loop` / `review`
- 内部公开 skills 与独立公开 `:codex` 变体已经被收敛掉
- 当前 repo 还没有 `.thoth/` authority runtime、durable supervisor、run ledger、lease registry

## Target Architecture

未来 `Thoth V2` 目标架构来自 2026-04-22 的收敛式规划，关键目标为：

- `.thoth/` 作为机器权威层
- repo ledger 为 authority，SQLite 只作派生索引
- `Thoth 主控`，外部 Codex 仅为 worker
- `--unbounded` implies `--durable`
- adoption/init 走 audit-first preview/apply 流程
- 一条 repo scope 主 loop + attach/takeover/lease 机制

因此，本仓库当前要同时维护两个层次：

- 当前插件实现层
- 未来 runtime 收敛层

两者不能混淆。

详细承载文档：

- `planning/legacy-plugin-blueprint.md`
- `planning/decision-trace.md`
- `planning/target-architecture.md`
- `planning/open-questions.md`

## Workstreams

- `WS-001` `[active]`: 分支治理与 `main` 隔离
  - 目标：把 `dev` 的控制平面文档与 `main` 的发布面彻底分开
  - 当前状态：已锁定原则，尚未机制化

- `WS-003` `[active]`: 当前插件产品稳定化
  - 目标：稳定 `/thoth:*` 命令面、安装面、README、测试护栏与内部 surface clean-up
  - 当前状态：已有一轮收敛落地，但仍需持续验证与打磨

- `WS-002` `[planned]`: Thoth V2 架构收敛
  - 目标：把 `.thoth` authority、durable runtime、adopt/init、merge stage、dashboard contract 做成真实系统
  - 当前状态：设计高信息量材料已被吸收进 `.agent-os/planning/`，但代码仍未落地

## Milestones

- `MS-001` `[ready]`: `dev` 控制平面文档系统落地
  - Related workstreams: `WS-001`, `WS-003`
  - Acceptance: 根 `AGENTS.md` / `CLAUDE.md` / `.agent-os/` 完整存在并通过项目状态校验

- `MS-002` `[backlog]`: `dev -> main` 分离策略机制化
  - Related workstreams: `WS-001`
  - Acceptance: 仓库内存在清晰、可执行的 path policy / merge policy / review policy，使 `main` 默认不接收动态开发态文档

- `MS-003` `[backlog]`: 当前插件产品面稳定化
  - Related workstreams: `WS-003`
  - Acceptance: `/thoth:*` 公开命令面、安装面、README、测试面之间无明显漂移

- `MS-004` `[backlog]`: Thoth V2 迁移设计冻结
  - Related workstreams: `WS-002`
  - Acceptance: 当前实现与目标 `.thoth` runtime 之间的迁移图、run file map、acceptance schema、lease/attach 协议达到 decision-complete

## Major Planning Decisions

- 2026-04-22: 目标架构从“更完整的 Claude plugin 蓝图”收敛到“Thoth 主控 + `.thoth` authority + durable runtime”
- 2026-04-23: 当前 repo 明确采用 `dev` 控制平面 / `main` 发布面的双分支职责模型
- 2026-04-23: 当前插件产品面以显式 `/thoth:*` 和 executor-mode Codex 为准，不再使用公开内部模块或公开 `:codex` 变体
- 2026-04-23: 早期完整插件蓝图、逐轮决策轨迹、V2 目标架构摘要与开放协议问题均已迁入 `.agent-os/planning/`
