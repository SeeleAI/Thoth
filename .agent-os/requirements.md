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
- `REQ-017`: 仓库必须具备可机械化执行的重型自测试系统。
- `REQ-018`: `/thoth:init` 不能假设目标仓库为空；必须先审计当前 repo 状态，再以 audit-first adopt/init 流程补齐 Thoth 架构。
- `REQ-019`: 任何新功能开发都必须同时兼顾 `Claude Code` 与 `Codex` 两个宿主面。
- `REQ-020`: 每次开发完成后，必须按仓库治理约束完成：`dev` 验证、发布代码集成到 `main`、push `dev` 与 `main`、更新本机插件安装。
- `REQ-021`: 仓库级 pytest 必须支持 `light` / `medium` / `heavy` 三层开发验证语义，并明确对应的推荐使用场景与时长预算。
- `REQ-022`: 本轮重构的首要目标是在不丢失既有功能、不违反既有治理边界、不放松既有验收语义的前提下，显著简化 Thoth 的整体实现，删除冗余设计、重复包装和工程上不优雅的实现。
- `REQ-023`: Thoth 必须有一套独立于当前代码目录结构的高维分层架构定义；每一层的职责、允许依赖方向、输入输出协议和 authority 边界都必须清晰、稳定、可解释。
- `REQ-024`: 层与层之间传递的协议和数据必须高度确定：同一语义只能有一个 canonical shape；host 适配、dashboard 读面、worker 执行、validator/selftest 都必须围绕同一 authority 数据模型运转。
- `REQ-025`: 本轮工作只有在 `heavy` 双宿主 public-command conformance gate 真实通过后才算完成；该 gate 只验证真实宿主下的 Thoth 公共命令协议，不以 agent 业务开发成功作为关闭门语义。
- `REQ-026`: 结果模型固定为 `RunResult + TaskResult` 双层：单次尝试详细结果写入 `.thoth/runs/<run_id>/result.json`，task 当前结论写入 `.thoth/project/tasks/<task_id>.result.json`，并可由 `sync` 按 canonical run 历史重建。
- `REQ-027`: `Observe` 读面必须保持纯读；`status`、`doctor`、`dashboard`、`report`、hooks、validators/read-model 不得偷偷修 authority。`review` 的 public contract 固定为 live-only，不提供 `--sleep`。
- `REQ-028`: 旧的内部主路径 `thoth/runtime.py`、`thoth/task_contracts.py`、`thoth/project_init.py`、`thoth/claude_bridge.py`、`thoth/host_hooks.py` 不得继续保留为实现主入口；主实现必须集中到 `thoth/surface`、`thoth/plan`、`thoth/run`、`thoth/init`、`thoth/observe`。

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
- `AC-009`: 仓库提供单一自测试入口并形成双层门槛：`hard` 为默认 repo-real mechanical gate，`heavy` 为双宿主 headless host-real public-command conformance gate。
- `AC-010`: `/thoth:init` 能在空白 repo、漂移 repo 和已有 `.thoth` / `.agent-os` 的 repo 上执行 audit-first adopt/init。
- `AC-011`: `/thoth:init` 每次执行都会写出 migration ledger 和 `.thoth/project/source-map.json`。
- `AC-012`: `AGENTS.md` 中明确要求新功能同步兼顾 Claude Code 与 Codex，并按固定流程收尾。
- `AC-013`: 仓库提供可执行的 pytest 三层选择器：`light` 目标 `20s` 内，`medium` 目标 `2` 分钟内并包含 `light`，`heavy` 为全量回归。
- `AC-014`: 文档中明确写出本轮认可的 Thoth 高维分层架构，且区分“层”与“代码目录”；每层都具备清晰职责说明和层间协议说明。
- `AC-015`: `run` / `loop` / `review` / dashboard / selftest / host projections 共享同一 authority 数据模型，不再依赖多套平行 shape 或隐式宿主状态。
- `AC-016`: 本轮结束时必须具有真实证据证明 `heavy` 双宿主命令协议 gate 通过，且 `hard` 仍可独立通过，并按分支治理完成 `dev` 验证、发布代码集成、双分支 push 与本机安装更新。
- `AC-017`: 当前代码与文档明确共享同一 run ledger canonical 形态：`.thoth/runs/<run_id>/run.json`、`state.json`、`events.jsonl`、`result.json`、`artifacts.json`。
- `AC-018`: 当前代码与文档明确共享同一 task 当前态模型：`.thoth/project/tasks/<task_id>.result.json` 作为 `TaskResult`，`status` / `report` / `dashboard` 读当前结论时优先消费它，`sync` 能按 run 历史重建它。
- `AC-019`: `review` 明确为 live-only；`loop` 只允许消费同 `task_id + target` 且时间晚于 `TaskResult.last_closure_at` 的 review findings。
- `AC-020`: 当前仓库文档准确反映新的 canonical 包级骨架：`thoth/surface`、`thoth/plan`、`thoth/run`、`thoth/init`、`thoth/observe`，且不再把已删除的旧顶层内部模块描述成主实现。

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
