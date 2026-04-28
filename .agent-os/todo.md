# TODO

## Backlog

- `TD-004` `[backlog]`: 明确 `main` 分支对开发态文档路径的拒收机制
  - Related items: `WS-001`, `MS-002`, `REQ-004`, `REQ-005`

- `TD-005` `[backlog]`: 对照当前 `scripts/init.py` 与目标 audit-first adopt/init 语义整理差距清单
  - Related items: `WS-002`, `MS-004`, `REQ-003`

- `TD-006` `[backlog]`: 梳理当前 repo 结构到未来 `.thoth/` authority layout 的迁移映射
  - Related items: `WS-002`, `MS-004`, `REQ-003`

## Ready

- `TD-001` `[ready]`: 将 `dev` / `main` 分流规则固化为仓库内可执行治理机制
  - Related items: `WS-001`, `MS-002`, `REQ-004`, `REQ-005`

- `TD-003` `[ready]`: 把 V2 架构问题整理成 decision-complete 的迁移主线
  - Related items: `WS-002`, `MS-004`, `REQ-003`

- `TD-016` `[ready]`: 梳理当前冗余抽象、重复状态源与过度包装清单，明确哪些必须删除、合并或下沉
  - Related items: `WS-005`, `MS-005`, `REQ-022`, `REQ-023`, `REQ-024`

- `TD-017` `[ready]`: 收敛公开命令层、宿主投影层与 bridge/skill surface，使 host difference 只停留在交互适配而非语义分叉
  - Related items: `WS-003`, `WS-005`, `MS-005`, `REQ-006`, `REQ-019`, `REQ-023`, `REQ-024`

- `TD-018` `[ready]`: 收敛 planning authority 与 task compiler，把 Decision / Contract / Task / Verdict 之间的 canonical 数据模型压实
  - Related items: `WS-002`, `WS-005`, `MS-004`, `MS-005`, `REQ-023`, `REQ-024`

- `TD-019` `[ready]`: 收敛 runtime protocol 与 run state machine，明确 live / sleep / attach / resume / stop 的唯一状态流
  - Related items: `WS-002`, `WS-005`, `MS-005`, `REQ-023`, `REQ-024`

- `TD-020` `[ready]`: 收敛 execution orchestration，实现 host-neutral runtime core 与最小 host adapter
  - Related items: `WS-002`, `WS-003`, `WS-005`, `MS-005`, `REQ-019`, `REQ-023`, `REQ-024`

- `TD-021` `[ready]`: 收敛 project materialization 流程，简化 init / sync / render / migrate 的责任边界
  - Related items: `WS-002`, `WS-005`, `MS-005`, `REQ-018`, `REQ-022`, `REQ-023`

- `TD-022` `[ready]`: 收敛 observability/read-model，把 status / doctor / report / dashboard / hooks 统一为 authority 的只读派生层
  - Related items: `WS-002`, `WS-003`, `WS-005`, `MS-005`, `REQ-014`, `REQ-022`, `REQ-024`

## Doing

- None

## Blocked

- None

## Done

- None

## Verified

- `TD-015` `[verified]`: 冻结 Thoth 的高维分层架构与层间协议，并把用户本轮“简化、不丢功能、不改语义、最终 heavy 双宿主通过”的要求翻译成可执行重构主线
  - Related items: `WS-005`, `MS-005`, `REQ-022`, `REQ-023`, `REQ-024`, `REQ-025`
- `TD-002` `[verified]`: 当前插件公开 surface、README 与安装行为已重新对齐
- `TD-007` `[verified]`: `dev` 状态文档系统已初始化
- `TD-010` `[verified]`: 官方平台资料治理层已建立
- `TD-011` `[verified]`: task-first 的 run-ledger dashboard contract 已落地
- `TD-012` `[verified]`: 双层重型自测试系统已落地
- `TD-013` `[verified]`: `/thoth:init` 的 audit-first adopt/init 主流程已落地
- `TD-014` `[verified]`: strict `Decision -> Contract -> Task` 编译执行体系已落地
- `TD-024` `[verified]`: 以 `Codex-only` closing gate 作为本轮唯一结束门槛，并按用户最新计划完成 `dev` 收口；本轮不执行 `main` 集成、不刷新本机 Claude/Codex 安装
  - Related items: `WS-001`, `WS-003`, `WS-005`, `MS-005`, `REQ-020`, `REQ-025`
  - Evidence: WSL Node LTS `v20.20.2` 与 Codex CLI `0.125.0` 可用；`py_compile`、pytest `light` / `medium`、targeted integration、`hard --hosts none`、真实 Codex-only fast contract gate 均通过

