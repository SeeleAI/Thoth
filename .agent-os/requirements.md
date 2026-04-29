# Requirements

## Goals

- `OBJ-001`: 把 `Thoth` 做成一个公开、可恢复、可验证的 Agent Project OS：
  - 当前阶段提供可发布的 Claude Code / Codex 双宿主插件
  - 后续继续向 `.thoth` authority runtime 收敛

## Requirements

- `REQ-001`: `dev` 分支必须保留完整的项目状态文档系统，根路径包含 `AGENTS.md`、`CLAUDE.md` 和 `.agent-os/`。
- `REQ-002`: 项目状态必须可从仓库文档恢复，不能依赖聊天记录。
- `REQ-003`: 当前 checkout 的实现事实必须与未来目标架构清晰区分。
- `REQ-004`: `main` 分支不保留 `AGENTS.md`、`CLAUDE.md`、`.agent-os/` 等动态开发态文档。
- `REQ-005`: `dev -> main` 的默认集成策略是 `cherry-pick`。
- `REQ-006`: 当前插件公开 surface 必须保持干净：只暴露真正的 `/thoth:*` 公共命令与单一 `$thoth <command>` 公共入口。
- `REQ-007`: 公开仓库不保留私人本地路径、个人敏感信息或无运行必要的外部项目来源链。
- `REQ-013`: 对 `Codex` / `Claude Code` 特性、运行机制和产品限制的长期文档化，必须以官方 docs 为 authority，并受 freshness policy 约束。
- `REQ-014`: dashboard 监控长时运行时，必须采用 `task-first UI + run-ledger truth` 模型。
- `REQ-017`: 仓库必须具备可机械化执行的原子化自测试系统；公开 selftest 入口必须按 case registry 工作，且单个 case 不得依赖前一个 case 的副作用。
- `REQ-018`: `/thoth:init` 不能假设目标仓库为空；必须先审计当前 repo 状态，再以 audit-first adopt/init 流程补齐 Thoth 架构。
- `REQ-019`: 任何新功能开发都必须同时兼顾 `Claude Code` 与 `Codex` 两个宿主面。
- `REQ-020`: 每次开发完成后，必须按仓库治理约束完成：`dev` 验证、发布代码集成到 `main`、push `dev` 与 `main`、更新本机插件安装。
- `REQ-021`: 仓库级 pytest 默认必须是 targeted-only：只允许显式 file/nodeid 或 `--thoth-target`；broad/full runs 只有在显式豁免时才允许。
- `REQ-022`: 本轮重构的首要目标是在不丢失既有功能、不违反既有治理边界、不放松既有验收语义的前提下，显著简化 Thoth 的整体实现，删除冗余设计、重复包装和工程上不优雅的实现。
- `REQ-023`: Thoth 必须有一套独立于当前代码目录结构的高维分层架构定义；每一层的职责、允许依赖方向、输入输出协议和 authority 边界都必须清晰、稳定、可解释。
- `REQ-024`: 层与层之间传递的协议和数据必须高度确定：同一语义只能有一个 canonical shape；host 适配、dashboard 读面、worker 执行、validator/selftest 都必须围绕同一 authority 数据模型运转。
- `REQ-025`: 发布门、关闭门与回归门必须以显式 selftest case 列表和显式 pytest target/file 列表记账，不再以 `hard` / `heavy` 或 `light` / `medium` / `heavy` 作为默认公共验证语义。
- `REQ-026`: 结果模型固定为 `RunResult + work-level current result` 双层：单次尝试详细结果写入 `.thoth/runs/<run_id>/result.json` 与 `run` / `phase_result` objects，work 当前结论作为 `.thoth/docs/work-results/<work_id>.result.json` 只读派生视图，并可由 `sync` 按 canonical run/object 历史重建。
- `REQ-027`: `Observe` 读面必须保持纯读；`status`、`doctor`、`dashboard`、`report`、hooks、validators/read-model 不得偷偷修 authority。`review` 的 public contract 固定为 live-only，不提供 `--sleep`。
- `REQ-028`: 旧的内部主路径 `thoth/runtime.py`、`thoth/task_contracts.py`、`thoth/project_init.py`、`thoth/claude_bridge.py`、`thoth/host_hooks.py` 不得继续保留为实现主入口；主实现必须集中到 `thoth/surface`、`thoth/plan`、`thoth/run`、`thoth/init`、`thoth/observe`。
- `REQ-029`: 仓库必须提供固定 target manifest 与 changed-path 推荐入口，用于把改动路径翻译成精确 pytest targets 和 selftest cases。
- `REQ-030`: `.thoth` authority 必须收敛为统一对象图：canonical storage 固定为 `.thoth/objects/<kind>/<object_id>.json`，所有 authority 写入必须经过 `Store` API；`.agent-os`、`.thoth/project/contracts`、`.thoth/project/tasks` 与 dashboard SQLite 不得再作为平行 authority。
- `REQ-031`: `Contract` 不再是长期对象 kind；goal、context、constraints、execution plan、eval contract、runtime policy 与 decisions 必须嵌入 `work_item.payload`。`work_item` 统一 milestone/task，其中只有 `work_type=task` 且 `runnable=true` 的 `ready` work item 可以被执行。
- `REQ-032`: `run` 是最小执行单元，必须固定绑定 `work_id@revision`；`loop`、`orchestration`、`auto` 属于 controller service，不得把多轮、DAG 或 queue 语义塞回 `run`。
- `REQ-033`: 被 active run/controller 引用的 work item 必须完全锁定；任何 update/tombstone/link mutation 都必须失败，直到 active execution terminal。
- `REQ-034`: 本机 Claude Code / Codex 的 Thoth 安装刷新必须只走远端 marketplace upgrade/update；不得用本机 checkout、cache、临时目录、`rsync` 或其他本地覆盖方式兜底。远端刷新失败时只能记录 blocker 与真实输出。

