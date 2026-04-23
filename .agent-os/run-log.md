# Run Log

## Entries

- 2026-04-23 00:00 UTC [dev project system adoption]
  - Worked on: `OBJ-001`, `WS-001`, `WS-003`, `WS-002`, `TD-007`
  - State changes: no state docs -> root contract + `.agent-os/` initialized; `TD-007` backlog -> done -> verified
  - Evidence produced: root `AGENTS.md`, `CLAUDE.md`, `.agent-os/` document set, project-system validation passed, `pytest -q` passed (`110 passed in 1.66s`)
  - Next likely action: 推进 `TD-001`，把 `dev` / `main` 分流规则固化成仓库内可执行治理机制

- 2026-04-23 00:00 UTC [planning source consolidation]
  - Worked on: `OBJ-001`, `WS-002`, `TD-009`
  - State changes: 外部规划路径依赖 -> repo-local `.agent-os/planning/` 承载；`TD-009` -> verified
  - Evidence produced: `planning/source-register.md`, `planning/legacy-plugin-blueprint.md`, `planning/decision-trace.md`, `planning/target-architecture.md`, `planning/open-questions.md`
  - Next likely action: 回到 `TD-001` 与 `TD-003`，分别推进分支治理机制化和 V2 decision-complete 迁移主线

- 2026-04-23 04:04 UTC [official platform source governance]
  - Worked on: `OBJ-001`, `WS-004`, `TD-010`
  - State changes: 无外部平台真源层 -> 新增 `.agent-os/official-sources/`；`TD-010` -> verified；`project-index` top next action 切回 `TD-001`
  - Evidence produced: `official-sources/platform-index.md`, `official-sources/source-governance.md`, `official-sources/openai-codex-and-api.md`, `official-sources/claude-code-runtime-and-platforms.md`, `official-sources/codex-vs-claude-code.md`, updated `AGENTS.md`
  - Next likely action: 验证结构校验通过，并继续推进 `TD-001` 与 `TD-003`

- 2026-04-23 00:00 UTC [task-first run ledger dashboard contract]
  - Worked on: `OBJ-001`, `WS-002`, `WS-003`, `TD-011`
  - State changes: dashboard 从纯 YAML 现算视图 -> 新增 `.thoth/runs/*` 运行事实读取；`/thoth:init` 开始生成最小 `.thoth/` authority tree；`TD-011` -> verified
  - Evidence produced: `templates/dashboard/backend/runtime_loader.py`, updated dashboard APIs and frontend task view, updated `scripts/init.py`, new runtime API tests, `pytest -q` passed (`115 passed in 2.11s`)
  - Next likely action: 继续推进 `TD-001`，并把当前最小 run-ledger contract 向完整 durable supervisor / lease protocol 收敛

- 2026-04-23 00:00 UTC [frontend dashboard build validation]
  - Worked on: `OBJ-001`, `WS-003`, `TD-011`
  - State changes: dashboard 前端从“已改代码但未完成构建验证” -> `vue-tsc` 与 `vite build` 均通过；补齐 task-first runtime UI 的前端可构建证据
  - Evidence produced: fixed `templates/dashboard/frontend/src/components/charts/DagChart.vue` event typing drift; `npm run build` passed in `templates/dashboard/frontend`; generated production bundle under `templates/dashboard/frontend/dist/`
  - Next likely action: 回到 `TD-001` 推进 `dev` / `main` 分流机制化，并继续把当前最小 runtime contract 向 durable supervisor / lease protocol 收敛

- 2026-04-23 08:03 UTC [branch governance cutover to dev]
  - Worked on: `OBJ-001`, `WS-001`
  - State changes: 当前未提交的 host-neutral runtime / Codex surface 改造已先在 `main` 提交，再 merge 到 `dev`；仓库治理从“`dev` 是控制平面”强化为“所有默认开发都必须在 `dev`，未经批准不得直接修改 `main`”
  - Evidence produced: `main` commit `a93b12b`, `dev` merge commit `de6db3f`, updated root `AGENTS.md`, `CLAUDE.md`, `.agent-os/requirements.md`, `.agent-os/change-decisions.md`, `README.md`
  - Next likely action: 继续在 `dev` 上推进后续 Thoth runtime 与治理工作，并把面向 `main` 的集成保持为精选进入

- 2026-04-23 09:00 UTC [heavy selftest system hardening]
  - Worked on: `OBJ-001`, `WS-003`, `TD-012`
  - State changes: 测试面从偏函数/接口断言 -> 新增双层自测试系统；runtime 增加 `--task-id` 与 `loop --resume` 真生命周期支点；dashboard 与 frontend 增加 process-real / browser-real 验证注入点
  - Evidence produced: `scripts/selftest.py`, `thoth/selftest.py`, `tests/integration/test_runtime_lifecycle_e2e.py`, `templates/dashboard/frontend/playwright.config.ts`, `templates/dashboard/frontend/e2e/dashboard-realtime.spec.ts`, `pytest -q` -> `136 passed in 123.85s`, `python scripts/selftest.py --tier hard --hosts none` -> `overall_status=passed`, `npm run build` passed
  - Next likely action: 完成 Chromium 浏览器缓存预热并再次执行 `python scripts/selftest.py --tier heavy --hosts auto`，补齐 `heavy` 档全绿证据

