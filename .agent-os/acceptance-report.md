# Acceptance Report

## Current Validation Contract

- `2026-04-28` 起，公开验证合同以 atomic selftest case list 与 targeted pytest targets 为准。
- 历史上的 `hard` / `heavy` 与 `light` / `medium` / `heavy` 记录仅保留为既往证据，不再构成当前默认开发入口。

## Passed Checks

- `EV-001` related to `WS-003`: 当前公开命令面已稳定为显式 `/thoth:*` 与单一 `$thoth <command>`
  - Evidence: `commands/*.md`、`.agents/plugins/marketplace.json`、`plugins/thoth/.codex-plugin/plugin.json`、`plugins/thoth/skills/thoth/`
  - Conclusion: 当前公开 surface 与仓库定位一致

- `EV-002` related to `TD-012`: 原子化 selftest registry 已落地
  - Evidence: `thoth/observe/selftest/{registry,atomic_cases,runner,recorder,processes}.py`、`tests/unit/test_selftest_registry.py`、`python -m thoth.selftest`
  - Conclusion: 仓库当前公开自测试入口已经收敛为 atomic case matrix；无 `--case` 时会失败并打印 catalog，单个 case 的结果按 `case_id` 独立记账

- `EV-003` related to `TD-014`: strict `Decision -> Contract -> Task` 执行 authority 已落地
  - Evidence: `thoth/plan/compiler.py`、`thoth/plan/store.py`、`.thoth/project/tasks` 相关读写逻辑、dashboard compiler 读面
  - Conclusion: `run` / `loop` 默认只接受 `--task-id`；缺少 `--task-id` 时只允许召回现有 task 候选并停下，不允许创建新 task 或触碰代码

- `EV-004` related to `WS-003`: 公开安装面已切换到 `SeeleAI/Thoth`
  - Evidence: `README.md`、`.claude-plugin/`、`.agents/plugins/marketplace.json`、`plugins/thoth/`、`thoth/projections.py`
  - Conclusion: 仓库对外元数据已统一到公开 canonical upstream

- `EV-005` related to `REQ-007`: dev 状态文档已清理私人路径、个人邮箱和外部项目来源链
  - Evidence: `.agent-os/` 已精简为公开版最小集
  - Conclusion: 当前 dev 分支不再暴露无运行必要的私有上下文

- `EV-006` related to `REQ-021`, `REQ-029`: pytest targeted-only hard guard 与 target manifest 已落地
  - Evidence: `tests/conftest.py`、`thoth/test_targets.py`、`scripts/recommend_tests.py`、`tests/unit/test_pytest_tiers.py`、`python -m pytest -q`、`python -m pytest -q --thoth-target selftest-core`、`python scripts/recommend_tests.py thoth/observe/selftest/runner.py tests/conftest.py --json`
  - Conclusion: 仓库默认只允许显式 file/nodeid 或 `--thoth-target`；裸 `pytest` 与 broad tier sweep 默认被拦截；changed-path 推荐脚本可以稳定生成精确 pytest/selftest 命令

- `EV-007` related to `REQ-023`, `REQ-024`, `REQ-026`, `REQ-027`: 新四层骨架、双层结果模型与 canonical run ledger 已落到代码主链
  - Evidence: `thoth/surface/*_commands.py`、`thoth/plan/{compiler,store,results,doctor,validators,paths}.py`、`thoth/run/{model,io,lease,ledger,packets,worker,service,status}.py`、`thoth/init/{audit,preview,migration,generators,service}.py`、`thoth/observe/{read_model,status,report,dashboard}.py`、`templates/dashboard/backend/runtime_loader.py`、`templates/dashboard/backend/data_loader.py`
  - Conclusion: 当前代码已经共享 `Surface / Plan / Run / Observe` 的分层约束、`RunResult + work_result` 的结果模型、`run/state/events/result/artifacts` 的 run ledger 形态，以及 `review` live-only / `loop` 新鲜 review consumption 规则

- `EV-008` related to `WS-005`: 本轮重构关键切片已通过针对性代码验证
  - Evidence: `python -m py_compile thoth/surface/cli.py thoth/surface/handlers.py thoth/surface/hooks.py thoth/surface/bridges/claude.py thoth/plan/compiler.py thoth/plan/store.py thoth/plan/results.py thoth/plan/doctor.py thoth/run/lifecycle.py thoth/run/status.py thoth/init/service.py thoth/init/render.py thoth/observe/status.py thoth/observe/report.py thoth/observe/dashboard.py thoth/observe/selftest/runner.py scripts/init.py scripts/sync.py scripts/status.py scripts/report.py scripts/doctor.py scripts/session-hook.py`；`python -m pytest -q tests/unit/test_runtime_protocol.py tests/unit/test_runtime_supervisor.py tests/unit/test_task_contracts.py tests/unit/test_init.py tests/unit/test_cli_surface.py tests/unit/test_host_hooks.py tests/unit/test_status.py tests/unit/test_report.py`；`python -m pytest -q tests/integration/test_init_workflow.py tests/integration/test_runtime_lifecycle_e2e.py`；`python -m pytest -q tests/unit/test_selftest_helpers.py tests/unit/test_data_loader.py tests/unit/test_runtime_loader.py tests/unit/test_dashboard_runtime_api.py`
  - Conclusion: 相关代码面已通过 `50` 个 targeted unit tests、`9` 个 integration tests 与 `28` 个 selftest/read-model 单测，说明新包级主链在当前 checkout 上自洽