## Acceptance Criteria

- `AC-001`: 仓库根存在 `AGENTS.md` 与 `CLAUDE.md`。
- `AC-002`: `.agent-os/` 中存在完整状态文档集。
- `AC-003`: `project-index.md` 中始终存在唯一 top next action。
- `AC-004`: 文档明确记录 `dev` 与 `main` 的边界，以及 `cherry-pick` 为默认集成策略。
- `AC-005`: 文档准确描述当前插件代码面：
  - 当前公开命令包括 Claude `/thoth:*` 与 Codex `$thoth <command>`
  - Claude 侧 `--executor codex` 继续存在
  - 当前已实现最小 `.thoth` authority tree 与基础 durable runtime / dashboard run-ledger 读面
- `AC-006`: `architecture-milestones.md` 中明确分开“当前实现结构”与“目标 V2 架构”。
- `AC-007`: `.agent-os/official-sources/` 中存在平台真源治理文档。
- `AC-008`: `/thoth:init` 生成的项目包含最小 `.thoth/` authority tree；dashboard backend 能读取 `.thoth/runs/*`。
- `AC-009`: `python -m thoth.selftest` 的公开接口只接受显式 `--case` 列表；无 `--case` 时会失败并输出可用 case catalog 与推荐用法；结果报告按 `selected_cases` 与 `results[case_id]` 记账。
- `AC-010`: `/thoth:init` 能在空白 repo、漂移 repo 和已有 `.thoth` / `.agent-os` 的 repo 上执行 audit-first adopt/init。
- `AC-011`: `/thoth:init` 每次执行都会写出 migration ledger 和 `.thoth/docs/source-map.json`。
- `AC-012`: `AGENTS.md` 中明确要求新功能同步兼顾 Claude Code 与 Codex，并按固定流程收尾。
- `AC-013`: 仓库提供可执行的 pytest targeted 选择器：显式 file/nodeid 与 `--thoth-target` 默认允许；裸 `pytest`、目录级 `pytest` 与 `--thoth-tier` broad runs 默认失败；只有 `--thoth-allow-broad` 或 `THOTH_ALLOW_BROAD_TESTS=1` 时才允许 broad sweeps。
- `AC-014`: 文档中明确写出本轮认可的 Thoth 高维分层架构，且区分“层”与“代码目录”；每层都具备清晰职责说明和层间协议说明。
- `AC-015`: `run` / `loop` / `review` / dashboard / selftest / host projections 共享同一 authority 数据模型，不再依赖多套平行 shape 或隐式宿主状态。
- `AC-016`: 本轮结束时必须具有真实证据证明 repo-local atomic selftest matrix 可独立通过，且至少一组显式 target 的 pytest 命令可通过；同时 `python -m thoth.selftest` 无 `--case` 与裸 `pytest` 默认失败，并按分支治理完成 `dev` 验证与状态记账。
- `AC-017`: 当前代码与文档明确共享同一 run ledger canonical 形态：`.thoth/runs/<run_id>/run.json`、`state.json`、`events.jsonl`、`result.json`、`artifacts.json`。
- `AC-018`: 当前代码与文档明确共享同一 work 当前态读视图：`.thoth/docs/work-results/<work_id>.result.json` 作为可重建 current-result view，`status` / `report` / `dashboard` 读当前结论时优先从对象图和该派生视图消费，`sync` 能按 run/object 历史重建它。
- `AC-019`: `review` 明确为 live-only；`loop` 只允许消费同 `task_id + target` 且时间晚于 `work_result.last_closure_at` 的 review findings。
- `AC-020`: 当前仓库文档准确反映新的 canonical 包级骨架：`thoth/surface`、`thoth/plan`、`thoth/run`、`thoth/init`、`thoth/observe`，且不再把已删除的旧顶层内部模块描述成主实现。
- `AC-021`: 仓库提供 `thoth/test_targets.py` target manifest 与 `scripts/recommend_tests.py` changed-path 推荐入口，能生成精确 pytest/selftest 建议命令。
- `AC-022`: `Store` 覆盖 create/read/update/tombstone/list/link/unlink、revision conflict、active work lock、schema failure 与 invalid link target；核心对象 kinds 至少覆盖 `project`、`discussion`、`decision`、`work_item`、`controller`、`run`、`phase_result`、`artifact`、`doc_view`。
- `AC-023`: public `run` / `loop` / `review` 接口使用 `--work-id`；缺少 `--work-id` 时只能返回现有 work item 候选并停止，不允许创建 work item 或触碰代码。
- `AC-024`: selftest case registry 包含并可执行 `discuss.subtree.close`、`run.phase_contract`、`run.locked_work`、`loop.controller`、`orchestration.controller`、`auto.queue`、`observe.object_graph`。
- `AC-025`: 本轮关闭门只包含核心五项 selftest：`discuss.subtree.close`、`run.phase_contract`、`run.locked_work`、`loop.controller`、`observe.object_graph`；`auto` / `orchestration` 保留 public surface 与现有测试覆盖，但不作为本轮 runtime kernel 关闭门。

## Non-Goals

- 不把当前仓库描述成已完整实现 `Thoth V2`。
- 不在本次状态文档中保存历史私有路径、私人环境细节或外部项目背景。
- 不把 `main` 的隔离机制错误描述成已经完全自动化。
- 不把“更少代码”本身当成目标；本轮追求的是在保持语义和验收不变时的更清晰抽象、更少冗余源和更确定的协议。

## Hard Constraints

- `REQ-008`: 项目状态文档主语言为中文。
- `REQ-009`: 代码注释与脚本 `print` 输出保持英文。
- `REQ-010`: 没有证据不得宣称“完成”“验证通过”或“V2 已实现”。
- `REQ-011`: 面向 `main` 的代码集成默认只允许 `cherry-pick`。

## Source Note

本文件保存用户定义的目标、治理边界和验收语义。允许精简公开表述，但不允许私自改变含义。
