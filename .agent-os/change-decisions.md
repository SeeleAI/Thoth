# Change Decisions

## Purpose

Append-only 记录用户后续拍板与解释变化，不通过偷偷改写 `requirements.md` 来掩盖方向变化。

## Entries

- `CD-001` `2026-04-22` `[accepted]`: Thoth V2 的控制平面采用 `Thoth 主控`，外部 Codex 仅作每轮或显式子任务 worker
- `CD-002` `2026-04-22` `[accepted]`: 运行时真相模型为“repo ledger 为权威，SQLite 仅为派生索引/缓存”
- `CD-003` `2026-04-22` `[accepted]`: `/thoth:init` 的目标语义是“先审计，再 preview，再 apply”，而不是盲目 scaffold
- `CD-004` `2026-04-23` `[accepted]`: `dev` 分支保留开发态文档系统，`main` 不保留 `AGENTS.md`、`CLAUDE.md`、`.agent-os/`
- `CD-005` `2026-04-23` `[accepted]`: `dev -> main` 的默认集成策略为 `cherry-pick`
- `CD-006` `2026-04-23` `[accepted]`: 当前公开命令面保持显式 `/thoth:*`，内部协议层与内部 worker 不暴露为公开 slash surface
- `CD-007` `2026-04-23` `[accepted]`: `Codex` / `Claude Code` 平台知识采用“官方 docs 为 authority，仓库文档为缓存综合层”的治理模型
- `CD-008` `2026-04-23` `[accepted]`: dashboard 的长时运行真相采用 `task-first UI + run-ledger truth + smart polling` 模型
- `CD-009` `2026-04-23` `[accepted]`: 所有默认开发工作都在 `dev`，未经用户明确批准不得直接修改 `main`
- `CD-010` `2026-04-23` `[accepted]`: Thoth 的验证体系采用“双层门槛 + repo-real 默认 + host-real 自动追加”模型
- `CD-011` `2026-04-23` `[accepted]`: Codex 分发面按官方 plugin manifest/schema 对齐，但不改动 Claude Code 公开 surface 与 `.thoth` authority 边界
- `CD-012` `2026-04-23` `[accepted]`: `/thoth:init` 必须升级为 audit-first adopt/init
- `CD-013` `2026-04-23` `[accepted]`: 新功能开发必须同步兼顾 Claude Code 与 Codex，且开发完成后必须完成 `dev -> main -> push both -> update local installs` 收尾
- `CD-014` `2026-04-24` `[accepted]`: 严格任务执行模型固定为 `Decision -> Contract -> compiler-generated Task`，`run` / `loop` 默认只接受 `--task-id`
- `CD-015` `2026-04-24` `[accepted]`: 仓库的唯一保留上游切换为 `https://github.com/SeeleAI/Thoth`
- `CD-016` `2026-04-24` `[accepted]`: 公开仓库不保留个人邮箱、私人本地路径或外部项目来源链
