# Change Decisions

## Purpose

Append-only 记录用户后续拍板与解释变化，不通过偷偷改写 `requirements.md` 来掩盖方向变化。

## Entries

- `CD-001` `2026-04-22` `[accepted]`: Thoth V2 的控制平面采用 `Thoth 主控`，外部 Codex 仅作每轮或显式子任务 worker
  - Related items: `REQ-003`, `WS-002`
  - Human rationale: 需要稳定、可控、可追踪、跨 session 恢复的 runtime，而不是把控制权交给外部 worker
  - Effect on project: 未来目标架构以 `.thoth` authority + durable runtime 为中心

- `CD-002` `2026-04-22` `[accepted]`: 运行时真相模型为“repo ledger 为权威，SQLite 仅为派生索引/缓存”
  - Related items: `REQ-003`, `WS-002`
  - Human rationale: 最大化可追踪性、Git 友好性与宿主解耦
  - Effect on project: 当前文档必须把 SQLite 视为派生层，不能把数据库写成最终 authority

- `CD-003` `2026-04-22` `[accepted]`: `/thoth:init` 的未来目标语义是“先审计，再 preview，再询问，再 apply”，而不是盲目 scaffold
  - Related items: `REQ-003`, `WS-002`, `TD-005`
  - Human rationale: 现有项目接管不能破坏已有仓库信息
  - Effect on project: 当前 init 脚手架能力与目标 adoption 语义之间的差距必须被明确记录

- `CD-004` `2026-04-23` `[accepted]`: `dev` 分支保留开发态文档系统，`main` 完全不保留 `AGENTS.md`、`CLAUDE.md`、`.agent-os/`
  - Related items: `REQ-001`, `REQ-004`, `WS-001`
  - Human rationale: `dev` 作为开发控制平面，`main` 作为发布面，两者职责要彻底分离
  - Effect on project: 当前初始化的根文档与状态目录只服务于 `dev`

- `CD-005` `2026-04-23` `[accepted]`: `dev -> main` 的默认集成策略为 `cherry-pick` 代码提交
  - Related items: `REQ-005`, `WS-001`
  - Human rationale: 避免把 `dev` 动态状态文档和控制平面信息带入 `main`
  - Effect on project: 后续治理机制、脚本与文档都必须围绕 `cherry-pick` 作为默认路径

- `CD-006` `2026-04-23` `[accepted]`: 当前公开命令面保持显式 `/thoth:*`，内部协议层与内部 worker 不暴露为公开 slash surface
  - Related items: `REQ-006`, `WS-003`
  - Human rationale: 宿主体验必须干净，不能把内部模块暴露给用户
  - Effect on project: 公开 `:codex` 变体和内部 skill 外露已被视为 rejected 路径

- `CD-007` `2026-04-23` `[accepted]`: `Codex` / `Claude Code` 外部平台知识采用“官方 docs 为 authority，`.agent-os/official-sources/` 为缓存综合层”的治理模型
  - Related items: `REQ-013`, `WS-004`
  - Human rationale: 涉及平台能力与实现原理时不能依赖陈旧认知，必须有 latest-first 的真源规则
  - Effect on project: 后续所有平台知识都必须遵守 freshness policy 与 live-check 规则

- `CD-008` `2026-04-23` `[accepted]`: dashboard 的长时运行真相采用 `task-first UI + run-ledger truth + smart polling` 模型
  - Related items: `REQ-014`, `WS-002`, `WS-003`
  - Human rationale: 前端必须稳定展示后端 Agent 长时进度，运行日志不能再依赖 YAML 或宿主会话拼装
  - Effect on project: `.thoth/runs/*` 成为运行事实层；task 页面必须展示 active run、history run 与 run logs；默认轮询周期锁定为 `10` 分钟

- `CD-009` `2026-04-23` `[accepted]`: 所有默认开发工作都在 `dev` 分支进行，未经用户明确批准不得直接修改 `main`
  - Related items: `REQ-015`, `REQ-016`, `WS-001`
  - Human rationale: 需要把开发控制平面和稳定发布面彻底分开，避免代理在 `main` 上继续积累未审查改动
  - Effect on project: `main` 只作为稳定集成入口；代理若位于 `main` 必须先切回 `dev` 或其他获批开发分支，再继续修改 repo-tracked 文件
