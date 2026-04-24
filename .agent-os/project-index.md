# Project Index

## Current Truth

- Objective: `OBJ-001`
- Top next action: `TD-001`
- Active workstreams: `WS-001`, `WS-002`, `WS-003`, `WS-004`
- Active blockers: `none`

## Objective Summary

- `OBJ-001`: 将 `Thoth` 维护为一个公开、可恢复、可审计的 Agent Project OS 仓库，同时保持两条清晰主线：
  - 当前可发布的 Claude Code / Codex 双宿主插件实现
  - 未来 `.thoth` authority runtime 的继续收敛

## Active Workstreams

- `WS-001` `[active]`: 分支治理与发布隔离
- `WS-002` `[planned]`: `.thoth` authority runtime 收敛
- `WS-003` `[active]`: 公开插件 surface、安装面与测试面稳定化
- `WS-004` `[active]`: 官方平台资料治理与 freshness 维护

## Top Next Action

- `TD-001` `[ready]`: 将 `dev` / `main` 分流规则进一步机制化，减少对人工纪律的依赖

## Active Blockers

- None

## Recent Important Changes

- 2026-04-23: `/thoth:init` 已升级为 audit-first adopt/init，并生成最小 `.thoth` authority tree。
- 2026-04-23: 仓库已明确双宿主同步开发与固定收尾流程。
- 2026-04-23: 已建立双层自测试系统，`hard` 档覆盖真实 temp repo、runtime、dashboard 和 hooks。
- 2026-04-24: 已落地 strict `Decision -> Contract -> Task` 执行 authority，`run` / `loop` 默认只接受 `--task-id`。
- 2026-04-24: 仓库 canonical upstream、README 和插件元数据已切换到 `SeeleAI/Thoth`。
- 2026-04-24: dev 分支状态文档已精简为公开版最小集，不再保留私人路径和外部项目来源链。

## Read Next

- [requirements.md](requirements.md)
- [architecture-milestones.md](architecture-milestones.md)
- [todo.md](todo.md)
- [run-log.md](run-log.md)
- [official-sources/source-governance.md](official-sources/source-governance.md)
