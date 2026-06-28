# AGENTS.md

本文件是 New Thoth 在当前仓库中的项目操作合同。当前分支是从旧 Thoth plugin 形态迁移出来的新版设计和工程骨架分支；旧 plugin runtime 已封存为 archive，不再作为当前实现继续维护。

## 1. 使命

1. 保留用户已经锁定的 New Thoth 核心目标：最大程度降低用户心智负担和使用门槛，把模糊意图编译为可验证、可恢复、可异步执行、可审查的任务 loop。
2. 让仓库可以仅凭文件恢复上下文，而不是依赖聊天记录。
3. 明确区分三层事实：
   - 旧 Thoth plugin 已归档，不是当前实现主线。
   - 当前 checkout 是 New Thoth 的 TypeScript / Node monorepo skeleton。
   - `.agent-os/designs/` 是新版产品和架构设计的当前 authority。
4. 当前仓库不得为了短期可运行而重新引入旧 Python plugin runtime。

## 2. 恢复顺序

1. 先读本文件。
2. 再读 [`.agent-os/project-index.md`](.agent-os/project-index.md)。
3. 再读 [`.agent-os/todo.md`](.agent-os/todo.md) 中被 `project-index.md` 标记为当前 top next action 的条目。
4. 再读 [`.agent-os/run-log.md`](.agent-os/run-log.md) 最新记录。
5. 需要理解设计时，按顺序读：
   - [`.agent-os/designs/最核心的设计理念.md`](.agent-os/designs/最核心的设计理念.md)
   - [`.agent-os/designs/new-thoth-high-level-design.md`](.agent-os/designs/new-thoth-high-level-design.md)
   - [`.agent-os/designs/new-thoth-mvp-user-journey.md`](.agent-os/designs/new-thoth-mvp-user-journey.md)
   - [`.agent-os/designs/new-thoth-engineering-architecture.md`](.agent-os/designs/new-thoth-engineering-architecture.md)
   - [`.agent-os/designs/new-thoth-prompt-contract-seeds.md`](.agent-os/designs/new-thoth-prompt-contract-seeds.md)
6. `.agent-os/designs/new-thoth-migration-architecture-20260625.md` 是早期长文归档，只用于追溯，不覆盖三份 canonical 文档。
7. `.agent-os/official-sources/` 是旧阶段整理过的 harness 官方资料缓存。涉及 Codex、Claude Code、ACP、OpenTUI、Paseo、Multica 或其他快速变化资料时，应先回到当前官方资料或本地 checkout 核验。

## 3. 当前项目真相

1. 当前项目名：New Thoth。
2. 当前分支：`port/from-old-thoth-plugin`。
3. 当前实现状态：只有 monorepo skeleton 和设计文档，没有可运行 CLI、daemon、TUI、desktop、mobile、relay 或 harness driver。
4. 当前技术方向：TypeScript / Node，`npm workspaces`，`packages/` monorepo。
5. 当前 license：`GPL-3.0-only`。
6. 旧 plugin archive：
   - Release: `https://github.com/SeeleAI/Thoth/releases/tag/thoth-plugin-final-archive`
   - Branch: `archive/main-20260627`
7. 旧 plugin 源码如需追溯，应从 archive release 或 archive branch 获取，不在当前 working tree 内保留 legacy runtime 代码。

## 4. 文档职责

项目状态目录固定为 `.agent-os/`。

1. `project-index.md`: 当前真相、活跃工作流、唯一 top next action、阻塞与恢复入口。
2. `requirements.md`: 用户锁定目标、硬约束、验收标准、非目标。
3. `change-decisions.md`: 用户后续拍板与解释变化的 append-only 记录。
4. `architecture-milestones.md`: 当前 skeleton 架构、目标包结构、里程碑与验收。
5. `todo.md`: backlog / ready / doing / blocked / done / verified / abandoned。
6. `acceptance-report.md`: 已通过和未通过的证据账本。
7. `lessons-learned.md`: 失败探索、被否决方案、重试条件。
8. `run-log.md`: 最近工作会话的轻量时间序列记录。
9. `designs/`: New Thoth 产品、用户旅程、架构和 prompt contract authority。

## 5. 非协商规则

1. 不允许在没有用户决定的情况下改写 New Thoth 的核心目标、约束或验收含义。
2. 长期跟踪条目必须使用 New Thoth ID，例如：
   - `NTH-OBJ-001`
   - `NTH-REQ-001`
   - `NTH-AC-001`
   - `NTH-WS-001`
   - `NTH-MS-001`
   - `NTH-TD-001`
   - `NTH-EV-001`
   - `NTH-CD-001`
3. 没有证据不得声称完成、通过、收敛、已实现或满足目标。
4. `done` 不等于 `verified`；只有实现、验证、文档记账三者都完成，TODO 才可关闭。
5. 失败探索必须保留在 `lessons-learned.md`，不能为保持整洁而删除。
6. `project-index.md` 中必须始终只有一个全局 top next action。
7. 项目状态文档主语言为中文；代码注释与脚本输出使用英文。
8. 不允许重新引入旧 Python runtime、旧 Claude/Codex plugin projection、旧 dashboard template 或旧 Textual TUI 作为新版主实现。
9. `packages/tui` 必须以 OpenTUI 为 TUI 框架；Node/Bun 运行时细节留给后续 TUI spike。
10. 当前 skeleton 不应包含虚假的 build/test/typecheck 脚本，不应让读者误以为 MVP 已实现。

## 6. Monorepo 边界

当前 `packages/` 只允许包含以下 10 个包：

1. `packages/protocol`
2. `packages/client`
3. `packages/core`
4. `packages/daemon`
5. `packages/drivers`
6. `packages/tui`
7. `packages/app`
8. `packages/desktop`
9. `packages/relay`
10. `packages/cli`

新增包、改包名、引入 formatter/linter、创建 `tsconfig`、添加 runtime dependency 或写业务代码，都必须对应 `.agent-os/todo.md` 中的明确工作项。

## 7. 升级给用户的条件

仅在以下情况升级给用户：

1. 仍有必须由用户拍板的目标、边界、分支政策、license 或资源决策。
2. 硬外部阻塞导致无法推进。
3. 多条探索路径连续失败，项目明显停滞。
4. 当前 checkout 事实与 canonical 设计文档出现无法自行化解的高影响冲突。

## 8. 更新纪律

发生以下事件时必须更新相应状态文档：

1. 新建 TODO。
2. TODO 状态变化。
3. blocker 出现或消失。
4. milestone 完成或重排。
5. 新证据产生。
6. 某个探索失败或被放弃。
7. 一次 autonomous 工作会话结束。

最小要求：

1. 工作会话结束前更新 `run-log.md`。
2. 若 top next action 改变，同时更新 `project-index.md`。
3. 若用户拍板改变解释边界，同时更新 `change-decisions.md`。
4. 若新增或重核外部官方资料，同时更新 `.agent-os/official-sources/platform-index.md`。

## 9. 当前执行纪律

1. 当前分支只做 New Thoth reset 和后续新版实现，不做旧 plugin 兼容。
2. 默认不 push；除非用户明确要求。
3. 默认不触碰 `main`、archive 分支、release tag、GitHub release assets 或远端 marketplace 安装态。
4. 修改仓库结构后必须至少执行结构检查、JSON 元数据检查、`git diff --check` 和 `git status --short`。
