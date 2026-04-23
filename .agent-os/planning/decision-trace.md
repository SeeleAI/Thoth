# Planning Decision Trace

## Snapshot Scope

本文件吸收：

- `/tmp/thoth-planning-20260422T152336Z/00-index.md`
- `/tmp/thoth-planning-20260422T152336Z/01-decision-rounds.md`

它保存的不是最终简版结论，而是“为什么做出这些架构选择”的逐轮轨迹。

原快照范围：

- safe-init / resume / adopt redesign
- single-source-of-truth migration into `.thoth/`
- durable and unbounded loop runtime
- Codex worker delegation versus Thoth-owned control plane
- worktree, branch, merge, acceptance, and callback semantics
- dashboard, commands, hidden internal machinery, and test strategy

## Decision Rounds

### Round 1: High-level control and adoption posture

- `/thoth:init` 默认策略: `先审计后补丁`
- `run` / `loop` 控制面归属: 推荐 `Thoth 主控`
- 长运行态 authority 层: `Repo ledger 为权威，SQLite 只作派生索引/缓存`

直接后果：

- `init` 不能无审计地删除或覆盖现有项目内容
- Codex 不能拥有控制平面，只能做 worker
- repo-native ledger 必须成为核心真相来源

### Round 2: Long loop and adoption scope

- `run_truth_model`: `Repo ledger 为权威，SQLite 只作派生索引/缓存`
- `adoption_scope`: `标准化接管`
- `loop_execution_boundary`: `按轮委托`

直接后果：

- 外部 worker 可以做单轮或显式子任务
- Thoth 负责 orchestration、验证、暂停恢复、日志和合并语义

### Round 3: Existing docs, isolation, and pause semantics

- `legacy_doc_adoption`: `抽取并映射`
- `mutation_isolation`: `独立 worktree/分支`
- `pause_resume_policy`: `持久化暂停点`

直接后果：

- 既有 README/docs/AGENTS 不能被忽略，必须被吸收进标准层
- 暂停状态必须留下 durable recovery artifacts

### Round 4: Autonomy, session recovery, Git red lines

- `autonomy_gate`: `循环内自治，合并前关口`
- `session_recovery_behavior`: `自动发现并给恢复卡片`
- `git_recovery_policy`: `主工作树禁破坏式恢复`

直接后果：

- 循环可自治，但最终合并必须受控
- SessionStart 需要主动恢复提示
- main worktree 不允许 destructive recovery

### Round 5: Command surface, unbounded semantics, notifications

- `init_command_surface`: 保留统一 `/thoth:init`
- `unbounded_loop_policy`: 仅显式 `--unbounded`
- `background_notification_mode`: `持久账本 + 主动提示`

补充用户约束：

- 默认 loop 必须有最大迭代数
- `--unbounded` 才开启无限轮
- 只有 acceptance script 连续两次通过才可停机

### Round 6: Instruction files, internal machinery, unbounded stall semantics

- `project_instruction_file`: `双文件强同步`
- `internal_surface_visibility`: `默认隐藏内部层`
- `unbounded_stall_policy`: `收敛停表并暂停`

关键澄清：

- Claude background/subagent 能做 session-local 工作
- 但跨 session、长寿命 durable runtime 不能只靠宿主原语

### Round 7: Cross-session durability and acceptance interface

- `cross_session_runtime`: `跨 session 持续`
- `loop_concurrency`: `每 repo 一条主 loop`
- `callback_granularity`: `关键状态回调`

直接后果：

- session 是 client，不是 runtime 本体
- 新 session 需要通过 `.thoth/` 重新 attach

### Round 8: Machine scope, local registry, acceptance contract

- `runtime_machine_scope`: `先同机可靠`
- `local_runtime_registry`: `允许，且做派生层`
- `acceptance_script_contract`: `结构化 JSON + 退出码`

铁律：

- acceptance 必须是机械的
- 代理口头汇报不算 acceptance

### Round 9: Namespace layout, durable runner form, control surface

- `project_namespace_layout`: `人机分层`
- `durable_runner_shape`: `每 run 一个监督进程`
- `run_control_surface`: `保留 status，补 runs/attach/resume/stop`

关键澄清：

- `durable` 是生命周期独立性
- `unbounded` 是终止语义
- 建议 `unbounded -> durable`

### Round 10: Unbounded implication, loop collision, worktree cleanup

- `unbounded_implies_durable`: yes
- `active_loop_collision_policy`: 默认拒绝并引导 `attach/status`
- 次级 loop 仅在用户明确要求时才允许，并应使用新 worktree

工作树清理原则：

- 不能只看 acceptance
- 必须等冲突解决且真正 merge 到目标树后再清理

### Round 11: Lock granularity, accepted worktree retention, config entrypoint

- `loop_lock_granularity`: `repo root + worktree path`
- `accepted_worktree_retention`: `未合并不删`
- `config_entrypoint_layout`: `顶层薄入口 + .thoth 真配置`

### Round 12: Merge gate, monitor activation, legacy migration compatibility

- `merge_gate_semantics`: `自动严格关口`
- `monitor_activation_policy`: `按需激活`
- `legacy_layout_compat`: `强制迁移`