- `EV-009` related to `WS-003`, `WS-005`: 新架构下的 repo-real `hard` gate 仍保持通过
  - Evidence: `python -m thoth.selftest --tier hard --hosts none --artifact-dir /tmp/thoth-hard-simplify-artifacts --json-report /tmp/thoth-hard-simplify-summary.json`
  - Conclusion: 当前 checkout 在不依赖真实宿主交互的前提下，`hard` 自测结果为 `25 passed / 0 failed / 0 degraded`

- `EV-013` related to `WS-005`, `TD-024`: 九阶段架构简化与 `Codex-only` closing gate 已在 `dev` 上完成
  - Evidence: WSL 验证环境已修复为 Node `v20.20.2` 与 Codex CLI `0.125.0`；`python -m py_compile` 覆盖 `thoth` 与 `scripts` 全量 Python 文件通过；`python -m pytest -q --thoth-tier light` 为 `107 passed, 45 deselected`；`python -m pytest -q --thoth-tier medium` 为 `128 passed, 24 deselected`；`python -m pytest -q tests/integration/test_init_workflow.py tests/integration/test_runtime_lifecycle_e2e.py` 为 `9 passed`；`python -m thoth.selftest --tier hard --hosts none` 为 `25 passed / 0 failed / 0 degraded`；真实 `codex exec -m gpt-5.4 --json --full-auto` 在 `/tmp/thoth-codex-fast-gate-work.vAX0K9` 执行 `thoth status`、`thoth run --task-id task-gate`、protocol `heartbeat` / `complete`、`thoth loop --task-id task-gate`、protocol `heartbeat` / `complete`，并验证 `run-0f6c9c1c7583/result.json`、`loop-c1e5eaa1e5cc/result.json` 与 `task-gate.result.json`
  - Conclusion: 该证据保留为中间阶段收口记录，证明简化后的 runtime surface 曾通过 `Codex-only` fast gate；它已不再是当前关闭门 authority，当前最终关闭门见 `EV-019`

- `EV-014` related to `WS-005`, `REQ-014`, `REQ-024`, `REQ-027`: dashboard 已完成 workbench transplant，且保持 Observe-only authority 边界
  - Evidence: `thoth/observe/read_model.py`、`templates/dashboard/backend/app.py`、`thoth/init/{generators,service}.py`、`templates/dashboard/frontend/src/{views/WorkbenchView.vue,stores/dashboard.ts,locales/*,generated/locale.ts,components/layout/*,components/detail/*,components/panels/*,components/tree/*,components/filters/*,components/charts/GanttChart.vue}`；`python -m pytest -q tests/unit/test_init.py tests/unit/test_dashboard_runtime_api.py tests/unit/test_data_loader.py tests/integration/test_init_workflow.py` 为 `31 passed`；`python -m pytest -q tests/unit/test_runtime_loader.py tests/unit/test_status.py tests/integration/test_runtime_lifecycle_e2e.py -k dashboard_process_and_hooks_are_observable` 为 `1 passed`；`cd templates/dashboard/frontend && npm run build` 通过
  - Conclusion: 当前 dashboard 已切到单一 workbench shell、保留旧路径兼容入口、补齐 `/api/overview-summary` 与 `/api/gantt`、以 Thoth-native detail 替换旧 NeuralShader 语义槽位，并按 init/sync 语言配置生成默认中英文文案

- `EV-015` related to `TD-025`, `REQ-023`, `REQ-024`: `run` / `loop` 已改为 Python 机械 phase engine，`loop` 通过父 run 复用 child `run`
  - Evidence: `thoth/run/phases.py`、`thoth/run/{packets,worker,ledger}.py`、`thoth/plan/{compiler,validators}.py`、`tests/unit/test_run_state_machine.py`；`python -m pytest -q tests/unit/test_task_contracts.py tests/unit/test_run_state_machine.py tests/unit/test_runtime_protocol.py tests/unit/test_cli_surface.py tests/unit/test_claude_bridge.py tests/integration/test_runtime_lifecycle_e2e.py tests/unit/test_dashboard_runtime_api.py` 为 `37 passed`
  - Conclusion: 当前 strict task 会编译出默认 `runtime_contract.loop = {max_iterations: 10, max_runtime_seconds: 28800}`，缺失 `validate_output_schema` 的 frozen task 会转为不可执行；单次 `run` 由 Python 机械解析 phase JSON 决定成功或失败，`loop` 会记录 child run lineage、反射提示与预算耗尽原因

