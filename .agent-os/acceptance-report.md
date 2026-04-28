# Acceptance Report

## Passed Checks

- `EV-001` related to `WS-003`: 当前公开命令面已稳定为显式 `/thoth:*` 与单一 `$thoth <command>`
  - Evidence: `commands/*.md`、`.agents/plugins/marketplace.json`、`plugins/thoth/.codex-plugin/plugin.json`、`plugins/thoth/skills/thoth/`
  - Conclusion: 当前公开 surface 与仓库定位一致

- `EV-002` related to `TD-012`: 重型自测试系统已落地
  - Evidence: `scripts/selftest.py`、`thoth/selftest.py`、`thoth/observe/selftest/runner.py`
  - Conclusion: 仓库具备 repo-real 的机械化验证入口

- `EV-003` related to `TD-014`: strict `Decision -> Contract -> Task` 执行 authority 已落地
  - Evidence: `thoth/plan/compiler.py`、`thoth/plan/store.py`、`.thoth/project/tasks` 相关读写逻辑、dashboard compiler 读面
  - Conclusion: `run` / `loop` 默认只接受 `--task-id`；缺少 `--task-id` 时只允许召回现有 task 候选并停下，不允许创建新 task 或触碰代码

- `EV-004` related to `WS-003`: 公开安装面已切换到 `SeeleAI/Thoth`
  - Evidence: `README.md`、`.claude-plugin/`、`.agents/plugins/marketplace.json`、`plugins/thoth/`、`thoth/projections.py`
  - Conclusion: 仓库对外元数据已统一到公开 canonical upstream

- `EV-005` related to `REQ-007`: dev 状态文档已清理私人路径、个人邮箱和外部项目来源链
  - Evidence: `.agent-os/` 已精简为公开版最小集
  - Conclusion: 当前 dev 分支不再暴露无运行必要的私有上下文

- `EV-006` related to `REQ-021`: pytest 三层验证入口已落地
  - Evidence: `tests/conftest.py`、`tests/unit/test_pytest_tiers.py`、`README.md`、`python -m pytest -q --thoth-tier light`、`python -m pytest -q --thoth-tier medium`、`python -m pytest -q --thoth-tier heavy`
  - Conclusion: 仓库已提供 `light` / `medium` / `heavy` 三层 pytest 选择器与使用约定，且本轮验证结果分别为 `1.64s`、`25.40s`、`190.89s`

- `EV-007` related to `REQ-023`, `REQ-024`, `REQ-026`, `REQ-027`: 新四层骨架、双层结果模型与 canonical run ledger 已落到代码主链
  - Evidence: `thoth/surface/*_commands.py`、`thoth/plan/{compiler,store,results,doctor,validators,paths}.py`、`thoth/run/{model,io,lease,ledger,packets,worker,service,status}.py`、`thoth/init/{audit,preview,migration,generators,service}.py`、`thoth/observe/{read_model,status,report,dashboard}.py`、`templates/dashboard/backend/runtime_loader.py`、`templates/dashboard/backend/data_loader.py`
  - Conclusion: 当前代码已经共享 `Surface / Plan / Run / Observe` 的分层约束、`RunResult + TaskResult` 的结果模型、`run/state/events/result/artifacts` 的 run ledger 形态，以及 `review` live-only / `loop` 新鲜 review consumption 规则

- `EV-008` related to `WS-005`: 本轮重构关键切片已通过针对性代码验证
  - Evidence: `python -m py_compile thoth/surface/cli.py thoth/surface/handlers.py thoth/surface/hooks.py thoth/surface/bridges/claude.py thoth/plan/compiler.py thoth/plan/store.py thoth/plan/results.py thoth/plan/doctor.py thoth/run/lifecycle.py thoth/run/status.py thoth/init/service.py thoth/init/render.py thoth/observe/status.py thoth/observe/report.py thoth/observe/dashboard.py thoth/observe/selftest/runner.py scripts/init.py scripts/sync.py scripts/status.py scripts/report.py scripts/doctor.py scripts/session-hook.py`；`python -m pytest -q tests/unit/test_runtime_protocol.py tests/unit/test_runtime_supervisor.py tests/unit/test_task_contracts.py tests/unit/test_init.py tests/unit/test_cli_surface.py tests/unit/test_host_hooks.py tests/unit/test_status.py tests/unit/test_report.py`；`python -m pytest -q tests/integration/test_init_workflow.py tests/integration/test_runtime_lifecycle_e2e.py`；`python -m pytest -q tests/unit/test_selftest_helpers.py tests/unit/test_data_loader.py tests/unit/test_runtime_loader.py tests/unit/test_dashboard_runtime_api.py`
  - Conclusion: 相关代码面已通过 `50` 个 targeted unit tests、`9` 个 integration tests 与 `28` 个 selftest/read-model 单测，说明新包级主链在当前 checkout 上自洽

