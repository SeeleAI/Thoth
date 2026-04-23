# Requirements

## Goals

- `OBJ-001`: 把 `Thoth` 做成一个面向研究与工程流程的 Agent Project OS。当前阶段在本仓库中要同时满足两件事：
  - 让现有 Claude-hosted plugin 代码仓可恢复、可审计、可持续开发
  - 为未来 `Thoth V2` / `.thoth` authority / durable runtime 提供真实、可追踪的收敛路线

## Requirements

- `REQ-001`: `dev` 分支必须拥有完整的项目状态文档系统，根路径包含 `AGENTS.md`、`CLAUDE.md` 和 `.agent-os/`。
- `REQ-002`: 项目状态必须可从仓库文档恢复，不能依赖原始聊天记录。
- `REQ-003`: 当前 checkout 的实现事实必须与未来目标架构清晰区分，不能把未实现的 V2 能力写成当前事实。
- `REQ-004`: `main` 分支不保留 `AGENTS.md`、`CLAUDE.md`、`.agent-os/` 等动态开发态文档。
- `REQ-005`: `dev -> main` 的默认集成策略是 `cherry-pick` 代码提交，而不是直接 merge 整个 `dev` 分支。
- `REQ-015`: 所有默认开发工作必须在 `dev` 分支进行；`dev` 是唯一日常开发分支。
- `REQ-016`: 未经用户明确批准，不允许直接修改 `main` 分支上的 repo-tracked 代码或文档。
- `REQ-006`: 当前插件的公开 surface 必须保持干净：只暴露真正的 `/thoth:*` 公共命令，不暴露内部协议层或公开 `:codex` 变体。
- `REQ-007`: 项目必须对失败探索、架构转向和用户后续拍板保持可追踪，不允许静默丢失信息量。
- `REQ-013`: 对 `Codex` / `Claude Code` 自身特性、运行机制、实现原理与产品限制的长期文档化，必须以官方 docs 为 authority，并受 freshness policy 约束。
- `REQ-014`: dashboard 监控长时 Agent 运行时，必须采用 `task-first UI + run-ledger truth` 模型：`task` 为主入口，`run` 强绑定到 `task`，运行日志与心跳从 `.thoth/runs/*` 读取，不再把高频运行时事实写成 YAML authority。

## Acceptance Criteria

- `AC-001`: 仓库根存在 `AGENTS.md` 与 `CLAUDE.md`，且 `CLAUDE.md` 在文件系统允许时与 `AGENTS.md` 为同一文件。
- `AC-002`: `.agent-os/` 中存在完整状态文档集，并通过 `agent-project-system` 的验证脚本。
- `AC-003`: `project-index.md` 中存在唯一 top next action，且引用真实 `TD-*`。
- `AC-004`: 文档中明确记录 `dev` 与 `main` 的边界、所有默认开发都在 `dev`、以及 `cherry-pick` 为默认集成策略。
- `AC-005`: 文档准确描述当前插件代码面：
  - 当前公开命令同时包括 Claude `/thoth:*` 与 Codex `$thoth <command>`
  - Claude 侧 `--executor codex` 继续存在
  - 当前已实现 `.thoth` authority tree 与基础 durable runtime / dashboard run-ledger 读面
- `AC-006`: `architecture-milestones.md` 中明确分开“当前实现结构”与“目标 V2 架构”。
- `AC-007`: `.agent-os/official-sources/` 中存在完整的平台真源治理文档，并覆盖用户指定的全部官方来源。
- `AC-008`: `/thoth:init` 生成的项目包含最小 `.thoth/` authority tree；dashboard backend 能读取 `.thoth/runs/*` 并把 active run、history run 和 run log 绑定到 task 详情。

## Non-Goals

- 不在当前阶段实现完整 `.thoth/` durable runtime、lease registry、supervisor 或 adopt/init audit-first 协议；本轮只落最小 `.thoth/` authority tree 和 task-bound run ledger dashboard contract。
- 不在本次初始化中把 `main` 的文档过滤机制直接实现为最终 Git/CI 机制；本次先把治理规则和后续工作项落盘。
- 不在本次初始化中改写当前插件代码架构，只为后续开发提供真实、可恢复的控制平面。

## Hard Constraints

- `REQ-008`: 项目状态文档主语言为中文。
- `REQ-009`: 代码注释与脚本 `print` 输出保持英文。
- `REQ-010`: 没有证据不得宣称“完成”“验证通过”或“V2 已实现”。
- `REQ-011`: 后续对 `main` 的代码集成默认只允许 `cherry-pick`。
- `REQ-012`: 不能丢失以下材料中的高信息量结论，只能重组、不能稀释：
  - `/root/.claude/plans/fuzzy-imagining-rose.md`
  - `/tmp/thoth-planning-20260422T152336Z/00-index.md`
  - `/tmp/thoth-planning-20260422T152336Z/01-decision-rounds.md`
  - `/tmp/thoth-planning-20260422T152336Z/02-synthesized-architecture.md`
  - `/tmp/thoth-planning-20260422T152336Z/03-open-schema-questions.md`

## Preservation Status

- `REQ-012` 当前已通过 repo-local 重组承载：
  - `planning/source-register.md`
  - `planning/legacy-plugin-blueprint.md`
  - `planning/decision-trace.md`
  - `planning/target-architecture.md`
  - `planning/open-questions.md`
- 这些文档的职责是吸收原始外部路径中的设计信息量，使仓库恢复不再依赖外部临时文件路径。
- `REQ-013` 当前通过以下目录承载：
  - `official-sources/platform-index.md`
  - `official-sources/source-governance.md`
  - `official-sources/openai-codex-and-api.md`
  - `official-sources/claude-code-runtime-and-platforms.md`
  - `official-sources/codex-vs-claude-code.md`

## Source Note

本文件保存用户定义的目标、治理边界和验收语义。允许清理表述，但不允许代理私自改变含义。
