# Thoth

Thoth 正在被重建为一个 local-first 的 AI 任务控制平面。

旧的 Claude Code / Codex plugin runtime 已经归档，当前分支不再维护旧 plugin 形态。本仓库现在只包含 New Thoth 的设计 authority 和 TypeScript / Node monorepo skeleton。当前 checkout 还没有可运行的 CLI、daemon、TUI、桌面 app、手机 app、relay 或 harness driver。

## 当前状态

- 当前分支重点：New Thoth reset 和 MVP 架构。
- 当前实现状态：`packages/` 下的 `npm workspaces` 空骨架。
- 当前 license：`GPL-3.0-only`。
- 当前版权主体：`SeeleAI`。
- 当前 public surface：文档和包边界。
- 旧 plugin 归档 release：<https://github.com/SeeleAI/Thoth/releases/tag/thoth-plugin-final-archive>
- 旧 plugin 归档分支：`archive/main-20260627`

## New Thoth 要解决什么

New Thoth 的第一目标是最大程度降低用户心智负担和使用门槛。用户应该可以自然表达意图；Thoth 应该只追问真正影响方向、风险和验收的少量黄金问题，在需要时注册可恢复任务，异步运行 loop，通过独立审查验证结果，并用证据汇报。

核心方向是：

1. 用户面对的是 One Thoth，而不是可见 agent dashboard。
2. UI 是壳，authority 在 Thoth。
3. 任务是可恢复、可审查、可异步执行的 loop。
4. 成功基于验收和证据，不基于执行者自述。
5. Claude Code、Codex、ACP-compatible tools 和未来 provider 都只是 adapter，不是任务真相。

## 仓库结构

```text
packages/
  protocol/   共享协议和事件合同
  client/     共享 client SDK 和 transport
  core/       纯领域模型和生命周期规则
  daemon/     本地 authority server 和 scheduler
  drivers/    harness adapters
  tui/        OpenTUI workspace 控制台
  app/        桌面/手机共享 app surface
  desktop/    Electron shell 和 daemon 生命周期
  relay/      E2EE WebSocket relay
  cli/        高级脚本化 client
```

所有 package 目录都是占位骨架，当前刻意不包含业务实现。

## 设计 authority

从这里开始读：

- [最核心的设计理念](.agent-os/designs/最核心的设计理念.md)
- [High-Level Design](.agent-os/designs/new-thoth-high-level-design.md)
- [MVP User Journey](.agent-os/designs/new-thoth-mvp-user-journey.md)
- [Engineering Architecture](.agent-os/designs/new-thoth-engineering-architecture.md)
- [Prompt Contract Seeds](.agent-os/designs/new-thoth-prompt-contract-seeds.md)

旧的长篇迁移笔记保留在 `.agent-os/designs/new-thoth-migration-architecture-20260625.md`，仅用于历史追溯。

## 开发提示

当前 checkout 不是可运行产品。不要把它当作旧 plugin runtime 安装，也不要期待当前分支提供 `thoth`、`/thoth:*` 或 `$thoth` 命令。

后续实现应以 `.agent-os/project-index.md`、`.agent-os/todo.md` 和上面的 canonical 设计文档为准。