- `EV-009` related to `WS-003`, `WS-005`: 新架构下的 repo-real `hard` gate 仍保持通过
  - Evidence: `python -m thoth.selftest --tier hard --hosts none --artifact-dir /tmp/thoth-hard-simplify-artifacts --json-report /tmp/thoth-hard-simplify-summary.json`
  - Conclusion: 当前 checkout 在不依赖真实宿主交互的前提下，`hard` 自测结果为 `25 passed / 0 failed / 0 degraded`

- `EV-013` related to `WS-005`, `TD-024`: 九阶段架构简化与 `Codex-only` closing gate 已在 `dev` 上完成
  - Evidence: WSL 验证环境已修复为 Node `v20.20.2` 与 Codex CLI `0.125.0`；`python -m py_compile` 覆盖 `thoth` 与 `scripts` 全量 Python 文件通过；`python -m pytest -q --thoth-tier light` 为 `107 passed, 45 deselected`；`python -m pytest -q --thoth-tier medium` 为 `128 passed, 24 deselected`；`python -m pytest -q tests/integration/test_init_workflow.py tests/integration/test_runtime_lifecycle_e2e.py` 为 `9 passed`；`python -m thoth.selftest --tier hard --hosts none` 为 `25 passed / 0 failed / 0 degraded`；真实 `codex exec -m gpt-5.4 --json --full-auto` 在 `/tmp/thoth-codex-fast-gate-work.vAX0K9` 执行 `thoth status`、`thoth run --task-id task-gate`、protocol `heartbeat` / `complete`、`thoth loop --task-id task-gate`、protocol `heartbeat` / `complete`，并验证 `run-0f6c9c1c7583/result.json`、`loop-c1e5eaa1e5cc/result.json` 与 `task-gate.result.json`
  - Conclusion: 本轮不依赖双宿主 heavy，也不测试模型业务开发能力；Codex-only fast gate 已覆盖 public surface、packet 解析、protocol terminalization、RunResult 与 TaskResult 投影

- `EV-014` related to `WS-005`, `REQ-014`, `REQ-024`, `REQ-027`: dashboard 已完成 workbench transplant，且保持 Observe-only authority 边界
  - Evidence: `thoth/observe/read_model.py`、`templates/dashboard/backend/app.py`、`thoth/init/{generators,service}.py`、`templates/dashboard/frontend/src/{views/WorkbenchView.vue,stores/dashboard.ts,locales/*,generated/locale.ts,components/layout/*,components/detail/*,components/panels/*,components/tree/*,components/filters/*,components/charts/GanttChart.vue}`；`python -m pytest -q tests/unit/test_init.py tests/unit/test_dashboard_runtime_api.py tests/unit/test_data_loader.py tests/integration/test_init_workflow.py` 为 `31 passed`；`python -m pytest -q tests/unit/test_runtime_loader.py tests/unit/test_status.py tests/integration/test_runtime_lifecycle_e2e.py -k dashboard_process_and_hooks_are_observable` 为 `1 passed`；`cd templates/dashboard/frontend && npm run build` 通过
  - Conclusion: 当前 dashboard 已切到单一 workbench shell、保留旧路径兼容入口、补齐 `/api/overview-summary` 与 `/api/gantt`、以 Thoth-native detail 替换旧 NeuralShader 语义槽位，并按 init/sync 语言配置生成默认中英文文案

- `EV-015` related to `TD-025`, `REQ-023`, `REQ-024`: `run` / `loop` 已改为 Python 机械 phase engine，`loop` 通过父 run 复用 child `run`
  - Evidence: `thoth/run/phases.py`、`thoth/run/{packets,worker,ledger}.py`、`thoth/plan/{compiler,validators}.py`、`tests/unit/test_run_state_machine.py`；`python -m pytest -q tests/unit/test_task_contracts.py tests/unit/test_run_state_machine.py tests/unit/test_runtime_protocol.py tests/unit/test_cli_surface.py tests/unit/test_claude_bridge.py tests/integration/test_runtime_lifecycle_e2e.py tests/unit/test_dashboard_runtime_api.py` 为 `37 passed`
  - Conclusion: 当前 strict task 会编译出默认 `runtime_contract.loop = {max_iterations: 10, max_runtime_seconds: 28800}`，缺失 `validate_output_schema` 的 frozen task 会转为不可执行；单次 `run` 由 Python 机械解析 phase JSON 决定成功或失败，`loop` 会记录 child run lineage、反射提示与预算耗尽原因

