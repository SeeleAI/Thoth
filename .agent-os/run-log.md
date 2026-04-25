# Run Log

## Entries

- 2026-04-25 14:00 UTC [host-real cache/validator cleanup and interrupted heavy closeout]
  - Worked on: `OBJ-001`, `WS-002`, `WS-003`
  - State changes: 为 host-real validator 增加共享 Playwright/NPM/XDG 缓存、浏览器已就绪跳过重复 install、stale `ms-playwright/__dirlock` 清理，以及 runtime ledger JSON 并发安全写入；同时把 heavy 验收补上“run/loop 出现 fallback/degraded 文案即直接失败”的护栏；按用户中断要求停止了后台 `heavy --hosts codex` 和临时 validator probe，只保留代码与测试变更，不继续占用宿主会话
  - Evidence produced: 更新 `thoth/runtime.py`、`thoth/selftest.py`、`thoth/selftest_seed.py`、`tests/unit/test_runtime_supervisor.py`、`tests/unit/test_selftest_helpers.py`；验证 `python -m py_compile thoth/runtime.py thoth/selftest.py thoth/selftest_seed.py` 通过，`python -m pytest -q tests/unit/test_runtime_supervisor.py tests/unit/test_selftest_helpers.py tests/unit/test_runtime_protocol.py` 通过（`24 passed`）；已确认不再有运行中的 `thoth.selftest --tier heavy --hosts codex` / preflight Playwright 下载进程
  - Next likely action: 若继续收口 host-real matrix，下一步直接在当前代码上重新串行跑 `heavy --hosts codex`，等共享浏览器缓存预热完成后再跑 `heavy --hosts claude`，最后只输出双宿主命令状态表

- 2026-04-25 11:45 UTC [run-loop live+sleep runtime hardening and codex heavy unblock]
  - Worked on: `OBJ-001`, `WS-002`, `WS-003`
  - State changes: 将 `scripts/dashboard.sh` 从普通 shell 后台任务升级为 `nohup + setsid + pidfile` 的 detached dashboard，修复 Codex 非交互会话结束后 dashboard 存活丢失；把 `thoth.runtime.worker_main()` 从 synthetic heartbeat worker 升级为真实 external-worker orchestration，默认按 executor 拉起 `claude -p` / `codex exec`，生成 prompt 文件、记录 worker logs、要求 protocol terminalize，并新增仅供测试使用的 `THOTH_TEST_EXTERNAL_WORKER_MODE={complete,hold,fail}` seam；将 repo-hard runtime gate 扩成 `run live + run --sleep + loop live + loop --sleep` 双态覆盖；把 heavy host-real 的 run/loop 主链改成同时覆盖 live 与 sleep，其中 Claude 宿主走 `run(feature live) -> run(bugfix sleep via claude worker) -> review(--executor codex) -> loop(sleep) -> loop(live followup)`，Codex 宿主走 `run(feature live) -> run(bugfix sleep via codex worker) -> review -> loop(sleep via codex worker) -> loop(live followup)`；同时为 Codex host-real 加上 `2` 次、`90s` 窗口内的 transient retry，并把非交互 Codex 路径显式钉到 `gpt-5.4`，避开当前机器 `~/.codex/config.toml` 中坏掉的 `gpt-5.5` 默认值；为减小 `discuss` prompt 体积，又把 heavy 的 decision/contract payload 改成 repo 内临时 JSON 文件引用，而不是直接把大 JSON 内联进 prompt
  - Evidence produced: 更新 `scripts/dashboard.sh`、`thoth/runtime.py`、`thoth/selftest.py`、`tests/integration/test_runtime_lifecycle_e2e.py`、`tests/unit/test_runtime_protocol.py`；验证 `python -m pytest -q tests/integration/test_runtime_lifecycle_e2e.py -k dashboard_process_and_hooks_are_observable` 通过，手工 detached probe 证实 dashboard 在调用方退出后仍可通过 `/api/status` 探活且会写 `.thoth/derived/dashboard.pid`；验证 `python -m pytest -q tests/unit/test_runtime_protocol.py tests/integration/test_runtime_lifecycle_e2e.py` 通过（`7 passed`），`python -m pytest -q tests/unit/test_selftest_helpers.py` 通过（`12 passed`），`python -m thoth.selftest --tier hard --hosts none --artifact-dir /tmp/thoth-hard-latest --json-report /tmp/thoth-hard-latest.json` 通过（`overall_status=passed`，新增 `runtime.run_sleep`、`runtime.loop_live_prepare`、`runtime.loop_sleep` 均为 `passed`）；最小 `codex exec -m gpt-5.4 --json --full-auto -C /mnt/cfs/5vr0p6/yzy/thoth 'Reply with exactly MODEL_OK.'` 已真实返回 `MODEL_OK`；heavy Codex 从先前的 `host.codex init` 直接 503 hard-fail，推进到了显式 `gpt-5.4`、短 prompt、file-backed `discuss` 的新路径，当前最新在 `/tmp/thoth-heavy-codex-latest` 下已确认 `host-codex-init.txt`、`host-codex-status.txt`、`host-codex-doctor.txt` 和 file-backed `discuss-decision` 正在推进，但整条 heavy host-real 仍未最终跑绿
  - Next likely action: 继续把 `heavy --hosts codex` 跑到第一个真实 `run` 账本并收敛剩余慢点/失败点，随后再重跑 `heavy --hosts claude` 验证同一套 live+sleep matrix，最终以双宿主 real host green 作为 closeout，而不是把当前中间进度误记成完成

