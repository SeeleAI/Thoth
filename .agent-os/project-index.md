# Project Index

## Current Truth

- Objective: `OBJ-001`
- Top next action: `TD-001`
- Active workstreams: `WS-001`, `WS-003`, `WS-002`, `WS-004`
- Active blockers: `none`

## Objective Summary

- `OBJ-001`: 将当前 `Thoth` 仓库在 `dev` 分支上建设为可恢复、可审计、可长期自治协作的开发控制平面：一方面准确维护当前 Claude-hosted plugin 的真实实现状态，另一方面把 `Thoth V2` / `.thoth` authority / durable runtime 作为明确的后续收敛目标；同时建立 `dev` 与 `main` 的硬边界，保证开发态文档不被错误带入发布面。

## Active Workstreams

- `WS-001` `[active]`: 分支治理与 `main` 隔离。把 `dev` 作为开发控制平面，把 `main` 作为稳定发布面，并将 `cherry-pick` 作为默认集成策略。
- `WS-003` `[active]`: 当前插件产品稳定化。围绕 `/thoth:*` 命令面、安装行为、surface clean-up、README 与测试护栏继续收敛现有实现。
- `WS-002` `[planned]`: Thoth V2 架构收敛。把 `.thoth` 作为机器权威层、把 durable runtime 和 adoption/migration 协议落成真实系统。
- `WS-004` `[active]`: 外部平台知识真源治理。把 `Codex` / `Claude Code` 官方资料解析、刷新策略与 authority 边界固化进 `.agent-os/official-sources/` 与 `AGENTS.md`。

## Top Next Action

- `TD-001` `[ready]`: 将 `dev` / `main` 分流规则进一步固化为仓库内可执行治理机制，至少明确：
  - 哪些路径属于 `dev` 动态状态面
  - `main` 如何避免接收这些路径
  - `cherry-pick` 作为默认集成策略的执行约束

## Active Blockers

- None. 当前没有阻止初始化后继续推进的外部阻塞；后续若需要机制化阻止 `main` 接收开发态文档，应作为 `WS-001` 的实施工作项而不是 blocker。

## Recent Important Changes

- 2026-04-23: `/thoth:init` 已升级为 audit-first adopt/init：会先审计 repo 现状，再写 `.thoth/migrations/<migration_id>/audit.json|preview.json|rollback.json|apply.json` 与 `.thoth/project/source-map.json`，并保留已有 `docs/` 与 `.agent-os/` 内容。
- 2026-04-23: 根 `AGENTS.md` 已写明双宿主同步开发与固定收尾流程：新功能必须同时兼顾 Claude Code / Codex；每次开发完成都要 `dev -> main -> push both -> update local installs`。
- 2026-04-23: `.codex-plugin/plugin.json` 已对齐到官方 Codex plugin manifest 形状，并把 `.agents/skills/thoth/agents/openai.yaml` 纳入生成链路与测试护栏。
- 2026-04-23: `README.md` 已补齐 Codex native 的 GitHub marketplace 安装/升级路径；`dev` 已提交、`main` 已通过 `cherry-pick` 同步并 push。
- 2026-04-23: 已在当前机器上完成 Codex marketplace 卸载重装 + GitHub source 验证，并把 Claude marketplace 切回 GitHub source 后重新安装 `thoth@thoth`。
- 2026-04-23: 审查并收敛了公开命令面，移除了公开内部 skills 与独立公开 `:codex` 变体，并恢复了显式 `/thoth:*` 公共命令名。
- 2026-04-23: 创建 `dev` 分支并发布到 `origin/dev`，作为后续开发控制平面分支。
- 2026-04-23: 基于 `agent-project-system` 初始化本仓库的 `dev` 状态文档系统，并将当前实现事实与 V2 规划材料重新对齐。
- 2026-04-23: 已把外部 5 份 Thoth 规划文档完整吸收进 `.agent-os/planning/`，形成 repo-local 的蓝图、决策轨迹、目标架构与开放问题文档。
- 2026-04-23: 新增 `.agent-os/official-sources/`，用于承载 `Codex` / `Claude Code` 官方资料解析、刷新阈值与真源治理规则。
- 2026-04-23: 已完成 15 个官方来源的登记与综合解析，并把 authority / freshness 规则写入 `AGENTS.md`。
- 2026-04-23: `/thoth:init` 已开始生成最小 `.thoth/` authority tree；dashboard 模板已支持 task 绑定 active run、history run 和 run logs，并采用 10 分钟 smart polling。
- 2026-04-23: 新增 `scripts/selftest.py` / `thoth.selftest` 双层自测试系统；默认 `hard` 档已能真实验证 temp repo、run/loop 生命周期、dashboard backend、hooks、lease conflict、stale heartbeat、resume 与 restart。
- 2026-04-23: 当前全量回归已扩展到 `139 passed`，并新增 process-real integration tests 覆盖 dashboard 真实进程与 runtime 生命周期。
- 2026-04-24: `.thoth/project` 已新增 strict `Decision -> Contract -> Task` authority compiler；`run` / `loop` 现在只执行编译生成的 `task_id`，旧 `.agent-os/research-tasks/*.yaml` 被降级为 legacy 审计面而非执行真源。
- 2026-04-24: dashboard backend 已优先读取 `.thoth/project/tasks/*.json`、并新增 compiler/decision/contract API；前端与状态 badge 已补齐 `ready` / `invalid` / `failed` strict-task 状态。
- 2026-04-24: 本轮 strict task 改造验证通过：`pytest -q` -> `161 passed in 268.64s`，`npm run build` 通过，`python scripts/selftest.py --tier hard --hosts none` -> `overall_status=passed`
- 2026-04-24: strict-cut 已继续收口：修复了 `/thoth:init` 在新仓库上写 `.agent-os/milestones.yaml` 的阻塞问题，清除了未进入生成链路的 legacy `.research-config.yaml` / `research-tasks` 模板面，并再次通过 `pytest -q`、`npm run build` 与 `python scripts/selftest.py --tier hard --hosts none`

## Read Next

- [requirements.md](requirements.md)
- [architecture-milestones.md](architecture-milestones.md)
- [todo.md](todo.md)
- [run-log.md](run-log.md)
- [planning/source-register.md](planning/source-register.md)
- [official-sources/source-governance.md](official-sources/source-governance.md)