- `EV-016` related to `WS-005`, `REQ-022`, `REQ-024`: prompt authority、work_result canonical 词汇与 selftest host matrix 已继续收口
  - Evidence: `thoth/prompt_specs.py`、`thoth/prompt_validators.py`、`thoth/prompt_contracts.py`、`thoth/run/review_context.py`、`thoth/plan/{store,compiler,legacy_import}.py`、`thoth/observe/read_model.py`、`thoth/observe/selftest/{model,recorder,runner,host_common,host_claude,host_codex}.py`、`scripts/measure_tracked_source.py`；`env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_command_spec_generation.py tests/unit/test_cli_surface.py tests/unit/test_runtime_protocol.py tests/unit/test_run_state_machine.py tests/unit/test_task_contracts.py tests/unit/test_status.py tests/unit/test_selftest_helpers.py` 为 `68 passed`；`env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/integration/test_init_workflow.py tests/integration/test_runtime_lifecycle_e2e.py` 为 `9 passed`
  - Conclusion: 当前 `prompt spec` 与 `runtime validation` 已明确分层；`work_result` 成为唯一 canonical task current-state 词汇；`run` 的 fresh-review 读取共享同一 helper；host-real selftest adapter 只保留宿主差异而不再依赖重复类型定义；tracked-source 行数账本已可重复生成

- `EV-017` related to `WS-001`, `WS-003`, `REQ-004`, `REQ-011`: 本轮发布收尾已按分支治理约束完成，并同步刷新了本机 Claude/Codex 安装面
  - Evidence: `dev` 提交 `8a27e5f refactor: compress prompt and task runtime surfaces`、`f4efa18 docs: record prompt and task runtime simplification`、`5ab08b8 chore: ignore local pytest workspace`；`main` 对应发布提交 `ef3b7c7 refactor: compress prompt and task runtime surfaces` 与 `3374705 chore: ignore local pytest workspace`；`git push origin main` 已成功；`rsync -a --delete` 已将当前仓库同步到 `/root/.claude/plugins/cache/thoth/thoth/0.1.4`、`/root/.claude/plugins/marketplaces/thoth`、`/root/.codex/plugins/cache/thoth/thoth/0.1.4`、`/root/.codex/.tmp/marketplaces/thoth`；`sha256sum` 证明 repo 与四处本机副本中的 `.gitignore`、`thoth/prompt_specs.py`、`thoth/prompt_validators.py`、`thoth/run/review_context.py` 完全一致
  - Conclusion: 当前发布面已通过 `dev -> main` 受控 `cherry-pick` 带到 `main`，`.agent-os/` 未被夹带进发布分支；`.tmp_pytest/` 已加入忽略规则；本机 Claude/Codex 的 Thoth 副本已与当前仓库对齐。发布依据仍是 `dev` 上已通过的 `68` 条单测与 `9` 条集成测试；`main` 上同组复核曾被用户中途打断，之后仅追加了非行为性的 `.gitignore` 变更

- `EV-018` related to `WS-003`, `REQ-006`, `REQ-019`: 插件安装态入口与源码仓 fallback 入口已经明确分层，空目录下的 `init` / `dashboard start` 可通过统一 wrapper 成功执行
  - Evidence: 新增 `bin/thoth` wrapper，并将生成到外部受管仓库的 helper/pre-commit 入口统一改为 `scripts/thoth-cli.sh`：优先调用 PATH 上的 `thoth`，仅在 `THOTH_SOURCE_ROOT` 存在时回退到 `python -m thoth.cli`。同步更新 `thoth/{init/generators.py,init/{audit,preview,migration}.py,observe/selftest/capabilities.py,projections.py,prompt_specs.py}`、`README.md`、`README.zh-CN.md`、`plugins/thoth/skills/thoth/SKILL.md` 与对应测试。快验收为 `env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_plugin_surface.py::test_plugin_shell_wrapper_exists_for_fresh_install_envs tests/unit/test_command_spec_generation.py::test_codex_skill_lists_single_public_entry tests/unit/test_init.py::test_generate_pre_commit_config tests/unit/test_init.py::test_generate_scripts tests/unit/test_selftest_helpers.py::test_preflight_host_real_reports_missing_thoth_wrapper_as_install_drift`，结果 `5 passed in 0.34s`。空目录 `/tmp/thoth-empty-wrapper-check` 下执行 `PATH=/mnt/cfs/5vr0p6/yzy/thoth/bin:$PATH thoth init`、`bash scripts/session-end-check.sh`、`thoth dashboard start`、`thoth dashboard stop` 全部成功
  - Conclusion: 当前入口语义已收紧为两层且贯穿文档、插件投影、生成脚本与自测预检：插件安装环境中的公开 shell/runtime 入口是 `thoth <command>` 与宿主 public surface，源码仓开发时才用 `python -m thoth.cli <command>` 绑定到 checked-out 代码；先前“插件安装后 shell 没有 `thoth`，但文案、生成脚本和自测又假定它存在”的漂移已被修正为显式 wrapper + install-drift 报告

