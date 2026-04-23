# TODO

## Backlog

- `TD-004` `[backlog]`: 明确 `main` 分支对开发态文档路径的拒收机制
  - Related items: `WS-001`, `MS-002`, `REQ-004`, `REQ-005`
  - Definition of done: 文档、脚本或流程层明确规定 `main` 如何避免接收 `AGENTS.md`、`CLAUDE.md`、`.agent-os/`

- `TD-005` `[backlog]`: 对照当前 `scripts/init.py` 与目标 audit-first adopt/init 语义，整理差距清单
  - Related items: `WS-002`, `MS-004`, `REQ-003`
  - Definition of done: 明确当前 init 行为、目标行为、过渡路径与 blocker

- `TD-006` `[backlog]`: 梳理当前 repo 结构到未来 `.thoth/` authority layout 的迁移映射
  - Related items: `WS-002`, `MS-004`, `REQ-003`
  - Definition of done: 至少明确当前 `commands/contracts/agents/scripts/templates/tests` 与未来 `.thoth` 结构之间的映射边界

## Ready

- `TD-001` `[ready]`: 将 `dev` / `main` 分流规则固化为仓库内可执行治理机制
  - Related items: `WS-001`, `MS-002`, `REQ-004`, `REQ-005`, `CD-004`, `CD-005`
  - Definition of done: 至少明确 dev-only 文档路径、`cherry-pick` 默认集成流程、以及面向 `main` 的检查或保护方案

- `TD-002` `[ready]`: 审核当前插件公开 surface、README 与安装行为之间是否仍有漂移
  - Related items: `WS-003`, `MS-003`, `REQ-006`
  - Definition of done: 当前公开命令面、README 叙事、安装后预期行为之间达成一致，并记录剩余问题

- `TD-003` `[ready]`: 把 V2 规划材料整理成 decision-complete 的迁移主线
  - Related items: `WS-002`, `MS-004`, `REQ-003`, `REQ-012`
  - Definition of done: 未来 `.thoth` authority runtime 的关键未决点被整理成明确可实施的问题序列

## Doing

- None

## Blocked

- None

## Done

- None

## Verified

- `TD-007` `[verified]`: 初始化 `dev` 分支项目状态文档系统
  - Related items: `MS-001`, `REQ-001`, `REQ-002`, `AC-001`, `AC-002`, `AC-003`
  - Definition of done: 基于现有 repo 与规划材料建立根入口和 `.agent-os/` 文档系统，并通过项目状态校验

## Abandoned

- `TD-008` `[abandoned]`: 把 bare command 名作为公共命令前缀策略
  - Related items: `WS-003`, `REQ-006`
  - Definition of done: N/A
  - Reason: 实际宿主行为验证后不符合期望，公共命令已恢复为显式 `/thoth:*`
