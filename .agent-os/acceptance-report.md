# Acceptance Report

## Passed Checks

- `EV-001` related to `TD-007`: 当前 repo 已完成 `dev` 状态文档系统脚手架初始化
  - Evidence: `AGENTS.md`、`CLAUDE.md`、`.agent-os/` 已由 `agent-project-system/scripts/init_project_system.py` 生成
  - Conclusion: `dev` 控制平面文档系统已建立基础壳体

- `EV-002` related to `WS-003`: 当前插件公开命令面已收敛为显式 `/thoth:*`
  - Evidence: `commands/*.md` frontmatter 以 `name: thoth:*` 形式存在，公开 `:codex` 变体已删除
  - Conclusion: 当前公开 command naming 与最近一次修正后的目标一致

- `EV-003` related to `WS-003`: 当前 checkout 最近一次测试复核通过
  - Evidence: 本轮执行 `pytest -q`，结果为 `110 passed in 1.66s`
  - Conclusion: 在本次文档初始化前，代码仓处于测试通过状态

- `EV-004` related to `TD-007`: `dev` 状态文档系统已通过结构校验
  - Evidence: 本轮执行 `python /root/.codex/skills/agent-project-system/scripts/validate_project_system.py /mnt/cfs/5vr0p6/yzy/thoth --state-dir .agent-os`，结果为 `[OK] Project state document system is valid`
  - Conclusion: 根文档、状态目录、typed IDs、top next action 与 link integrity 当前满足项目状态系统最低要求

- `EV-008` related to `TD-009`: 外部 5 份 Thoth 规划文档已被 repo-local `.agent-os/` 文档系统吸收
  - Evidence: 已新增 `planning/source-register.md`、`planning/legacy-plugin-blueprint.md`、`planning/decision-trace.md`、`planning/target-architecture.md`、`planning/open-questions.md`，并在 `project-index.md`、`requirements.md`、`architecture-milestones.md` 中建立恢复引用
  - Conclusion: 当前仓库已经具备不依赖原始外部路径来恢复规划背景的本地承载层

- `EV-009` related to `TD-010`: `Codex` / `Claude Code` 官方资料解析与真源治理层已建立
  - Evidence: 已新增 `official-sources/platform-index.md`、`official-sources/source-governance.md`、`official-sources/openai-codex-and-api.md`、`official-sources/claude-code-runtime-and-platforms.md`、`official-sources/codex-vs-claude-code.md`；`AGENTS.md` 已加入 authority 与 freshness 规则
  - Conclusion: 当前仓库已具备 repo-local 的外部平台知识治理层，且恢复路径已明确要求在超 freshness 阈值时回官方 latest 页面核验
  - Validation: `python /root/.codex/skills/agent-project-system/scripts/validate_project_system.py /mnt/cfs/5vr0p6/yzy/thoth --state-dir .agent-os` 返回 `[OK] Project state document system is valid`

- `EV-010` related to `TD-011`: task-first 的 run-ledger dashboard contract 已落地
  - Evidence: 新增 `templates/dashboard/backend/runtime_loader.py`；`templates/dashboard/backend/app.py` 暴露 task-bound run APIs；`templates/dashboard/frontend/src/views/TasksPanel.vue` 展示 active run、history run 与 log；`scripts/init.py` 会生成最小 `.thoth/` authority tree
  - Conclusion: 当前模板层已经不再把长时运行监控完全建立在 YAML authority 上，而是具备 `.thoth/runs/* -> dashboard` 的真实数据通路
  - Validation: 本轮执行 `pytest -q`，结果为 `115 passed in 2.11s`；并在 `templates/dashboard/frontend` 执行 `npm run build`，结果为 `vue-tsc --noEmit && vite build` 通过，产物生成于 `dist/`

- `EV-011` related to `TD-012`: 双层重型自测试系统已落地并通过 `hard` 档验证
  - Evidence: 已新增 `scripts/selftest.py`、`thoth/selftest.py`、`tests/integration/test_runtime_lifecycle_e2e.py`、`templates/dashboard/frontend/playwright.config.ts`、`templates/dashboard/frontend/e2e/dashboard-realtime.spec.ts`
  - Conclusion: 当前仓库已不再只依赖函数级/文件级测试，而是具备面向真实 temp repo、真实 CLI 生命周期、真实 dashboard backend、hooks、lease conflict、stale heartbeat 与 resume 的机械化自验证入口
  - Validation: 本轮执行 `pytest -q`，结果为 `136 passed in 123.85s`；执行 `python scripts/selftest.py --tier hard --hosts none` 返回 `overall_status=passed`

