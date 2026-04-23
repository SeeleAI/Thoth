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

## Failed Or Pending Checks

- `EV-005` related to `WS-002`: 完整 `.thoth` durable runtime 仍未在当前 checkout 中实现
  - Evidence: 虽然当前已落最小 `.thoth/` authority tree 与 run-ledger dashboard contract，但仍没有 durable supervisor、lease registry、attach/takeover lifecycle
  - Conclusion: `Thoth V2` 已有局部落地，但完整 runtime 仍未实现
  - Next action: 按 `TD-003`、`TD-005`、`TD-006` 整理迁移主线与差距清单

- `EV-006` related to `WS-001`: `main` 对开发态文档的拒收机制尚未机制化
  - Evidence: 当前只锁定了规则和默认集成策略，尚未实现 path guard / CI / merge helper 等仓库机制
  - Conclusion: `dev` / `main` 分离已经被决策锁定，但仍未完成可执行保护
  - Next action: 推进 `TD-001` 与 `TD-004`

- `EV-007` related to `WS-002`: 当前 `scripts/init.py` 与目标 audit-first adopt/init 语义尚未对齐
  - Evidence: 规划材料明确要求 audit-first preview/apply，而当前实现仍以现有 scaffold/初始化语义为主
  - Conclusion: 当前 init 行为与 V2 adoption/init 目标之间存在真实差距
  - Next action: 推进 `TD-005`