- `EV-016` related to `WS-005`, `REQ-022`, `REQ-024`: prompt authority、TaskResult canonical 词汇与 selftest host matrix 已继续收口
  - Evidence: `thoth/prompt_specs.py`、`thoth/prompt_validators.py`、`thoth/prompt_contracts.py`、`thoth/run/review_context.py`、`thoth/plan/{store,compiler,legacy_import}.py`、`thoth/observe/read_model.py`、`thoth/observe/selftest/{model,recorder,runner,host_common,host_claude,host_codex}.py`、`scripts/measure_tracked_source.py`；`env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_command_spec_generation.py tests/unit/test_cli_surface.py tests/unit/test_runtime_protocol.py tests/unit/test_run_state_machine.py tests/unit/test_task_contracts.py tests/unit/test_status.py tests/unit/test_selftest_helpers.py` 为 `68 passed`；`env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/integration/test_init_workflow.py tests/integration/test_runtime_lifecycle_e2e.py` 为 `9 passed`
  - Conclusion: 当前 `prompt spec` 与 `runtime validation` 已明确分层；`TaskResult` 成为唯一 canonical task current-state 词汇；`run` 的 fresh-review 读取共享同一 helper；host-real selftest adapter 只保留宿主差异而不再依赖重复类型定义；tracked-source 行数账本已可重复生成

- `EV-017` related to `WS-001`, `WS-003`, `REQ-004`, `REQ-011`: 本轮发布收尾已按分支治理约束完成，并同步刷新了本机 Claude/Codex 安装面
  - Evidence: `dev` 提交 `8a27e5f refactor: compress prompt and task runtime surfaces`、`f4efa18 docs: record prompt and task runtime simplification`、`5ab08b8 chore: ignore local pytest workspace`；`main` 对应发布提交 `ef3b7c7 refactor: compress prompt and task runtime surfaces` 与 `3374705 chore: ignore local pytest workspace`；`git push origin main` 已成功；`rsync -a --delete` 已将当前仓库同步到 `/root/.claude/plugins/cache/thoth/thoth/0.1.4`、`/root/.claude/plugins/marketplaces/thoth`、`/root/.codex/plugins/cache/thoth/thoth/0.1.4`、`/root/.codex/.tmp/marketplaces/thoth`；`sha256sum` 证明 repo 与四处本机副本中的 `.gitignore`、`thoth/prompt_specs.py`、`thoth/prompt_validators.py`、`thoth/run/review_context.py` 完全一致
  - Conclusion: 当前发布面已通过 `dev -> main` 受控 `cherry-pick` 带到 `main`，`.agent-os/` 未被夹带进发布分支；`.tmp_pytest/` 已加入忽略规则；本机 Claude/Codex 的 Thoth 副本已与当前仓库对齐。发布依据仍是 `dev` 上已通过的 `68` 条单测与 `9` 条集成测试；`main` 上同组复核曾被用户中途打断，之后仅追加了非行为性的 `.gitignore` 变更

- `EV-018` related to `WS-003`, `REQ-006`, `REQ-019`: 插件安装态入口与源码仓 fallback 入口已经明确分层，空目录下的 `init` / `dashboard start` 可通过统一 wrapper 成功执行
  - Evidence: 新增 `bin/thoth` wrapper，并将生成到外部受管仓库的 helper/pre-commit 入口统一改为 `scripts/thoth-cli.sh`：优先调用 PATH 上的 `thoth`，仅在 `THOTH_SOURCE_ROOT` 存在时回退到 `python -m thoth.cli`。同步更新 `thoth/{init/generators.py,init/{audit,preview,migration}.py,observe/selftest/capabilities.py,projections.py,prompt_specs.py}`、`README.md`、`README.zh-CN.md`、`plugins/thoth/skills/thoth/SKILL.md` 与对应测试。快验收为 `env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_plugin_surface.py::test_plugin_shell_wrapper_exists_for_fresh_install_envs tests/unit/test_command_spec_generation.py::test_codex_skill_lists_single_public_entry tests/unit/test_init.py::test_generate_pre_commit_config tests/unit/test_init.py::test_generate_scripts tests/unit/test_selftest_helpers.py::test_preflight_host_real_reports_missing_thoth_wrapper_as_install_drift`，结果 `5 passed in 0.34s`。空目录 `/tmp/thoth-empty-wrapper-check` 下执行 `PATH=/mnt/cfs/5vr0p6/yzy/thoth/bin:$PATH thoth init`、`bash scripts/session-end-check.sh`、`thoth dashboard start`、`thoth dashboard stop` 全部成功
  - Conclusion: 当前入口语义已收紧为两层且贯穿文档、插件投影、生成脚本与自测预检：插件安装环境中的公开 shell/runtime 入口是 `thoth <command>` 与宿主 public surface，源码仓开发时才用 `python -m thoth.cli <command>` 绑定到 checked-out 代码；先前“插件安装后 shell 没有 `thoth`，但文案、生成脚本和自测又假定它存在”的漂移已被修正为显式 wrapper + install-drift 报告

## Open Checks

- `EV-010` related to `WS-002`: 完整 `.thoth` durable runtime 仍未闭环
  - Conclusion: 当前是基线版 authority/runtime，不应对外声称 V2 全部完成

- `EV-011` related to `WS-001`: `main` 对开发态文档的拒收机制仍待进一步机制化
  - Conclusion: 当前主要依赖分支纪律和 `cherry-pick` 流程