- `EV-019` related to `TD-023`, `WS-003`, `WS-005`: 历史 `heavy` gate 曾收口为双宿主 public-command conformance gate，且 `hard` 曾独立通过
  - Evidence: `thoth/observe/selftest/{fixtures,host_common,host_codex,host_claude,model,runner}.py`、`thoth/selftest_seed.py`、`thoth/{projections,prompt_specs}.py`、`thoth/surface/run_commands.py`；`python -m thoth.cli sync` 未引入新的 tracked projection 漂移；`python -m py_compile thoth/observe/selftest/{fixtures,hard_suite,host_claude,host_codex,host_common,model,runner}.py thoth/{projections,prompt_specs,selftest_seed}.py thoth/surface/run_commands.py tests/unit/test_{selftest_helpers,command_spec_generation,claude_bridge}.py tests/integration/test_runtime_lifecycle_e2e.py` 通过；`env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_selftest_helpers.py tests/unit/test_command_spec_generation.py tests/unit/test_claude_bridge.py tests/unit/test_cli_surface.py tests/integration/test_runtime_lifecycle_e2e.py` 为 `54 passed in 705.84s`；`python -m thoth.selftest --tier hard --hosts none --artifact-dir /tmp/thoth-hard-command-gate-artifacts-20260428 --json-report /tmp/thoth-hard-command-gate-summary-20260428.json` 为 `25 passed / 0 failed / 0 degraded`
  - Conclusion: 这条记录保留为 `CD-032` 之前的历史验证证据：当时 selftest 曾按 `heavy` 语义完成 deterministic regression 收口，并为后续原子化重构提供基线；当前默认开发入口已经切换到 atomic case list 与 targeted pytest targets，见本文件顶部说明与 `EV-021`、`EV-022`

- `EV-020` related to `WS-003`, `WS-005`: 真实 `heavy --hosts both` 关闭门曾通过
  - Evidence: `env PATH=/mnt/cfs/5vr0p6/yzy/thoth/bin:$PATH ANTHROPIC_BASE_URL='https://api.deepseek.com/anthropic' ANTHROPIC_AUTH_TOKEN='***' ANTHROPIC_MODEL='deepseek-v4-pro[1m]' ANTHROPIC_DEFAULT_OPUS_MODEL='deepseek-v4-pro[1m]' ANTHROPIC_DEFAULT_SONNET_MODEL='deepseek-v4-pro[1m]' ANTHROPIC_DEFAULT_HAIKU_MODEL='deepseek-v4-flash' CLAUDE_CODE_SUBAGENT_MODEL='deepseek-v4-flash' CLAUDE_CODE_EFFORT_LEVEL='max' TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m thoth.selftest --tier heavy --hosts both --artifact-dir /tmp/thoth-heavy-both-command-gate-artifacts-20260428-rerun --json-report /tmp/thoth-heavy-both-command-gate-summary-20260428-rerun.json`；summary 为 `overall_status=passed`、`104 passed / 0 failed / 0 degraded`
  - Conclusion: 这条记录保留为 `CD-032` 之前的历史 host-real gate 证据：当时在用户提供的 Claude 登录态环境下，双宿主 public-command conformance gate 已完整闭合。当前合同已不再把 `heavy` 作为默认开发入口，但该证据仍可用于追溯原始 host-real 基线

- `EV-021` related to `REQ-017`, `REQ-025`: repo-local atomic selftest matrix 已可独立通过
  - Evidence: `env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m thoth.selftest --case plan.discuss.compile --case runtime.run.live --case runtime.run.sleep --case runtime.run.validate_fail --case runtime.loop.live --case runtime.loop.sleep --case runtime.loop.lease_conflict --case review.exact_match --case observe.dashboard --case hooks.codex --artifact-dir /tmp/thoth-atomic-repo-cases-20260428 --json-report /tmp/thoth-atomic-repo-cases-20260428.json`
  - Conclusion: 当前 repo-local capability matrix 已能在单次 `180s` invocation budget 内独立通过；`plan`、`runtime run/loop`、`review`、`dashboard`、`hooks` 都按原子 case 分项产出独立 artifacts 与 checks

- `EV-022` related to `REQ-021`, `REQ-025`, `AC-016`: 新开发态验证硬约束已被真实命令验证
  - Evidence: `python -m thoth.selftest` 返回 `2` 并打印 available cases；`python -m pytest -q` 默认失败并提示改用显式 file/nodeid 或 `--thoth-target`；`env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q --thoth-target selftest-core` 为 `39 passed, 160 deselected in 2.73s`；`env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_selftest_helpers.py tests/unit/test_selftest_registry.py tests/unit/test_runtime_protocol.py tests/integration/test_runtime_lifecycle_e2e.py` 为 `51 passed in 100.58s`
  - Conclusion: 当前公开验证面已真实切换到“atomic selftest + targeted pytest”模式，默认 broad/full runs 已被硬拦截，而显式 target 与 focused file/nodeid 命令可以稳定通过