- 2026-04-24 16:40 UTC [official platform live-check for long-running session semantics]
  - Worked on: `OBJ-001`, `WS-004`
  - State changes: 按 `source-governance.md` 对 OpenAI Codex 与 Claude Code 官方页面做 live-check，重点重核 `background`、`subagents`、`hooks`、`shell`、`monitor` 与 session continuity；确认 OpenAI 侧应继续区分 API `background + webhook/polling` 原语、Codex automations/background worktree 与 CLI shell 三层，而 Claude 侧官方已经给出 Agent SDK 的 persistent shell、`Monitor`、session storage、foreground/background subagent 与 hooks 生命周期事件；据此收紧仓库内 cross-platform 结论：短中期提升 live session 稳定性时，应优先把 Claude 宿主连续性当作 execution substrate，把 `.thoth/runs/*` 保持为唯一 repo authority
  - Evidence produced: 更新 `.agent-os/official-sources/platform-index.md`，新增 `SRC-OAI-014` 与 `SRC-ANT-010` ~ `SRC-ANT-014`；更新 `.agent-os/official-sources/openai-codex-and-api.md`、`.agent-os/official-sources/claude-code-runtime-and-platforms.md`、`.agent-os/official-sources/codex-vs-claude-code.md`；外部 authority 包括 OpenAI `Background mode`、`Webhooks`、`Codex Automations`、`Codex CLI features`、`Codex Subagents`、`Codex Hooks`、`Codex Local environments` 与 Anthropic `How Claude Code works`、`Remote Control`、`Sub-agents`、`Hooks`、`Agent SDK`、`Hosting`、`Monitoring`、`Sessions`、`Session storage`
  - Next likely action: 将这些官方能力差异进一步映射回 Thoth 的 runtime contract，重点考虑如何把 Claude session/monitor/hook 信号更机械地投影进 `.thoth/runs/*`，以及如何在 Codex 侧维持最小但稳定的 worker / automation / hook 接入面