- `EV-012` related to `TD-012`: `heavy` 档已闭环到默认 `auto-host` 路径，真实浏览器层与 Codex host 矩阵已通过
  - Evidence: `templates/dashboard/backend/app.py` 已补 SPA deep-link fallback；`templates/dashboard/frontend/e2e/dashboard-realtime.spec.ts` 已收紧到 runtime card 级断言；`thoth/projections.py` 生成的 `.agents/skills/thoth/SKILL.md` 已补合法 YAML frontmatter 与 repo-local CLI 指引；`thoth/selftest.py` 已补 Playwright `PYTHONPATH` 注入、Codex stale-global-CLI 识别、Claude `--verbose` / root-safe permission mode / transient host outage 降级逻辑
  - Conclusion: `heavy` 档当前已能真实验证 dashboard deep-link、实时刷新、stop transition、Codex public skill surface 与 repo-local authority 写入；默认 `python scripts/selftest.py --tier heavy --hosts auto` 不再出现确定性 `failed`
  - Validation:
    - `python scripts/selftest.py --tier heavy --hosts codex --keep-workdir` -> `overall_status=degraded`，其中 `host.codex=passed`，唯一降级项为按模式跳过 `host.claude`
    - `python scripts/selftest.py --tier heavy --hosts claude --keep-workdir` -> `overall_status=degraded`，其中 `host.claude=degraded`，原因为上游/瞬时宿主故障而非 Thoth 确定性失败
    - `python scripts/selftest.py --tier heavy --hosts auto --keep-workdir` -> `overall_status=degraded`，其中 `dashboard.browser_realtime=passed`、`host.codex=passed`、`host.claude=degraded`
  - Residual risk: 当前机器上的 Claude host 仍可能因宿主上游 `503` 或类似瞬时服务问题降级，因此 `heavy` 默认路径在本机仍可能表现为 `degraded` 而非纯 `passed`

- `EV-013` related to `TD-002`: Codex plugin 公开 surface、README 与实际安装行为已重新对齐
  - Evidence: `.codex-plugin/plugin.json` 已切换到官方 metadata + `interface` 形状；`.agents/skills/thoth/agents/openai.yaml` 已由 `thoth.projections.sync_repository_surfaces()` 生成；`README.md` 已新增 Codex GitHub marketplace 安装/升级说明并保留 Claude 流程；`main` 已接收代码提交 `3894507`
  - Conclusion: 当前仓库的 Codex plugin 分发面、README 文案、GitHub 安装结果与单一 `$thoth <command>` public surface 已达成一致，且未回归 Claude Code
  - Validation:
    - `pytest -q tests/unit/test_command_spec_generation.py tests/unit/test_plugin_surface.py` -> `12 passed in 0.24s`
    - `pytest -q` -> `139 passed in 113.87s`
    - `python scripts/selftest.py --tier hard --hosts none` -> `overall_status=passed`
    - `npm run build` in `templates/dashboard/frontend` -> passed
    - `codex plugin marketplace remove thoth && codex plugin marketplace add Royalvice/Thoth` 后，`codex exec -C /tmp --skip-git-repo-check 'Use the installed $thoth skill. Run $thoth status for the current directory and return the raw result only.'` 返回 `Project: /tmp` / `Active runs: 0`
    - `claude plugin uninstall thoth --scope user` 后，`claude plugin marketplace add https://github.com/Royalvice/Thoth.git` 与 `claude plugin install thoth@thoth --scope user` 通过；`claude plugin list` 显示 `thoth@thoth 0.1.4 user enabled`

- `EV-014` related to `TD-013`: `/thoth:init` 已升级为 audit-first adopt/init，而不是空仓库假设式脚手架
  - Evidence: `thoth/project_init.py` 新增 `audit_repository_state()`、`build_init_preview()`、migration backup/source-map 写入与 `initialize_project()` 的 audit/preview/apply 主流程；`scripts/init.py` 与 `$thoth init` 已改为输出审计/迁移摘要；新增 `tests/unit/test_init.py` 与 `tests/integration/test_init_workflow.py` 的 adopt/re-init 覆盖
  - Conclusion: 当前 init 入口已经能先审计 repo 现状，再以 migration ledger 驱动受管更新，并保留已有 `docs/` 与 `.agent-os/` 内容
  - Validation:
    - `python -m py_compile thoth/project_init.py thoth/cli.py thoth/runtime.py scripts/init.py tests/unit/test_init.py tests/integration/test_init_workflow.py` -> passed
    - `pytest -q tests/unit/test_init.py tests/integration/test_init_workflow.py` -> `34 passed in 83.90s`
    - `pytest -q` -> `148 passed in 163.83s`
    - `python scripts/selftest.py --tier hard --hosts none` -> `overall_status=passed`
    - `python /root/.codex/skills/agent-project-system/scripts/validate_project_system.py /mnt/cfs/5vr0p6/yzy/thoth --state-dir .agent-os` -> `[OK] Project state document system is valid`

