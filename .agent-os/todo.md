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

- `TD-016` `[ready]`: 梳理当前冗余抽象、重复状态源与过度包装清单，明确哪些必须删除、合并或下沉
  - Related items: `WS-005`, `MS-005`, `REQ-022`, `REQ-023`, `REQ-024`

- `TD-017` `[ready]`: 收敛公开命令层、宿主投影层与 bridge/skill surface，使 host difference 只停留在交互适配而非语义分叉
  - Related items: `WS-003`, `WS-005`, `MS-005`, `REQ-006`, `REQ-019`, `REQ-023`, `REQ-024`

- `TD-018` `[ready]`: 收敛 planning authority 与 task compiler，把 Decision / Contract / Task / Verdict 之间的 canonical 数据模型压实
  - Related items: `WS-002`, `WS-005`, `MS-004`, `MS-005`, `REQ-023`, `REQ-024`

- `TD-019` `[ready]`: 收敛 runtime protocol 与 run state machine，明确 live / sleep / attach / resume / stop 的唯一状态流
  - Related items: `WS-002`, `WS-005`, `MS-005`, `REQ-023`, `REQ-024`

- `TD-020` `[ready]`: 收敛 execution orchestration，实现 host-neutral runtime core 与最小 host adapter
  - Related items: `WS-002`, `WS-003`, `WS-005`, `MS-005`, `REQ-019`, `REQ-023`, `REQ-024`

- `TD-021` `[ready]`: 收敛 project materialization 流程，简化 init / sync / render / migrate 的责任边界
  - Related items: `WS-002`, `WS-005`, `MS-005`, `REQ-018`, `REQ-022`, `REQ-023`

- `TD-022` `[ready]`: 收敛 observability/read-model，把 status / doctor / report / dashboard / hooks 统一为 authority 的只读派生层
  - Related items: `WS-002`, `WS-003`, `WS-005`, `MS-005`, `REQ-014`, `REQ-022`, `REQ-024`

- `TD-023` `[ready]`: 收敛验证体系，确保 light / medium / heavy 与 deterministic selftest 的职责边界清晰且可维护
  - Related items: `WS-003`, `WS-005`, `MS-005`, `REQ-017`, `REQ-021`, `REQ-022`

- `TD-024` `[ready]`: 以 `Codex-only` closing gate 作为本轮唯一结束门槛，并按分支治理完成 `dev -> main -> push both -> update local installs`
  - Related items: `WS-001`, `WS-003`, `WS-005`, `MS-005`, `REQ-020`, `REQ-025`

## Doing

- `TD-024` `[doing]`: 以 `Codex-only` closing gate 作为本轮唯一结束门槛，并按分支治理完成 `dev -> main -> push both -> update local installs`
  - Related items: `WS-001`, `WS-003`, `WS-005`, `MS-005`, `REQ-020`, `REQ-025`

## Blocked

- None

## Done

- None

## Verified

- `TD-015` `[verified]`: 冻结 Thoth 的高维分层架构与层间协议，并把用户本轮“简化、不丢功能、不改语义、最终 heavy 双宿主通过”的要求翻译成可执行重构主线
  - Related items: `WS-005`, `MS-005`, `REQ-022`, `REQ-023`, `REQ-024`, `REQ-025`
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