含义：

- accepted-ready 后默认进入自动化 merge stage
- 不是“先问用户能不能 merge”

### Round 13: Single source of truth

- `instruction_sot`: `.thoth/` 隐藏 canonical source，生成 `CLAUDE.md` 与 `AGENTS.md`
- `config_sot`: canonical config under `.thoth/`
- `acceptance_json_richness`: 需要足够支撑 dashboard 与 consecutive-pass stopping

### Round 14: Adopt/resume inference and traceability

- `adopt_inference_policy`: 尽可能从现有 repo 推断
- `conflict_presentation`: 后被澄清为“先总审计，再逐项追问”
- `migration_traceability`: `只保留关键来源`

并且用户明确要求：

- 整个插件重构必须有严格有效的 unit tests

### Round 15: Audit rhythm, compatibility tolerance, testing priority

- `audit_interaction_rhythm`: `先总审计，再逐项追问`
- `breaking_change_tolerance`: 接受硬收敛/重构
- `test_priority_stack`: `全链路平衡`

用户再次强调：

- 设计必须 `断舍离`
- 不要保留“安全网版本”的冗余架构

### Round 16: Command surface and dashboard retention

- `command_verb_preservation`: 整体保留当前 verb set
- `discuss_mode_retention`: `/thoth:discuss` 保留为一等命令
- `dashboard_information_arch`: dashboard 大体保留，允许中度 IA 调整

### Round 17: Dependencies, real detached tests, platform scope

- `dependency_policy`: result-first
- `detached_runner_testing`: 接受真实 detached black-box tests
- `platform_scope`: Linux/POSIX first

### Round 18: Git tracking, merge strategy, iteration commit granularity

- `thoth_git_tracking_model`: 最初回答 `几乎全跟踪`
- `worktree_merge_strategy`: `先 rebase/整理，再语义化合入`
- `iteration_commit_granularity`: `每轮有提交，合入前可整理`

后续修正：

- 高频 runtime state 不能一股脑地进 Git history

### Round 19: Runtime commit cadence, heartbeat persistence, artifact policy

- `runtime_commit_cadence`: 只在关键 checkpoint commit
- `heartbeat_persistence_mode`: heartbeat 可查询，但不按 tick 入 Git
- `artifact_tracking_policy`: Git 记录路径/摘要/小证据，大工件外部索引

### Round 20: Merge target, human concurrent edits, auto-install

- `merge_target_policy`: 初始答案是 `先合到集成分支`
- `human_edit_conflict_policy`: `自动吸收继续`
- `auto_install_policy`: `一键全自动`

后续澄清：

- “集成分支”最终被解释为“当前工作分支”

### Round 21: Branch model, attach semantics, branch cleanup

- `integration_branch_model`: `沿用当前工作分支`
- `attach_control_mode`: `attach 即接管`
- `branch_cleanup_policy`: stable merge + evidence capture 之后自动清理

### Round 22: Branch and attach disambiguation

- `branch_target_disambiguation`: 当前工作分支就是 integration line
- `attach_lease_transfer`: 租约转移
- `attach_strategy_mutation`: 新 session 接管后可调整策略、预算与 worker 配置

### Round 23: Dry-run, rollback, CI

- `migration_dry_run`: preview mandatory
- `migration_rollback_contract`: migration 必须可回滚
- `ci_expectation`: 重构过程中应正式补上 CI

### Round 24: `.thoth/` canonical layout, run file protocol, lifecycle surface

- `thoth_canonical_layout`: `四树极简`
- `durable_run_file_protocol`: `状态文件 + 事件流`
- `run_lifecycle_surface`: 生命周期操作主要收进 `loop`

由此锁定：

- `.thoth/project/`
- `.thoth/runs/`
- `.thoth/migrations/`
- `.thoth/derived/`

### Round 25: `project/` shape, lease authority, acceptance-versus-guard schema

- `project_tree_shape`: `单清单主导`
- `lease_authority_model`: `本机 registry 权威，repo 记摘要`
- `acceptance_guard_schema_relation`: `acceptance 单独 schema`

## Stable Architecture Picture After The Rounds

经过 25 轮后，稳定架构图景已经明确：

- 公共 verbs 整体保留
- 内部 skills/agents/monitors 默认隐藏
- `.thoth/` 是机器真相层
- `.agent-os/` 是人类治理层
- `AGENTS.md` / `CLAUDE.md` 是同步投影
- `/thoth:init` 变成安全的 audit-first init/resume/adopt 入口
- 普通 session-local 背景任务可用宿主原语
- durable/unbounded loops 必须由 Thoth 自己的 supervisor runtime 支撑
- repo ledger 是 authority
- SQLite 仅是派生索引
- Codex 是外部 worker，不是控制面
- accepted results 自动进入严格 merge stage
- main worktree 受保护
- 测试必须覆盖真实 detached runtime 行为

## Why This File Exists

如果只读最终 summary，很容易看不到很多关键边界是如何被用户明确拍板的。本文件保留这些轨迹，是为了避免后续代理重新发明一套“看起来合理但违背原决策”的设计。
