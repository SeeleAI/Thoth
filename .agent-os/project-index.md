# Project Index

## Current Truth

- Objective: `OBJ-001`
- Top next action: `TD-001`
- Active workstreams: `WS-001`, `WS-002`, `WS-003`, `WS-004`, `WS-005`
- Active blockers: `none`

## Objective Summary

- `OBJ-001`: 将 `Thoth` 维护为一个公开、可恢复、可审计的 Agent Project OS 仓库，同时保持两条清晰主线：
  - 当前可发布的 Claude Code / Codex 双宿主插件实现
  - 未来 `.thoth` authority runtime 的继续收敛

## Active Workstreams

- `WS-001` `[active]`: 分支治理与发布隔离
- `WS-002` `[active]`: `.thoth` authority runtime 收敛
- `WS-003` `[active]`: 公开插件 surface、安装面与测试面稳定化
- `WS-004` `[active]`: 官方平台资料治理与 freshness 维护
- `WS-005` `[active]`: Thoth 整体架构简化与高维分层重构

## Top Next Action

- `TD-001` `[ready]`: 将 `dev` / `main` 分流规则固化为仓库内可执行治理机制

## Active Blockers

- None

## Recent Important Changes

- 2026-04-23: `/thoth:init` 已升级为 audit-first adopt/init，并生成最小 `.thoth` authority tree。
- 2026-04-23: 仓库已明确双宿主同步开发与固定收尾流程。
- 2026-04-23: 已建立双层自测试系统，`hard` 档覆盖真实 temp repo、runtime、dashboard 和 hooks。
- 2026-04-24: 已落地 strict `Decision -> Contract -> Task` 执行 authority，`run` / `loop` 默认只接受 `--task-id`。
- 2026-04-24: 仓库 canonical upstream、README 和插件元数据已切换到 `SeeleAI/Thoth`。
- 2026-04-24: dev 分支状态文档已精简为公开版最小集，不再保留私人路径和外部项目来源链。
- 2026-04-25: 用户锁定本轮主目标为“在不丢功能与约束的前提下，大幅简化 Thoth 的整体实现，并先冻结高维分层架构，再完成收口验证”；closing gate 已进一步收窄为 `Codex-only`。
- 2026-04-25: 旧的 `thoth/runtime.py`、`thoth/task_contracts.py`、`thoth/project_init.py`、`thoth/claude_bridge.py`、`thoth/host_hooks.py` 已从主实现路径删除；当前 canonical 包级骨架为 `thoth/surface`、`thoth/plan`、`thoth/run`、`thoth/init`、`thoth/observe`。
- 2026-04-25: 当前代码已落成 `Surface / Plan / Run / Observe` 四层骨架、`RunResult + TaskResult` 双层结果模型、`run/state/events/result/artifacts` canonical run ledger，以及 `review` live-only / `loop` 按 `task_id + target + last_closure_at` 自动消费新鲜 review 的运行规则。
- 2026-04-25: 已完成本轮关键验证切片：targeted unit `50 passed`、integration `9 passed`、selftest/read-model unit `28 passed`、`python -m thoth.selftest --tier hard --hosts none` `25 passed / 0 failed / 0 degraded`；`Codex-only` closing gate 与分支收尾仍未完成，不得视为结束。
- 2026-04-26: 本轮九阶段架构简化已在 `dev` 上完成代码收口：`run/lifecycle.py` 已删除，Run / Plan / Init / Surface / Observe / Selftest 主实现拆入职责模块；WSL Node LTS 与 Codex CLI 已修复；`py_compile`、pytest `light` / `medium`、targeted integration、`hard --hosts none` 与真实 Codex-only fast contract gate 均通过。本轮按用户最新计划只收口 `dev`，不执行 `main` 集成与本机安装刷新。
- 2026-04-27: `run` / `loop` 已进一步收敛为 Python 机械 phase engine：task compiler 默认补 `runtime_contract.loop = {10, 28800}`、frozen task 强制要求 `validate_output_schema`、单次 `run` 固定为 `plan -> exec -> validate -> reflect`、`loop` 固定为父 run 复用 child `run` 的 bounded orchestrator；针对性验证 `37 passed`

## Read Next

- [requirements.md](requirements.md)
- [architecture-milestones.md](architecture-milestones.md)
- [todo.md](todo.md)
- [run-log.md](run-log.md)
- [official-sources/source-governance.md](official-sources/source-governance.md)