- `EV-015` related to `TD-014`: strict `Decision -> Contract -> Task` 编译执行体系已落地并通过 repo-real 验证
  - Evidence: 新增 `thoth/task_contracts.py`；`thoth/cli.py`、`thoth/runtime.py`、`thoth/project_init.py` 已接入 strict compiler；dashboard backend 改为优先读取 `.thoth/project/tasks/*.json`，并暴露 `/api/decisions`、`/api/contracts`、`/api/compiler-state`；`thoth/selftest.py`、`tests/integration/test_runtime_lifecycle_e2e.py`、`tests/unit/test_dashboard_runtime_api.py`、`tests/unit/test_task_contracts.py` 已迁移到 strict authority
  - Conclusion: 当前执行权已经从旧 `.agent-os/research-tasks/*.yaml` 切换到 `.thoth/project/decisions|contracts|tasks`，并且 `run` / `loop` 默认只接受编译生成的 `task_id`
  - Validation:
    - `pytest -q` -> `161 passed in 268.64s`
    - `npm run build` in `templates/dashboard/frontend` -> passed
    - `python scripts/selftest.py --tier hard --hosts none` -> `overall_status=passed`

- `EV-016` related to `TD-014`: strict-cut 已完成 init 阻塞修复与 legacy 模板面清理，当前 repo 仅在迁移导入路径保留 legacy 兼容代码
  - Evidence: `thoth/project_init.py` 已修复 `.agent-os/milestones.yaml` 创建顺序并在 `generate_milestones()` 中自建父目录；`README.md`、`contracts/core.md`、`contracts/audit.md` 已全部改写为 `.thoth` strict authority 叙事；`templates/agent-os/`、`templates/hooks/`、`templates/scripts/`、`templates/tests/` 等未进入生成链路的 legacy 模板已删除；`pyproject.toml` 与相关单测已移除对 `templates/agent-os/research-tasks` 的测试依赖
  - Conclusion: 当前仓库已经从“strict runtime + legacy template 残留并存”收敛到“strict runtime + 仅在 init 迁移路径保留 legacy 导入”，不会再把旧 `.research-config.yaml` / `research-tasks` 模板误呈现为当前正式 surface
  - Validation:
    - `pytest -q tests/unit/test_cli_surface.py tests/unit/test_init.py tests/integration/test_init_workflow.py tests/integration/test_runtime_lifecycle_e2e.py` -> `27 passed in 141.39s`
    - `pytest -q tests/unit/test_dashboard_runtime_api.py tests/unit/test_data_loader.py tests/unit/test_status.py tests/unit/test_doctor.py tests/unit/test_report.py tests/unit/test_host_hooks.py tests/unit/test_task_contracts.py` -> `29 passed in 0.98s`
    - `pytest -q` -> `110 passed in 178.31s`
    - `npm run build` in `templates/dashboard/frontend` -> passed
    - `python scripts/selftest.py --tier hard --hosts none` -> `overall_status=passed`

- `EV-017` related to `WS-003`: 仓库已完成对 `SeeleAI/Thoth` 的安全上游迁移，删除 `Royalvice/Thoth` 后不会遗留安装/分发悬空链接
  - Evidence: `git remote set-url origin https://github.com/SeeleAI/Thoth.git` 已执行；`README.md` 中所有 GitHub 安装与链接地址已改为 `SeeleAI/Thoth`；`thoth/projections.py` 中 `PLUGIN_REPOSITORY`、作者 URL 与 `developerName` 已切换；生成后的 `.codex-plugin/plugin.json` 已同步为 `https://github.com/SeeleAI/Thoth`
  - Conclusion: 当前仓库的 canonical upstream、README 安装文案、Codex plugin 元数据和生成源已经一致指向 `SeeleAI/Thoth`；删除旧仓库不会打断公开安装面
  - Validation:
    - `pytest -q tests/unit/test_command_spec_generation.py tests/unit/test_plugin_surface.py` -> `15 passed in 0.30s`
    - `rg -n "Royalvice|github.com/Royalvice/Thoth|Royalvice/Thoth|github.com/Royalvice" . -g '!templates/dashboard/frontend/dist/**' -g '!.git/**'` -> 仅剩 `LICENSE` copyright 署名

## Failed Or Pending Checks

- `EV-005` related to `WS-002`: 完整 `.thoth` durable runtime 仍未在当前 checkout 中实现
  - Evidence: 虽然当前已落最小 `.thoth/` authority tree 与 run-ledger dashboard contract，但仍没有 durable supervisor、lease registry、attach/takeover lifecycle
  - Conclusion: `Thoth V2` 已有局部落地，但完整 runtime 仍未实现
  - Next action: 按 `TD-003`、`TD-005`、`TD-006` 整理迁移主线与差距清单

- `EV-006` related to `WS-001`: `main` 对开发态文档的拒收机制尚未机制化
  - Evidence: 当前只锁定了规则和默认集成策略，尚未实现 path guard / CI / merge helper 等仓库机制
  - Conclusion: `dev` / `main` 分离已经被决策锁定，但仍未完成可执行保护
  - Next action: 推进 `TD-001` 与 `TD-004`