- 2026-04-24 23:28 UTC [heavy host-real structured discuss unblock and live-packet blocker isolation]
  - Worked on: `OBJ-001`, `WS-003`
  - State changes: 修复 Claude `/thoth:discuss` 与 `/thoth:review` projection 的结构化参数吞没问题，不再把整串参数塞进 `--goal`；补充 host-real seed 的 phase-specific Playwright validators（`feature-create.spec.ts` / `column-persist.spec.ts`）；将 `heavy` 宿主链路升级为通过 public `discuss --decision-json/--contract-json` 冻结 3 个 strict tasks，并要求后续走 `run feature -> run bugfix -> review -> loop -> dashboard -> final validators`；同时将 Claude live command surface 改成 `run/loop/review` 明确 `disable-model-invocation: false`，并把 live packet contract 文案收紧为“prepare 不等于完成，必须 protocol terminalize”
  - Evidence produced: 更新 `thoth/projections.py`、`thoth/selftest.py`、`thoth/selftest_seed.py`、`tests/unit/test_command_spec_generation.py`、`tests/unit/test_cli_surface.py`、`tests/unit/test_selftest_helpers.py`；验证 `python -m py_compile thoth/selftest.py thoth/selftest_seed.py thoth/projections.py` 通过，`python -m pytest -q tests/unit/test_command_spec_generation.py tests/unit/test_cli_surface.py tests/unit/test_selftest_helpers.py` 通过（`25 passed`），追加回归 `python -m pytest -q tests/unit/test_command_spec_generation.py` 通过（`7 passed`）；真实 `python -m thoth.selftest --tier heavy --hosts claude --artifact-dir /tmp/thoth-heavy-claude-artifacts-next --json-report /tmp/thoth-heavy-claude-summary-next.json` 已确认 `structured discuss` 真正落账并把 compiler `ready` 从 `0 -> 3`，但随后 `run-cf85933b0640` 仅停在 `.thoth/runs/*/state.json = {status: running, phase: prepared}`，无 heartbeat / event / code-edit 证据，heavy 以 `host.claude.feature_run` timeout hard-fail；同类现象在下一次重跑里仍可复现到 `run-93e6c681b1b8`
  - Next likely action: 继续锁定 Claude live packet 第二阶段为什么仍未真正执行，重点排查当前 slash command frontmatter / Claude custom-command contract 是否仍把 `run/loop/review` 当成“bridge 后总结”而不是“bridge 后继续执行”，随后再重跑 `heavy --hosts claude`，确认 feature run 不再卡在 `prepared`

- 2026-04-24 14:50 UTC [host command matrix expansion for heavy dual-host selftest]
  - Worked on: `OBJ-001`, `WS-003`
  - State changes: 将 `heavy` 宿主侧从 `init/status` smoke 扩展到 `init -> status -> doctor -> report -> sync -> discuss` 的真实 public command matrix；Claude 侧通过 `/thoth:*` bridge 逐条落到 `.thoth/derived/host-bridges`，Codex 侧通过 `$thoth` skill 逐条执行并校验 report/conversation/hook 产物
  - Evidence produced: 更新 `thoth/selftest.py`；验证 `python -m py_compile thoth/selftest.py`、`python -m pytest -q tests/unit/test_selftest_helpers.py` 通过；`python -m thoth.selftest --tier heavy --hosts both --artifact-dir /tmp/thoth-heavy-both-artifacts2 --json-report /tmp/thoth-heavy-both-summary2.json` 当前通过，summary 为 `30 passed / 0 failed / 0 degraded`
  - Next likely action: 继续把 host-real 从当前 command-matrix 覆盖推进到计划中的真实 feature task、bugfix task、review findings closure、loop bounded iteration，以及 Claude `--executor codex` 桥接覆盖

- 2026-04-24 14:14 UTC [codex host-real .codex conflict removal and dual-host heavy green]
  - Worked on: `OBJ-001`, `WS-003`, `WS-004`
  - State changes: 回源核验 OpenAI Codex `Config Basics` / `Config Reference` 后，确认 repo-root `.codex` 属于 Codex 宿主配置层，不再把它当成 Thoth init 的受管目录；`init` 改为只生成 `.thoth` authority 与 `.thoth/derived/codex-hooks.json` 投影，heavy preflight 额外接管全局 `~/.codex/hooks.json`；`_host_codex()` 拆成真实 `init` / `status` 两步 public-surface 调用，避免宽 prompt 漫游
  - Evidence produced: 新增/更新 `thoth/project_init.py`、`thoth/selftest.py`、`thoth/command_specs.py`、`scripts/init.py` 与相关单测/集成测试；验证 `python -m pytest -q tests/unit/test_init.py tests/unit/test_cli_surface.py tests/unit/test_selftest_helpers.py tests/integration/test_init_workflow.py tests/integration/test_runtime_lifecycle_e2e.py` 通过、`python -m pytest -q tests/unit/test_command_spec_generation.py tests/unit/test_runtime_protocol.py` 通过；真实 `codex exec` 在 `/tmp/thoth-codex-init-fixed-*` 与 `/tmp/thoth-selftest-codex` 上均可完成 `thoth init` / `thoth status`；`python -m thoth.selftest --tier heavy --hosts codex` 与 `python -m thoth.selftest --tier heavy --hosts both` 当前通过
  - Next likely action: 继续把 heavy 从当前 `init/status + hooks/session evidence` smoke 推进到计划中的完整 public command matrix、真实 feature/bug/review/loop 闭环，以及 Claude `--executor codex` 桥接覆盖