- `EV-023` related to `WS-003`, `REQ-017`: Codex host-surface 原子 sample 已在新合同下真实通过
  - Evidence: `env PATH=/mnt/cfs/5vr0p6/yzy/thoth/bin:$PATH TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m thoth.selftest --case surface.codex.run.live_prepare --case surface.codex.loop.sleep_prepare --artifact-dir /tmp/thoth-atomic-codex-sample-20260428e --json-report /tmp/thoth-atomic-codex-sample-20260428e.json`
  - Conclusion: 在当前 atomic host-case window、repo-local authority materialization 与 ready-task seeding 语义下，Codex 侧的 `run live_prepare` 与 `loop sleep_prepare` 已能独立通过，并分别验证 `live_native` 与 `external_worker` 的 surface/runtime contract

- `EV-024` related to `REQ-030`, `REQ-031`, `REQ-032`, `REQ-033`, `REQ-034`, `AC-022`, `AC-023`, `AC-024`, `AC-025`: 统一对象图与 Agent Runtime Kernel 已落地到当前 `dev` checkout 的核心路径
  - Evidence: 新增 `thoth/objects.py` 与 `thoth/run/controllers.py`；更新 `thoth/plan/{store,compiler,paths,doctor,results}.py`、`thoth/run/{ledger,packets,phases,review_context}.py`、`thoth/surface/{cli,run_commands,plan_commands,project_commands,handlers}.py`、`thoth/init/{generators,preview,migration,service}.py`、`thoth/observe/{read_model,status}.py`、`thoth/observe/selftest/{registry,atomic_cases,fixtures}.py`、`thoth/{command_specs,prompt_specs,projections}.py` 与生成的 `commands/*` / `plugins/thoth/skills/thoth/*`
  - Evidence: `python -m py_compile thoth/objects.py thoth/run/controllers.py thoth/plan/store.py thoth/plan/compiler.py thoth/plan/doctor.py thoth/plan/results.py thoth/run/ledger.py thoth/run/packets.py thoth/run/phases.py thoth/surface/cli.py thoth/surface/run_commands.py thoth/surface/plan_commands.py thoth/surface/project_commands.py thoth/surface/handlers.py thoth/init/generators.py thoth/init/preview.py thoth/init/migration.py thoth/observe/selftest/atomic_cases.py thoth/observe/selftest/fixtures.py thoth/observe/selftest/registry.py` 通过
  - Evidence: `env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_task_contracts.py tests/unit/test_object_controllers.py tests/unit/test_command_spec_generation.py tests/unit/test_plugin_surface.py tests/unit/test_selftest_registry.py` 为 `33 passed in 2.64s`
  - Evidence: 继续收口旧 `.thoth/project` / `task_id` 读面后，`env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_cli_surface.py tests/unit/test_claude_bridge.py tests/unit/test_runtime_protocol.py tests/unit/test_run_state_machine.py tests/integration/test_runtime_lifecycle_e2e.py` 为 `34 passed in 668.46s`
  - Evidence: `env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_task_contracts.py tests/unit/test_object_controllers.py tests/unit/test_command_spec_generation.py tests/unit/test_plugin_surface.py tests/unit/test_selftest_registry.py tests/unit/test_init.py tests/integration/test_init_workflow.py tests/unit/test_dashboard_runtime_api.py` 为 `59 passed in 362.53s`
  - Evidence: `env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m thoth.selftest --case discuss.subtree.close --artifact-dir /mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest/thoth-selftest-discuss-object --json-report /mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest/thoth-selftest-discuss-object.json` 为 `overall_status=passed`
  - Evidence: `env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m thoth.selftest --case run.phase_contract --artifact-dir /mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest/thoth-selftest-run-phase --json-report /mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest/thoth-selftest-run-phase.json` 为 `overall_status=passed`
  - Evidence: `env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m thoth.selftest --case discuss.subtree.close --case run.phase_contract --case run.locked_work --case loop.controller --case orchestration.controller --case auto.queue --case observe.object_graph --artifact-dir /mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest/thoth-selftest-object-kernel --json-report /mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest/thoth-selftest-object-kernel.json` 为 `overall_status=passed`
  - Evidence: 新增后续补丁覆盖 `templates/dashboard/backend/{data_loader.py,runtime_loader.py}`、`thoth/surface/hooks.py`、`thoth/surface/observe_commands.py`、`thoth/observe/selftest/{hard_suite.py,registry.py}` 与 init/dashboard/lifecycle 测试，确保 dashboard active-run、overview summary、hook event 与 selftest dashboard port 都消费对象图而不是旧 `.thoth/project` authority
  - Evidence: 收尾复扫 `rg -n -- "--task-id|contract-json|\\.thoth/project|Decision -> Contract -> Task|Strict Task" AGENTS.md CLAUDE.md README.md README.zh-CN.md commands plugins thoth tests .agent-os` 后，剩余命中均为历史记账或明确否定旧 authority 的说明；`commands/`、`plugins/` 与代码主链未保留旧 public execution surface。补充验证 `python -m py_compile thoth/objects.py thoth/run/controllers.py thoth/surface/run_commands.py thoth/surface/hooks.py thoth/observe/selftest/registry.py thoth/observe/selftest/hard_suite.py templates/dashboard/backend/data_loader.py templates/dashboard/backend/runtime_loader.py` 通过；`env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_dashboard_runtime_api.py tests/integration/test_runtime_lifecycle_e2e.py` 为 `6 passed in 89.40s`
  - Evidence: Runtime Kernel closeout 清理后，旧主路径命名 `upsert_contract`、`load_task_for_execution`、`suggest_tasks_for_query`、`task_result_path`、`tasks_dir`、`load_task_result`、`upsert_task_result`、`load_compiled_tasks`、`ensure_task_authority_tree`、`initialize_run_controller` 已不再出现在代码主链；`thoth/plan/legacy_import.py` 与 `thoth/plan/validators.py` 已删除；`discuss --work-json` 会拒绝 legacy contract-shaped payload
  - Evidence: 普通 `run` 不再创建 controller object，只写 `run`、`phase_result`、`artifact` object 与 `.thoth/runs/<run_id>/phase_state.json`；`loop` 仍作为 controller service 写 controller object 与 child run lineage
  - Evidence: `python -m py_compile thoth/objects.py thoth/plan/paths.py thoth/plan/store.py thoth/plan/compiler.py thoth/plan/doctor.py thoth/plan/results.py thoth/run/ledger.py thoth/run/packets.py thoth/run/phases.py thoth/run/controllers.py thoth/run/review_context.py thoth/surface/run_commands.py thoth/surface/plan_commands.py thoth/init/service.py thoth/init/generators.py thoth/observe/read_model.py thoth/observe/status.py thoth/observe/report.py thoth/observe/selftest/fixtures.py thoth/observe/selftest/hard_suite.py thoth/observe/selftest/atomic_cases.py thoth/observe/selftest/host_common.py tests/unit/test_task_contracts.py tests/unit/test_object_controllers.py tests/unit/test_runtime_protocol.py tests/unit/test_run_state_machine.py tests/unit/test_cli_surface.py tests/unit/test_claude_bridge.py tests/unit/test_dashboard_runtime_api.py tests/integration/test_runtime_lifecycle_e2e.py` 通过
  - Evidence: `timeout 1200s env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_task_contracts.py tests/unit/test_runtime_protocol.py tests/unit/test_run_state_machine.py tests/unit/test_cli_surface.py tests/unit/test_claude_bridge.py tests/unit/test_dashboard_runtime_api.py tests/integration/test_runtime_lifecycle_e2e.py` 打印 `44 passed in 680.45s`；当前环境中该 pytest 进程摘要打印后未自行退出，已按明确 PID 清理，作为测试收尾异常保留记账
  - Evidence: 核心五项关闭门 `timeout 300s env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m thoth.selftest --case discuss.subtree.close --case run.phase_contract --case run.locked_work --case loop.controller --case observe.object_graph --artifact-dir /mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest/thoth-selftest-core-closeout --json-report /mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest/thoth-selftest-core-closeout.json` 为 `overall_status=passed`，报告生成时间 `2026-04-29T13:29:04Z`
  - Evidence: 发布面提交 `eebe032 refactor: close runtime object kernel` 已在 `main` 通过受控 cherry-pick 落为 `b15e2b3 refactor: close runtime object kernel`；冲突只涉及 `thoth/init/AGENTS.md` / `thoth/init/CLAUDE.md` 在 `main` 已删除而发布面提交有修改，按 `main` 不夹带 `AGENTS` / `CLAUDE` 控制面文档的边界保留删除状态
  - Evidence: `main` 上发布验证通过：`timeout 300s python -m py_compile ...` 通过；`timeout 1200s env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_task_contracts.py tests/unit/test_runtime_protocol.py tests/unit/test_run_state_machine.py tests/unit/test_cli_surface.py tests/unit/test_claude_bridge.py tests/unit/test_dashboard_runtime_api.py tests/integration/test_runtime_lifecycle_e2e.py` 为 `44 passed in 716.46s`；核心五项 selftest 报告 `.tmp_pytest/thoth-selftest-main-core-closeout.json` 为 `overall_status=passed`，报告生成时间 `2026-04-29T13:46:19Z`
  - Conclusion: 当前核心 authority 已从 `.thoth/project/decisions|contracts|tasks` 切到 `.thoth/objects`；`discuss` 可生成 `discussion/decision/work_item`，`run` 绑定 `work_id@revision` 并产生 `run/phase_result/artifact` 对象，普通 run 不再混入 controller service；`loop`、`orchestration` 与 `auto` 才以 controller object 表达多轮、DAG batch 与 queue cursor；dashboard / hooks / selftest 已切到 object graph read/write surface，active work mutation 会返回 `blocked_by_active_execution`

