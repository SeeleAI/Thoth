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
- `AC-009`: 仓库提供单一自测试入口并形成双层门槛：`hard` 为默认 repo-real gate，`heavy` 追加浏览器层与宿主矩阵。
- `AC-010`: `/thoth:init` 能在空白 repo、漂移 repo 和已有 `.thoth` / `.agent-os` 的 repo 上执行 audit-first adopt/init。
- `AC-011`: `/thoth:init` 每次执行都会写出 migration ledger 和 `.thoth/project/source-map.json`。
- `AC-012`: `AGENTS.md` 中明确要求新功能同步兼顾 Claude Code 与 Codex，并按固定流程收尾。

## Non-Goals

- 不把当前仓库描述成已完整实现 `Thoth V2`。
- 不在本次状态文档中保存历史私有路径、私人环境细节或外部项目背景。
- 不把 `main` 的隔离机制错误描述成已经完全自动化。

## Hard Constraints

- `REQ-008`: 项目状态文档主语言为中文。
- `REQ-009`: 代码注释与脚本 `print` 输出保持英文。
- `REQ-010`: 没有证据不得宣称“完成”“验证通过”或“V2 已实现”。
- `REQ-011`: 面向 `main` 的代码集成默认只允许 `cherry-pick`。

## Source Note

本文件保存用户定义的目标、治理边界和验收语义。允许精简公开表述，但不允许私自改变含义。