- 2026-04-24 12:12 UTC [heavy host-real preflight and dual-host scaffolding]
  - Worked on: `OBJ-001`, `WS-003`, `WS-004`
  - State changes: 修复 `thoth.selftest` 中的 hard/heavy 漂移，补上 live `review` stop 与 dashboard stale 对齐当前 runtime；为 heavy 新增 Codex hooks `[features]` 修复、全局 `~/.codex/skills/thoth` 安装对齐、seed frontend `package-lock` 物化与固定双宿主 repo 重建；新增 selftest helper 单测
  - Evidence produced: `python -m thoth.selftest --tier hard --hosts none` 已重新通过；`python -m thoth.selftest --tier heavy --hosts claude` 当前通过；`python -m thoth.selftest --tier heavy --hosts codex` 当前失败形态已收敛为真实 `codex exec` 超时，而不是 skill 不可见或 hooks 未启用；更新 `thoth/selftest.py`、新增 `tests/unit/test_selftest_helpers.py`
  - Next likely action: 继续把 Codex host matrix 从“init/status 超时”推进到完整 command matrix，可优先拆成更细的 public-surface 调用并记录每一步真实卡点，再把 `run/review/loop` 的 host-real 执行链补齐

- 2026-04-24 19:35 UTC [runtime live-vs-sleep refactor]
  - Worked on: `OBJ-001`, `WS-002`, `WS-003`
  - State changes: `run` / `loop` / `review` 从旧的 `--detach + supervisor` 语义切到 `prepare packet + internal protocol`；默认 executor 收敛到 `claude`；`--sleep` 成为唯一背景 external-worker 入口；generated Claude/Codex projections 与测试面同步到新 contract
  - Evidence produced: 更新 `thoth/runtime.py`、`thoth/cli.py`、`thoth/claude_bridge.py`、`thoth/command_specs.py`、`thoth/projections.py`、`thoth/selftest.py`，新增 `tests/unit/test_runtime_protocol.py`，并验证 `37 passed`
  - Next likely action: 继续把 `heavy` 自测场景补齐到固定双宿主 FastAPI+Vite host-real matrix，并把 preflight/hook 全局配置管理完全对齐新计划

- 2026-04-24 09:05 UTC [public repo sanitization]
  - Worked on: `OBJ-001`, `WS-003`
  - State changes: 仓库从“公开 surface 已开源，但仍残留个人身份字段、私人本地路径和历史外部项目引用” -> “公开元数据统一为组织身份，dev 状态文档收敛为公开版最小集”
  - Evidence produced: 更新 `LICENSE`、`.claude-plugin/*`、`.codex-plugin/plugin.json`、`thoth/projections.py`，并清理 `.agent-os/` 中的公开风险内容
  - Next likely action: 完成验证、将公开化清理同步到 `main`，并刷新本机插件安装

- 2026-04-24 08:34 UTC [canonical upstream migration]
  - Worked on: `OBJ-001`, `WS-003`
  - State changes: canonical upstream、README 与插件元数据统一到 `SeeleAI/Thoth`
  - Evidence produced: `README.md`、`thoth/projections.py`、`.codex-plugin/plugin.json`
  - Next likely action: 继续收口公开元数据与开源发布面
