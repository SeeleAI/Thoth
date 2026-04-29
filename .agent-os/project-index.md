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

- 2026-04-29: 统一对象图与 Agent Runtime Kernel 已在 `dev` 当前 checkout 落地：新增 `.thoth/objects/<kind>/<object_id>.json` canonical Store，删除独立 `Contract` kind 的 authority 语义，`work_item.payload` 承载 goal / constraints / execution_plan / eval_contract / runtime_policy / decisions，`run` 绑定 `work_id@revision`，`loop` / `orchestration` / `auto` 改为 controller service；public `run` / `loop` / `review` 已切到 `--work-id`，`discuss` 切到 `--work-json`。
- 2026-04-29: Runtime Kernel closeout 进一步删除旧主路径兼容命名与 fallback：`upsert_contract` / `load_task_for_execution` / `suggest_tasks_for_query` / `TaskResult` / `task_result` / `.thoth/project` 不再作为 runtime authority 或 public execution path；普通 `run` 只写 `run`、`phase_result`、`artifact` object 与 `.thoth/runs/<run_id>/phase_state.json` ledger，不再额外创建 controller object；`loop` 仍作为 controller service 写 controller lineage。
- 2026-04-29: 本轮对象图重构验证已完成并扩展到 init / dashboard / hook / lifecycle 主链：targeted pytest `59 passed in 362.53s` 与 focused runtime suite `34 passed in 668.46s`；atomic selftest `discuss.subtree.close`、`run.phase_contract`、`run.locked_work`、`loop.controller`、`orchestration.controller`、`auto.queue`、`observe.object_graph` 单次执行为 `overall_status=passed`；临时 CLI probe 已确认 `init -> discuss decision -> discuss work -> run --work-id` 可生成 work/run/controller/phase/artifact 对象，active work mutation 返回 `blocked_by_active_execution`。
- 2026-04-29: 本轮最终关闭门已收窄为核心五项 selftest：`discuss.subtree.close`、`run.phase_contract`、`run.locked_work`、`loop.controller`、`observe.object_graph`；`auto` / `orchestration` 保留现有 public surface 与测试覆盖，但不作为本轮 Runtime Kernel 关闭门。
- 2026-04-28: prompt router 已进一步收敛为“薄宿主投影 + 压缩 packet authority”：`CommandSpec` 新增 `route_class` / `intelligence_tier` / `packet_authority_mode`，Claude `commands/*.md` 收敛为 runtime-first 薄包装，Codex 根 `SKILL.md` 收敛为薄 dispatcher，并新增按命令拆分的 micro prompt files。
- 2026-04-28: 公开 selftest 合同已从旧 `hard/heavy` 长链改为 atomic case registry：`python -m thoth.selftest` 现在必须显式传 `--case`，repo-local 首批 `10` 个 atomic cases 已在 `/tmp/thoth-atomic-repo-cases-20260428.json` 真实通过。
- 2026-04-28: 仓库级 pytest 合同已改为 targeted-only：裸 `pytest`、目录级 `pytest` 与 broad `--thoth-tier` 默认失败；`--thoth-target` manifest 与 `scripts/recommend_tests.py` 已落地，`--thoth-target selftest-core` 与 focused runtime/selftest pytest 真实通过。
- 2026-04-28: host-surface atomic case 已按“最小 authority materialization + ready-task seeding + explicit window”重构；Codex 抽样 `surface.codex.run.live_prepare` 与 `surface.codex.loop.sleep_prepare` 已在 `/tmp/thoth-atomic-codex-sample-20260428e.json` 真实通过，而当前机器的 `claude auth status` 仍为未登录。
- 2026-04-28: `run` / `loop` live 路径已从固定 `plan -> exec -> validate -> reflect` 收敛为 validator-centered 短链：默认 `execute -> validate`，仅在 validator 失败时进入 `reflect`；review packet 现显式区分 `exact_match` 与 `open_ended`。
- 2026-04-28: 本轮 prompt/packet 体积压缩已落账：Codex 根 skill `10832 -> 3258` bytes，Claude `run` projection `4118 -> 2984` bytes，`loop` `4053 -> 2969` bytes，`review` `3593 -> 2790` bytes；相关 targeted pytest `22 + 6 + 13` 条均通过。
- 2026-04-23: `/thoth:init` 已升级为 audit-first adopt/init，并生成最小 `.thoth` authority tree。
- 2026-04-23: 仓库已明确双宿主同步开发与固定收尾流程。
- 2026-04-23: 已建立双层自测试系统，`hard` 档覆盖真实 temp repo、runtime、dashboard 和 hooks。
- 2026-04-24: 已落地 strict `Decision -> Contract -> Task` 执行 authority，`run` / `loop` 默认只接受 `--task-id`；该记录为历史证据，已被 2026-04-29 的 unified object graph / `--work-id` authority 替换。
- 2026-04-24: 仓库 canonical upstream、README 和插件元数据已切换到 `SeeleAI/Thoth`。
- 2026-04-24: dev 分支状态文档已精简为公开版最小集，不再保留私人路径和外部项目来源链。
- 2026-04-25: 用户锁定本轮主目标为“在不丢功能与约束的前提下，大幅简化 Thoth 的整体实现，并先冻结高维分层架构，再完成收口验证”；closing gate 已进一步收窄为 `Codex-only`。
- 2026-04-25: 旧的 `thoth/runtime.py`、`thoth/task_contracts.py`、`thoth/project_init.py`、`thoth/claude_bridge.py`、`thoth/host_hooks.py` 已从主实现路径删除；当前 canonical 包级骨架为 `thoth/surface`、`thoth/plan`、`thoth/run`、`thoth/init`、`thoth/observe`。
- 2026-04-25: 当前代码已落成 `Surface / Plan / Run / Observe` 四层骨架、`RunResult + work_result` 双层结果模型、`run/state/events/result/artifacts` canonical run ledger，以及 `review` live-only / `loop` 自动消费新鲜 review 的运行规则；该行保留为历史阶段记录，当前 runtime 绑定语义已改为 `work_id@revision`。
- 2026-04-25: 已完成本轮关键验证切片：targeted unit `50 passed`、integration `9 passed`、selftest/read-model unit `28 passed`、`python -m thoth.selftest --tier hard --hosts none` `25 passed / 0 failed / 0 degraded`；`Codex-only` closing gate 与分支收尾仍未完成，不得视为结束。
- 2026-04-26: 本轮九阶段架构简化已在 `dev` 上完成代码收口：`run/lifecycle.py` 已删除，Run / Plan / Init / Surface / Observe / Selftest 主实现拆入职责模块；WSL Node LTS 与 Codex CLI 已修复；`py_compile`、pytest `light` / `medium`、targeted integration、`hard --hosts none` 与真实 Codex-only fast contract gate 均通过。本轮按用户最新计划只收口 `dev`，不执行 `main` 集成与本机安装刷新。
- 2026-04-27: `run` / `loop` 已进一步收敛为 Python 机械 phase engine：task compiler 默认补 `runtime_contract.loop = {10, 28800}`、frozen task 强制要求 `validate_output_schema`、单次 `run` 固定为 `plan -> exec -> validate -> reflect`、`loop` 固定为父 run 复用 child `run` 的 bounded orchestrator；针对性验证 `37 passed`
- 2026-04-27: prompt authority 已拆为 `thoth/prompt_specs.py` 与 `thoth/prompt_validators.py` 两层，`work_result` 的 `verdict` 别名层已删除，`run` 的 fresh-review 读取改为共享 helper，selftest 的 `model/recorder/runner/host adapters` 已去掉一批重复定义与星号导入；新增 `scripts/measure_tracked_source.py` 产出 tracked-source 压缩账本；相关 `68` 条单测与 `9` 条集成测试通过
- 2026-04-28: 用户已批准恢复标准发布收尾；本轮代码面已按 `dev -> main` 受控 `cherry-pick` 集成到 `main` 并完成远端推送，`.tmp_pytest/` 已纳入忽略规则，本机 Claude/Codex 的 Thoth 缓存与 marketplace 源目录也已同步到当前仓库内容
- 2026-04-28: 已修复安装面入口漂移：仓库新增 `bin/thoth` wrapper，README 与 Codex skill 现在明确区分“插件安装态的 `thoth` / host public surface”和“当前 Thoth 源码仓开发时的 `python -m thoth.cli` fallback”；空目录下以 `PATH=<repo>/bin:$PATH` 真实验证 `thoth init`、`thoth dashboard start/stop` 均通过
- 2026-04-28: 用户已重锁 `heavy` 的关闭门语义：不再以 `Codex-only` fast gate 或 feature/bugfix/loop 闭环为准，而改为双宿主 headless public-command conformance gate；`heavy` 不再重跑 `hard`，host-real fixture 改为最小 command-probe repo，`run/loop` 只测 `--sleep` handoff、`review` 必须 exact-match 固定单 finding，并新增 `tracker/` source-write guard 与全局 `300s` 预算
- 2026-04-28: 本轮围绕新 `heavy` 语义完成最终验证与记账：`python -m thoth.cli sync` 无新增 projection 漂移，targeted `py_compile` 通过，targeted pytest 为 `54 passed in 705.84s`，`python -m thoth.selftest --tier hard --hosts none --artifact-dir /tmp/thoth-hard-command-gate-artifacts-20260428 --json-report /tmp/thoth-hard-command-gate-summary-20260428.json` 为 `25 passed / 0 failed / 0 degraded`
- 2026-04-28: 使用用户提供的 DeepSeek Anthropic compatibility Claude 登录态环境重新执行真实关闭门后，`python -m thoth.selftest --tier heavy --hosts both --artifact-dir /tmp/thoth-heavy-both-command-gate-artifacts-20260428-rerun --json-report /tmp/thoth-heavy-both-command-gate-summary-20260428-rerun.json` 已通过，结果为 `104 passed / 0 failed / 0 degraded`；`heavy` 双宿主 public-command conformance gate 现已真实关闭

## Read Next

- [requirements.md](requirements.md)
- [architecture-milestones.md](architecture-milestones.md)
- [todo.md](todo.md)
- [run-log.md](run-log.md)
- [official-sources/source-governance.md](official-sources/source-governance.md)
