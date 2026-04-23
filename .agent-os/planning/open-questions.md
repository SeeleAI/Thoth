# Open Questions For V2

## Purpose

本文件承接 `/tmp/thoth-planning-20260422T152336Z/03-open-schema-questions.md`。这些问题不是“尚未思考”，而是已经高度收敛到只剩最后的协议级细化。它们仍会实质影响实现，因此必须继续保留。

## Question Register

### `OQ-001` Four-tree `.thoth/` exact file map

- Locked:
  - `.thoth/project/`
  - `.thoth/runs/`
  - `.thoth/migrations/`
  - `.thoth/derived/`
- Still open:
  - 每棵树下的 canonical filenames
  - 哪些文件应 git-tracked
  - 哪些仅是 runtime mutable state
  - 顶层是否保留少量 compatibility pointers
- Mapped work:
  - `TD-003`
  - `TD-006`

### `OQ-002` Durable run canonical file map

- Candidate files:
  - `run.json`
  - `events.jsonl`
  - `state.json`
  - `heartbeat.json`
  - `pause.json`
  - `acceptance.json`
  - `artifacts.json`
  - `merge.json`
  - `worker.json`
- Still open:
  - 最小必需文件集
  - `run.json` 与 `state.json` 是否都需要
  - recovery / dashboard 渲染的最小字段集
  - 哪些是 checkpoint，哪些是 live state
- Mapped work:
  - `TD-003`

### `OQ-003` Local runtime registry protocol

- Must support:
  - pid tracking
  - lock ownership
  - attach lease transfer
  - supervisor socket / channel refs
  - crash detection
  - stale lock cleanup
- Still open:
  - location
  - file format
  - stale-instance detection rules
  - 如何把 lease summary 投影回 repo state
- Mapped work:
  - `TD-003`

### `OQ-004` Acceptance JSON schema

- Already locked:
  - mechanical
  - exit code + structured JSON
  - must include pass/fail, score or key metrics, reason, evidence
- Still open:
  - exact field names
  - richer evidence mode 与 threshold mode 的统一方式
  - guard 是否复用其中子集
- Mapped work:
  - `TD-003`

### `OQ-005` Attach / lease / takeover protocol

- Need exact protocol for:
  - observe
  - attach
  - takeover
  - stale lease expiry
- Already locked:
  - attach 默认意味着 takeover
  - takeover 基于 lease transfer
  - 接管后的新 session 可改变策略
- Still open:
  - lease TTL
  - forced takeover
  - stale-session reclamation
  - 与仍存活旧 session 的交互
- Mapped work:
  - `TD-003`

### `OQ-006` Preview / migration diff schema

- Already locked:
  - preview mandatory
  - audit first, then itemized questioning
  - migration rollback-capable
- Still open:
  - conflict classes
  - patch proposal format
  - preview 是否写入 `.thoth/migrations/`
- Mapped work:
  - `TD-005`

### `OQ-007` `loop` lifecycle surface

- Already locked:
  - 主要 lifecycle controls 挂在 `loop`
- Still open:
  - `loop --status`
  - `loop --attach`
  - `loop --resume`
  - `loop --stop`
  - `loop --watch`
  - 是否保留轻量 listing alias
- Mapped work:
  - `TD-003`

### `OQ-008` Merge stage protocol

- Already locked:
  - accepted-ready 自动进入严格 merge stage
  - 当前工作分支是 integration line
  - merge 完成前不能删 worktree
- Still open:
  - “major blocker” 的精确定义
  - rebase / conflict resolution / re-validation / final transition 的顺序
- Mapped work:
  - `TD-003`

### `OQ-009` Dashboard data contract

- Already locked:
  - dashboard remains core
  - SQLite is derived
- Still open:
  - `.thoth/runs/*` 到 dashboard query models 的精确映射
  - 是否维持旧 task/project panels backward compatibility
  - durable run control 是否进入 v1 还是 v1.1
- Mapped work:
  - `TD-003`

### `OQ-010` Migration of current legacy Thoth layout

- Need exact mapping from current layout into V2:
  - `.research-config.yaml`
  - `.agent-os/`
  - `tools/dashboard/`
  - `scripts/`
  - `tests/`
  - `CLAUDE.md`
  - plugin templates and generation logic
- Why high priority:
  - single-source-of-truth convergence depends on it
- Mapped work:
  - `TD-005`
  - `TD-006`

## Priority Interpretation

这些开放问题里，最应先推进的是：

1. `OQ-001`
2. `OQ-002`
3. `OQ-004`
4. `OQ-010`

原因：

- 它们直接决定 `.thoth` 的 canonical layout
- 会反向约束 runtime、dashboard、migration 和 adopt/init 的协议

## Relationship To Current TODOs

- `TD-003`: 把 V2 规划材料整理成 decision-complete 的迁移主线
- `TD-005`: current `scripts/init.py` 与 audit-first adopt/init 的差距清单
- `TD-006`: 当前 repo 结构到未来 `.thoth` layout 的迁移映射

因此，本文件不是独立 backlog，而是 `WS-002` 的高信息量问题池。