- `TD-025` `[verified]`: 将 `run` / `loop` 收敛为 Python 机械化四阶段状态机，并让 `loop` 以父 orchestrator 复用 child `run`
  - Related items: `WS-002`, `WS-005`, `MS-005`, `REQ-023`, `REQ-024`
  - Evidence: `thoth/run/phases.py`、`thoth/run/{packets,worker,ledger}.py`、`thoth/plan/{compiler,validators}.py`、`tests/unit/test_run_state_machine.py`；`python -m pytest -q tests/unit/test_task_contracts.py tests/unit/test_run_state_machine.py tests/unit/test_runtime_protocol.py tests/unit/test_cli_surface.py tests/unit/test_claude_bridge.py tests/integration/test_runtime_lifecycle_e2e.py tests/unit/test_dashboard_runtime_api.py` 为 `37 passed`

- `TD-023` `[verified]`: 收敛验证体系，明确 `hard` 与 `heavy` 的职责边界，并把 `heavy` 收口为双宿主 public-command conformance gate
  - Related items: `WS-003`, `WS-005`, `MS-005`, `REQ-017`, `REQ-021`, `REQ-022`
  - Evidence: `python -m thoth.cli sync` 未引入新的 tracked projection 漂移；`python -m py_compile thoth/observe/selftest/{fixtures,hard_suite,host_claude,host_codex,host_common,model,runner}.py thoth/{projections,prompt_specs,selftest_seed}.py thoth/surface/run_commands.py tests/unit/test_{selftest_helpers,command_spec_generation,claude_bridge}.py tests/integration/test_runtime_lifecycle_e2e.py` 通过；`env TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m pytest -q tests/unit/test_selftest_helpers.py tests/unit/test_command_spec_generation.py tests/unit/test_claude_bridge.py tests/unit/test_cli_surface.py tests/integration/test_runtime_lifecycle_e2e.py` 为 `54 passed in 705.84s`；`python -m thoth.selftest --tier hard --hosts none --artifact-dir /tmp/thoth-hard-command-gate-artifacts-20260428 --json-report /tmp/thoth-hard-command-gate-summary-20260428.json` 为 `25 passed / 0 failed / 0 degraded`

- `TD-026` `[verified]`: 收掉 `heavy` 双宿主命令协议门剩余的 host-real 阻塞，并把真实 `heavy --hosts both` 跑绿
  - Related items: `WS-003`, `WS-005`, `MS-005`, `REQ-017`, `REQ-019`, `REQ-025`
  - Evidence: 用户提供的 Claude 登录态环境下执行 `env PATH=/mnt/cfs/5vr0p6/yzy/thoth/bin:$PATH ANTHROPIC_BASE_URL='https://api.deepseek.com/anthropic' ANTHROPIC_AUTH_TOKEN='***' ANTHROPIC_MODEL='deepseek-v4-pro[1m]' ANTHROPIC_DEFAULT_OPUS_MODEL='deepseek-v4-pro[1m]' ANTHROPIC_DEFAULT_SONNET_MODEL='deepseek-v4-pro[1m]' ANTHROPIC_DEFAULT_HAIKU_MODEL='deepseek-v4-flash' CLAUDE_CODE_SUBAGENT_MODEL='deepseek-v4-flash' CLAUDE_CODE_EFFORT_LEVEL='max' TMPDIR=/mnt/cfs/5vr0p6/yzy/thoth/.tmp_pytest python -m thoth.selftest --tier heavy --hosts both --artifact-dir /tmp/thoth-heavy-both-command-gate-artifacts-20260428-rerun --json-report /tmp/thoth-heavy-both-command-gate-summary-20260428-rerun.json`，结果 `104 passed / 0 failed / 0 degraded`

## Abandoned

- `TD-008` `[abandoned]`: 使用 bare command 名作为公共命令前缀
  - Reason: 实际宿主行为验证后不符合目标，公共命令已恢复为显式 `/thoth:*`