- `EV-025` related to `WS-001`, `REQ-005`, `REQ-011`, `REQ-020`: Runtime Kernel 发布面已按 `dev -> main` cherry-pick 与双分支 push 收尾
  - Evidence: `dev` 已推送 `0b5d722..bc36eba` 到 `origin/dev`，其中发布面提交为 `eebe032 refactor: close runtime object kernel`，dev-only 治理提交为 `bc36eba docs: record runtime kernel closeout`
  - Evidence: `main` 已推送 `57f5aa0..b15e2b3` 到 `origin/main`，其中 `b15e2b3 refactor: close runtime object kernel` 是 `eebe032` 的发布面 cherry-pick；root `AGENTS.md` / `CLAUDE.md` / `.agent-os/` 未进入 `main`
  - Conclusion: 代码与发布面生成物已集成到 `main` 并推送；开发态治理文档只保留在 `dev`

- `EV-027` related to `TD-032`, `WS-002`, `WS-003`, `WS-005`, `REQ-023`, `REQ-024`, `REQ-030`, `REQ-034`: 统一 RuntimeDriver 与固定 `plan -> execute -> validate -> reflect` 生命周期已落地
  - Evidence: 新增 `thoth/run/driver.py` 与 `thoth/run/driver_process.py`；`run` / `loop` live 路径调用前台 RuntimeDriver 并输出 `thoth.*` JSONL monitor events；`--sleep` 通过私有 `thoth.run.driver_process` 启动 detached RuntimeDriver；`packet.json` 不再暴露 `controller_commands`
  - Evidence: `plan` phase 已加入 `thoth/prompt_specs.py`、`thoth/prompt_validators.py`、`thoth/run/phases.py` 与 runtime tests；`validate` 总是进入 `reflect`，`reflect` 根据 `validate_passed` terminalize completed/failed；phase worker 输出校验已放宽为结构化优先，避免真实 Codex 因合理的结构化 plan 文本被过短字节预算误拒
  - Evidence: `python -m py_compile thoth/objects.py thoth/plan/*.py thoth/run/*.py thoth/surface/*.py thoth/observe/selftest/*.py templates/dashboard/backend/*.py` 通过
  - Evidence: `env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_task_contracts.py tests/unit/test_runtime_protocol.py tests/unit/test_run_state_machine.py tests/unit/test_cli_surface.py tests/unit/test_claude_bridge.py tests/unit/test_dashboard_runtime_api.py tests/integration/test_runtime_lifecycle_e2e.py` 为 `45 passed in 699.23s`
  - Evidence: 补充回归 `env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_command_spec_generation.py tests/unit/test_runtime_supervisor.py` 为 `13 passed in 1.64s`
  - Evidence: 核心五项 selftest `env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m thoth.selftest --case discuss.subtree.close --case run.phase_contract --case run.locked_work --case loop.controller --case observe.object_graph --artifact-dir /mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest/thoth-selftest-runtime-driver-closeout-final --json-report /mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest/thoth-selftest-runtime-driver-closeout-final.json` 为 `overall_status=passed`，报告生成时间 `2026-04-30T07:22:46Z`
  - Evidence: 真实 Codex phase-worker smoke 在 `.tmp_pytest/host-real-codex-smoke/project` 执行 `python -m thoth.cli run --work-id work-codex-smoke-pass --executor codex`，run `run-3e93b5cc16c5` 完成 `plan`、`execute`、`validate`、`reflect` 四阶段，`result.json.status=completed` 且 `result.validate_passed=true`
  - Evidence: 当前宿主 `codex-cli 0.125.0` 可用；`claude --version` 为 `2.1.123 (Claude Code)`，但 `claude auth status` 返回 `{"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty"}`，因此本轮 fresh Claude phase-worker smoke 未执行
  - Conclusion: Runtime 执行层已收敛为同一底座，live/sleep 只在 foreground/detached monitor placement 上分叉；Codex 真实执行链路已验证，Claude 真实执行链路保留为当前机器认证 blocker

