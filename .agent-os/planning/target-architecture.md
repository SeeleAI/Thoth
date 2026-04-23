# Target Architecture Contract

## Purpose

本文件承接 `/tmp/thoth-planning-20260422T152336Z/02-synthesized-architecture.md`，并补充其与当前 `thoth` 仓库状态的对照关系。它描述的是 `Thoth V2` 的目标架构合同，不代表当前 repo 已完全实现。

## 1. Runtime Ownership

Thoth 拥有控制平面。

- Thoth 是 loop orchestrator 和 project operating system
- 外部 Codex 是 worker
- 委派边界是“每轮”或“显式子任务”
- Thoth 负责：
  - task selection
  - iteration counting
  - acceptance / guard execution
  - keep / discard / rework decisions
  - pause / resume
  - merge gate
  - run logging
  - callback / dashboard state

### Current repo gap

当前仓库已经在公共产品面上把 Codex 收敛为 executor mode，但尚未实现真正的 `.thoth` authority runtime 和 per-run supervisor。

## 2. Truth Model

运行时真相模型已经锁定为：

1. `.thoth/` repo authority
2. local runtime registry for pid / lock / socket / cache
3. SQLite 作为 dashboard / query derived index

选择原因：

- traceability
- cross-session recovery
- Git friendliness
- host/runtime decoupling

### Current repo gap

当前 repo 仍主要是 Claude plugin 代码仓，尚未落成 `.thoth/` canonical runtime tree。

## 3. Durable Versus Unbounded

- `durable`: 生命周期不依赖当前 Claude session
- `unbounded`: 终止语义是无限轮直到通过严格 acceptance
- `--unbounded` 必须蕴含 `--durable`

Unbounded stop rule:

- 只有 acceptance script 连续两次通过才停止

Unbounded stall rule:

- 达到 plateau / no-progress / repetition 阈值后暂停，而不是盲目继续

### Current repo gap

当前命令面可以表达 executor 选择，但 durable/unbounded 的真正 runtime 语义还没有以 supervisor + ledger + lease 的方式落地。

## 4. Durable Runtime Model

第一阶段目标：

- 同机可靠优先
- Linux/POSIX 优先
- 每个 run 一个 supervisor process

Cross-session behavior:

- 旧 session 不是 authority
- 新 session 通过 `.thoth/` 读取状态并 attach
- attach 会转移 control lease

默认 callback 风格：

- 关键状态回调
- 不做每轮噪声级刷屏

## 5. Git And Worktree Model

### Isolation

- workers 在隔离 worktrees 中写

### Safety

- main worktree 禁止 destructive recovery

### Integration line

- 当前工作分支即 integration branch

### Acceptance to merge

- accepted-ready 自动进入更严格的 merge stage
- Thoth 默认尝试 rebase / merge / conflict resolution
- 只有 major blockers 才暂停

### Cleanup

- merge 完成前不删 worktree
- 已 merge 且稳定的 run 分支 / worktree 自动清理
- paused / blocked worktree 保留作恢复

### Loop locking

- 默认主 loop 冲突域是 `repo root + worktree path`
- submodule / child repo 视为独立 git scope

## 6. Init / Resume / Adopt Redesign

`/thoth:init` 保持统一入口，但目标语义已改为：

- 检测仓库是否为空、部分结构化、或已是 Thoth 项目
- 先 audit
- 尽量 infer 现有结构与文档
- 产出 preview
- 仅对高影响未决点提问
- 用户确认后 apply
- migration 失败时支持 rollback

### Current repo gap

当前模板和脚手架仍偏初始化导向，尚未等价于该 adopt/init 目标行为。

## 7. File And Source-of-Truth Layout

### Canonical machine source

- `.thoth/`

### Chosen top-level shape

- `project/`
- `runs/`
- `migrations/`
- `derived/`

### Human governance layer

- `.agent-os/`

### Instruction projections

- `CLAUDE.md`
- `AGENTS.md`

### Source model

- 指令源在 `.thoth/` 隐藏 canonical source
- 顶层只保留 discovery / compatibility thin entrypoints

## 8. Internal Versus Public Surface

### Public surface

- 保留当前主要 verbs
- `discuss` 保持一等命令
- dashboard 仍是核心能力

### Internal surface

- 默认隐藏内部 machinery
- internal skills / agents / monitors 是 runtime implementation detail
- worker selection 应更偏 `--worker codex` / `--executor codex` 这样的 flag，而不是扩充公开子命令树

### Current repo alignment

当前 repo 已完成一个关键产品化收敛：

- 去掉公开内部 skills
- 去掉公开 `:codex` 变体
- 保持显式 `/thoth:*`
- 用 executor mode 表达 Codex

## 9. Acceptance Contract

Acceptance 必须是全机械的。

最少要求：

- script 返回 exit code + structured JSON
- JSON 含：
  - pass / fail
  - score 或关键 metrics
  - failure reason / explanation
  - evidence paths 或 evidence summary
  - 足够支撑 dashboard / report rendering 的字段
  - 足够支撑 consecutive-pass 逻辑的状态

关键原则：

- agent narrative 永远不算 acceptance
- acceptance 比 guard / health 更严格，二者不应被随意揉成一个宽松 schema

## 10. Test Philosophy

该重构的测试姿态已经锁定：

- full-stack balanced coverage
- unit + integration + black-box runtime tests
- detached supervisor tests allowed
- temporary repos and worktrees allowed
- durable recovery chains should be tested for real
- CI 应被正式化

## 11. Durable Run Protocol Shape

Durable run 采用：

- 少量 canonical state files
- append-only event stream

目标效果：

- 快速恢复时只读少量关键状态文件
- 深度审计时读取完整事件流
- 不要求所有日常操作都做纯 event replay

Lease model:

- live lease authority 在 machine-local registry
- repo run data 只记录 durable lease summary

## 12. Current Repo To Target Repo Delta

### Already aligned

- 公共命令命名收敛为 `/thoth:*`
- Codex 作为 executor / worker，而非公开子命令面
- `.agent-os/` 已作为 repo 内治理层存在
- 测试护栏已经存在

### Not yet implemented

- `.thoth/` canonical authority tree
- per-run durable supervisor
- repo-native run ledger
- machine-local lease registry
- preview/apply/rollback style adopt/init
- attach / takeover / resume / stop / watch lifecycle protocol
- derived SQLite/query/dashboard contract built from `.thoth`

## 13. Design Guardrails

未来所有 V2 实现都必须继续满足：

- 极简四树布局，不引入多套平级 canonical source
- repo ledger 为 authority，不反客为主到 SQLite
- 控制权归 Thoth，不外包给 worker
- adoption 先审计再标准化，不静默覆盖
- durable 和 unbounded 明确区分，且 `unbounded -> durable`
- acceptance 机械化，不能靠口头报告