- 2026-04-23 10:04 UTC [heavy selftest host-real closure]
  - Worked on: `OBJ-001`, `WS-003`, `TD-012`
  - State changes: `heavy` 档从“浏览器层仍有 deep-link / Playwright / host harness 漂移” -> “dashboard.browser_realtime passed, host.codex passed, host.claude only degrades on transient upstream outage”; Codex public skill 生成物补齐 YAML frontmatter 与 repo-local CLI guidance；Claude host harness 改为 root-safe permission mode + `--verbose`
  - Evidence produced: `templates/dashboard/backend/app.py`, `templates/dashboard/frontend/e2e/dashboard-realtime.spec.ts`, `thoth/projections.py`, `.agents/skills/thoth/SKILL.md`, `thoth/selftest.py`, `tests/unit/test_command_spec_generation.py`, `tests/unit/test_plugin_surface.py`; `pytest -q tests/unit/test_command_spec_generation.py tests/unit/test_plugin_surface.py tests/unit/test_dashboard_runtime_api.py` -> `13 passed in 0.64s`; `python scripts/selftest.py --tier heavy --hosts codex --keep-workdir` -> `overall_status=degraded` with `host.codex=passed`; `python scripts/selftest.py --tier heavy --hosts claude --keep-workdir` -> `overall_status=degraded` with transient `host.claude=degraded`; `python scripts/selftest.py --tier heavy --hosts auto --keep-workdir` -> `overall_status=degraded` with `dashboard.browser_realtime=passed`, `host.codex=passed`, `host.claude=degraded`
  - Next likely action: 若后续需要把 `heavy` 默认路径提升到纯 `passed`，重点不在 Thoth 本身，而在当前机器上的 Claude host 上游可用性恢复后重跑验证

- 2026-04-23 15:05 UTC [official Codex plugin alignment and remote reinstall verification]
  - Worked on: `OBJ-001`, `WS-003`, `WS-004`, `TD-002`
  - State changes: Codex plugin manifest 从 repo 自定义字段 -> 官方 metadata + `interface` schema；README 从“Claude 为主、Codex 文案不足” -> Claude/Codex 双宿主安装说明一致；`TD-002` ready -> verified
  - Evidence produced: `dev` commit `8584783`, `main` cherry-pick commit `3894507`, generated `.agents/skills/thoth/agents/openai.yaml`, updated `README.md`; `pytest -q tests/unit/test_command_spec_generation.py tests/unit/test_plugin_surface.py` -> `12 passed in 0.24s`; `pytest -q` -> `139 passed in 113.87s`; `python scripts/selftest.py --tier hard --hosts none` -> `overall_status=passed`; `npm run build` passed; `codex plugin marketplace remove thoth && codex plugin marketplace add Royalvice/Thoth` passed and `codex exec` in `/tmp` returned `Project: /tmp` / `Active runs: 0`; `claude plugin marketplace add https://github.com/Royalvice/Thoth.git` + `claude plugin install thoth@thoth --scope user` passed
  - Next likely action: 回到 `TD-001`，继续把 `dev` / `main` 分流规则从文档约束推进到可执行保护机制

- 2026-04-23 15:12 UTC [legacy Codex rescue note folded into changelog]
  - Worked on: `OBJ-001`, `WS-003`
  - State changes: 历史遗留 `docs/legacy-codex-rescue.md` 从独立留档 -> 合并进 `CHANGELOG.md` 的 0.1.2 迁移说明；孤立 `docs/` 文档目录被清空
  - Evidence produced: `CHANGELOG.md` 已补充“专用 Codex 变体命令 + rescue agent 已退役、由更小的 `/thoth:*` + --executor codex 替代”的迁移说明；`docs/legacy-codex-rescue.md` 已删除
  - Next likely action: 继续保持历史迁移说明尽量收敛在 changelog 或权威状态文档中，避免新的孤立遗留说明文件

- 2026-04-23 15:35 UTC [advisory host hook upgrade for Claude and Codex]
  - Worked on: `OBJ-001`, `WS-003`
  - State changes: Claude 插件级 hook 从“仅打印 project detected / check summary” -> “SessionStart/SessionEnd 追加标准化 hook note、active-run hook event、heartbeat 刷新与 advisory context”；Codex project hook 从“仅生成一个 session-end check 配置” -> “官方 `.codex/hooks.json` 下的 SessionStart/Stop 轻量观测层 + project-local `thoth-codex-hook.sh` 包装”
  - Evidence produced: 新增 `thoth/host_hooks.py` 与 `thoth hook` 子命令；更新 `scripts/session-hook.py`、`hooks/hooks.json`、`thoth/project_init.py`、`thoth/selftest.py`；`pytest -q tests/unit/test_host_hooks.py tests/unit/test_init.py tests/integration/test_init_workflow.py tests/integration/test_runtime_lifecycle_e2e.py` -> `31 passed in 81.26s`；`pytest -q` -> `141 passed in 107.59s`；`python scripts/selftest.py --tier hard --hosts none` -> `overall_status=passed`
  - Next likely action: 若后续继续加重 hook，只允许增强宿主感知和观测，不允许让 hooks 取代 `.thoth` authority 或 supervisor lifecycle