- `EV-028` related to `WS-001`, `REQ-005`, `REQ-011`, `REQ-020`: RuntimeDriver 发布面已完成 `dev -> main` cherry-pick、双分支推送与发布验证
  - Evidence: `dev` 上拆分提交为 `5617a34 refactor: unify runtime driver phases` 与 `f7f2b82 docs: record runtime driver closeout`
  - Evidence: `main` 仅 cherry-pick 发布面提交，得到 `5403bd2 refactor: unify runtime driver phases`；未夹带 root `AGENTS.md` / `CLAUDE.md` / `.agent-os/` dev-only 控制面文档
  - Evidence: `main` 发布验证通过：`python -m py_compile thoth/objects.py thoth/plan/*.py thoth/run/*.py thoth/surface/*.py thoth/observe/selftest/*.py templates/dashboard/backend/*.py` 通过；targeted pytest 为 `45 passed in 719.19s`；核心五项 selftest 报告 `.tmp_pytest/thoth-selftest-main-runtime-driver.json` 为 `overall_status=passed`，报告生成时间 `2026-04-30T07:43:35Z`
  - Evidence: 直连 `git push origin dev` 与 escalated retry 均因 GitHub 443 超时失败；使用显式 Git proxy 后 `dev` 已推送 `0d0d4a6..f7f2b82`，`main` 已推送 `b15e2b3..5403bd2`
  - Conclusion: 代码与发布面生成物已集成到 `main` 并推送；开发态治理文档只保留在 `dev`

