# Acceptance Report

## Passed Checks

- `EV-001` related to `WS-003`: 当前公开命令面已稳定为显式 `/thoth:*` 与单一 `$thoth <command>`
  - Evidence: `commands/*.md`、`.agents/skills/thoth/`、`.codex-plugin/plugin.json`
  - Conclusion: 当前公开 surface 与仓库定位一致

- `EV-002` related to `TD-012`: 重型自测试系统已落地
  - Evidence: `scripts/selftest.py`、`thoth/selftest.py`、`thoth/observe/selftest/runner.py`
  - Conclusion: 仓库具备 repo-real 的机械化验证入口

- `EV-003` related to `TD-014`: strict `Decision -> Contract -> Task` 执行 authority 已落地
  - Evidence: `thoth/plan/compiler.py`、`thoth/plan/store.py`、`.thoth/project/tasks` 相关读写逻辑、dashboard compiler 读面
  - Conclusion: `run` / `loop` 默认只接受 `--task-id`

- `EV-004` related to `WS-003`: 公开安装面已切换到 `SeeleAI/Thoth`
  - Evidence: `README.md`、`.claude-plugin/`、`.codex-plugin/`、`thoth/projections.py`
  - Conclusion: 仓库对外元数据已统一到公开 canonical upstream

- `EV-005` related to `REQ-007`: dev 状态文档已清理私人路径、个人邮箱和外部项目来源链
  - Evidence: `.agent-os/` 已精简为公开版最小集
  - Conclusion: 当前 dev 分支不再暴露无运行必要的私有上下文

- `EV-006` related to `REQ-021`: pytest 三层验证入口已落地
  - Evidence: `tests/conftest.py`、`tests/unit/test_pytest_tiers.py`、`README.md`、`python -m pytest -q --thoth-tier light`、`python -m pytest -q --thoth-tier medium`、`python -m pytest -q --thoth-tier heavy`
  - Conclusion: 仓库已提供 `light` / `medium` / `heavy` 三层 pytest 选择器与使用约定，且本轮验证结果分别为 `1.64s`、`25.40s`、`190.89s`

- `EV-007` related to `REQ-023`, `REQ-024`, `REQ-026`, `REQ-027`: 新四层骨架、双层结果模型与 canonical run ledger 已落到代码主链
  - Evidence: `thoth/surface/cli.py`、`thoth/surface/handlers.py`、`thoth/plan/compiler.py`、`thoth/run/lifecycle.py`、`thoth/init/service.py`、`thoth/observe/status.py`、`thoth/observe/report.py`、`thoth/observe/dashboard.py`、`templates/dashboard/backend/runtime_loader.py`、`templates/dashboard/backend/data_loader.py`
  - Conclusion: 当前代码已经共享 `Surface / Plan / Run / Observe` 的分层约束、`RunResult + TaskResult` 的结果模型、`run/state/events/result/artifacts` 的 run ledger 形态，以及 `review` live-only / `loop` 新鲜 review consumption 规则

- `EV-008` related to `WS-005`: 本轮重构关键切片已通过针对性代码验证
  - Evidence: `python -m py_compile thoth/surface/cli.py thoth/surface/handlers.py thoth/surface/hooks.py thoth/surface/bridges/claude.py thoth/plan/compiler.py thoth/plan/store.py thoth/plan/results.py thoth/plan/doctor.py thoth/run/lifecycle.py thoth/run/status.py thoth/init/service.py thoth/init/render.py thoth/observe/status.py thoth/observe/report.py thoth/observe/dashboard.py thoth/observe/selftest/runner.py scripts/init.py scripts/sync.py scripts/status.py scripts/report.py scripts/doctor.py scripts/session-hook.py`；`python -m pytest -q tests/unit/test_runtime_protocol.py tests/unit/test_runtime_supervisor.py tests/unit/test_task_contracts.py tests/unit/test_init.py tests/unit/test_cli_surface.py tests/unit/test_host_hooks.py tests/unit/test_status.py tests/unit/test_report.py`；`python -m pytest -q tests/integration/test_init_workflow.py tests/integration/test_runtime_lifecycle_e2e.py`；`python -m pytest -q tests/unit/test_selftest_helpers.py tests/unit/test_data_loader.py tests/unit/test_runtime_loader.py tests/unit/test_dashboard_runtime_api.py`
  - Conclusion: 相关代码面已通过 `50` 个 targeted unit tests、`9` 个 integration tests 与 `28` 个 selftest/read-model 单测，说明新包级主链在当前 checkout 上自洽

- `EV-009` related to `WS-003`, `WS-005`: 新架构下的 repo-real `hard` gate 仍保持通过
  - Evidence: `python -m thoth.selftest --tier hard --hosts none --artifact-dir /tmp/thoth-hard-simplify-artifacts --json-report /tmp/thoth-hard-simplify-summary.json`
  - Conclusion: 当前 checkout 在不依赖真实宿主交互的前提下，`hard` 自测结果为 `25 passed / 0 failed / 0 degraded`

## Open Checks

- `EV-010` related to `WS-002`: 完整 `.thoth` durable runtime 仍未闭环
  - Conclusion: 当前是基线版 authority/runtime，不应对外声称 V2 全部完成

- `EV-011` related to `WS-001`: `main` 对开发态文档的拒收机制仍待进一步机制化
  - Conclusion: 当前主要依赖分支纪律和 `cherry-pick` 流程

- `EV-012` related to `WS-005`: Thoth 的整体简化重构尚未达到最终结束条件
  - Conclusion: 当前已形成阶段性代码收敛证据，但还没有 `Codex-only` closing gate、`dev -> main` 集成、双分支 push 与本机安装更新证据
