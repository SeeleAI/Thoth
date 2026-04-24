# TODO

## Backlog

- `TD-004` `[backlog]`: 明确 `main` 分支对开发态文档路径的拒收机制
  - Related items: `WS-001`, `MS-002`, `REQ-004`, `REQ-005`

- `TD-005` `[backlog]`: 对照当前 `scripts/init.py` 与目标 audit-first adopt/init 语义整理差距清单
  - Related items: `WS-002`, `MS-004`, `REQ-003`

- `TD-006` `[backlog]`: 梳理当前 repo 结构到未来 `.thoth/` authority layout 的迁移映射
  - Related items: `WS-002`, `MS-004`, `REQ-003`

## Ready

- `TD-001` `[ready]`: 将 `dev` / `main` 分流规则固化为仓库内可执行治理机制
  - Related items: `WS-001`, `MS-002`, `REQ-004`, `REQ-005`

- `TD-003` `[ready]`: 把 V2 架构问题整理成 decision-complete 的迁移主线
  - Related items: `WS-002`, `MS-004`, `REQ-003`

## Doing

- None

## Blocked

- None

## Done

- None

## Verified

- `TD-002` `[verified]`: 当前插件公开 surface、README 与安装行为已重新对齐
- `TD-007` `[verified]`: `dev` 状态文档系统已初始化
- `TD-010` `[verified]`: 官方平台资料治理层已建立
- `TD-011` `[verified]`: task-first 的 run-ledger dashboard contract 已落地
- `TD-012` `[verified]`: 双层重型自测试系统已落地
- `TD-013` `[verified]`: `/thoth:init` 的 audit-first adopt/init 主流程已落地
- `TD-014` `[verified]`: strict `Decision -> Contract -> Task` 编译执行体系已落地

## Abandoned

- `TD-008` `[abandoned]`: 使用 bare command 名作为公共命令前缀
  - Reason: 实际宿主行为验证后不符合目标，公共命令已恢复为显式 `/thoth:*`