## Open Checks

- `EV-010` related to `WS-002`: 完整 `.thoth` durable runtime 仍未闭环
  - Conclusion: 当前是基线版 authority/runtime，不应对外声称 V2 全部完成

- `EV-011` related to `WS-001`: `main` 对开发态文档的拒收机制仍待进一步机制化
  - Conclusion: 当前主要依赖分支纪律和 `cherry-pick` 流程

- `EV-012` related to `WS-003`: 当前回合未重跑 Claude host-surface atomic sample
  - Conclusion: `claude auth status` 在本机当前返回 `{"loggedIn": false, "authMethod": "none"}`；因此本轮 fresh sample 只验证了 Codex host-surface cases。历史双宿主 `heavy` gate 证据仍保留在 `EV-020`，但它不等于本回合的新 atomic Claude sample

- `EV-026` related to `TD-031`, `REQ-020`, `REQ-034`: 远端 marketplace 安装刷新未闭合
  - Evidence: `claude plugin marketplace update thoth` 成功，输出 `Successfully updated marketplace: thoth`
  - Evidence: `claude plugin update thoth --scope user` 失败，输出 `Plugin "thoth" not found`
  - Evidence: `claude plugin list --json` 仍显示 `thoth@thoth` `version=0.1.4`、`lastUpdated=2026-04-28T13:09:44.690Z`；`claude plugin marketplace list --json` 显示 marketplace `thoth` 来源为 GitHub `SeeleAI/Thoth`
  - Evidence: `codex plugin marketplace upgrade thoth` 失败，输出 `marketplace thoth is not configured as a Git marketplace`；当前 `codex-cli` 版本为 `0.125.0`，`codex plugin marketplace` 仅提供 `add` / `upgrade` / `remove`，无 list 命令；`which thoth` 当前为空
  - Evidence: 2026-04-30 RuntimeDriver 发布后按远端-only 规则重试：`env https_proxy=http://10.0.3.5:7899 http_proxy=http://10.0.3.5:7899 claude plugin marketplace update thoth` 成功；`claude plugin update thoth --scope user` 仍失败为 `Plugin "thoth" not found`；`codex plugin marketplace upgrade thoth` 仍失败为 `marketplace thoth is not configured as a Git marketplace`；`claude plugin list --json` 中 `thoth@thoth` 仍为 `version=0.1.4` 且 `lastUpdated=2026-04-28T13:09:44.690Z`
  - Conclusion: 按 `CD-035`，当轮未使用本地 checkout/cache/rsync 覆盖安装。代码和远端分支已保持真实状态，本机安装刷新当时保留为 blocker `TD-031`；该 blocker 后续已由 `EV-028` 关闭。

- `EV-028` related to `TD-031`, `REQ-020`, `REQ-034`: 远端 marketplace 安装刷新已闭合
  - Evidence: 按官方 Claude 插件资料与本机 CLI help 修正命令后，Claude Code 侧执行 `claude plugin uninstall thoth@thoth --scope user` 成功，`claude plugin marketplace remove thoth` 成功，`claude plugin marketplace add SeeleAI/Thoth` 成功，`claude plugin install thoth@thoth --scope user` 成功，`claude plugin marketplace update thoth` 成功，`claude plugin update thoth@thoth --scope user` 返回 `thoth is already at the latest version (0.1.4)`
  - Evidence: Codex 侧 `codex plugin marketplace remove thoth` 返回 `marketplace 'thoth' is not configured or installed`，说明此前没有可卸载的 Codex marketplace；随后 `codex plugin marketplace add SeeleAI/Thoth` 成功添加 `thoth`，`codex plugin marketplace upgrade thoth` 成功升级到最新 configured revision
  - Evidence: `claude plugin list --json` 显示 `thoth@thoth` `version=0.1.4`、`scope=user`、`enabled=true`、`installedAt=2026-04-30T09:32:39.090Z`、`lastUpdated=2026-04-30T09:32:39.090Z`；`claude plugin marketplace list --json` 显示 marketplace `thoth` 来源为 GitHub `SeeleAI/Thoth`
  - Evidence: `codex --version` 为 `codex-cli 0.125.0`，`claude --version` 为 `2.1.123 (Claude Code)`
  - Conclusion: 本机双端 Thoth 安装刷新已通过远端 marketplace / host CLI 路径闭合；未使用本地 checkout、cache、临时目录或 `rsync` 覆盖安装
