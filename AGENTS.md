# AGENTS.md

本文件是 `Thoth` 在 `dev` 分支上的项目操作合同。

## 1. 使命

- 保留用户定义的最终目标、要求、分支治理边界与验收语义，不允许代理私自改写其含义。
- 让 `dev` 分支可以仅凭仓库内文档恢复上下文，而不是依赖聊天记录。
- 同时维护三层真相：
  - 当前 checkout 的真实实现状态
  - 已锁定的分支治理与产品约束
  - 未来 `Thoth V2` / `.thoth` authority runtime 的目标架构

## 2. 恢复顺序

1. 先读本文件。
2. 再读 [`.agent-os/project-index.md`](.agent-os/project-index.md)。
3. 再读 [`.agent-os/todo.md`](.agent-os/todo.md) 中被 `project-index.md` 标记为当前活跃的条目。
4. 再读 [`.agent-os/run-log.md`](.agent-os/run-log.md) 最新相关记录。
5. 只有需要时才继续深入：
   - [`.agent-os/requirements.md`](.agent-os/requirements.md)
   - [`.agent-os/architecture-milestones.md`](.agent-os/architecture-milestones.md)
   - [`.agent-os/change-decisions.md`](.agent-os/change-decisions.md)
   - [`.agent-os/acceptance-report.md`](.agent-os/acceptance-report.md)
   - [`.agent-os/lessons-learned.md`](.agent-os/lessons-learned.md)
6. 若任务涉及 `Codex` / `Claude Code` 的平台能力、实现原理、hooks、subagents、background、web、remote、automations、GitHub Actions 或 local environments：
   - 先读 [`.agent-os/official-sources/source-governance.md`](.agent-os/official-sources/source-governance.md)
   - 再读 [`.agent-os/official-sources/platform-index.md`](.agent-os/official-sources/platform-index.md)
   - 再读对应综合解析
   - 若超过 freshness 阈值，先回官方 latest 页面，再给结论

## 3. 文档职责

项目状态目录固定为 `.agent-os/`，必须至少包含：

- `project-index.md`: 当前真相、活跃工作流、唯一 top next action、阻塞与恢复入口
- `requirements.md`: 用户目标、硬约束、验收标准、非目标、分支治理边界
- `change-decisions.md`: 用户后续拍板与解释变化的 append-only 记录
- `architecture-milestones.md`: 当前实现结构、目标架构、工作流与里程碑
- `todo.md`: backlog / ready / doing / blocked / done / verified / abandoned
- `acceptance-report.md`: 已通过与未通过的证据账本
- `lessons-learned.md`: 失败探索、被否决方案、重试条件
- `run-log.md`: 最近工作会话的轻量时间序列记录

官方平台知识目录固定为 `.agent-os/official-sources/`，用于治理：

- `Codex`
- `Claude Code`
- 以及与其直接相关的 OpenAI / Anthropic 官方平台资料

根目录还必须包含：

- `AGENTS.md`
- `CLAUDE.md`

当文件系统支持时，`CLAUDE.md` 应与 `AGENTS.md` 指向同一 inode。

## 4. 非协商规则

1. 不允许在没有用户决定的情况下改写项目目标、分支治理边界或验收含义。
2. 项目内所有长期跟踪条目必须使用全局唯一 typed IDs，例如：
   - `OBJ-001`
   - `REQ-001`
   - `AC-001`
   - `WS-001`
   - `MS-001`
   - `TD-001`
   - `RSK-001`
   - `EXP-001`
   - `EV-001`
   - `CD-001`
3. 没有证据不得声称完成、通过、收敛、已实现或满足目标。
4. `done` 不等于 `verified`；只有实现、验证、文档记账三者都完成，TODO 才可关闭。
5. 失败探索必须保留在 `lessons-learned.md`，不能为保持“整洁”而删除。
6. `project-index.md` 中必须始终只有一个全局 top next action。
7. 项目状态文档主语言为中文；代码注释与脚本 `print` 输出保持英文。
8. 涉及 `Codex` / `Claude Code` 自身特性、执行机制、实现原理或产品限制时，官方文档是唯一 authority；仓库内总结只能作为缓存综合层。
9. 对外部官方资料的 repo-local 结论必须遵守 freshness policy：
   - 高波动页 `30` 天
   - 概念 / best-practice 页 `60` 天
10. 页面若带 `preview` / `research preview` / `experimental` 标签，则即使未过 freshness 阈值，只要用于能力或限制判断，也必须先回官方 latest 页面核验。

## 5. 分支治理与集成规则

1. `dev` 是本仓库的开发控制平面分支。
2. `main` 是发布/稳定集成分支。
3. 以下动态开发态文档允许存在于 `dev`，但默认不进入 `main`：
   - `AGENTS.md`
   - `CLAUDE.md`
   - `.agent-os/`
4. `dev -> main` 的默认代码集成策略是 `cherry-pick`，而不是直接 `merge dev`。
5. 面向 `main` 的代码提交必须尽量与开发态文档变更分开，避免把控制平面状态带入发布面。
6. 若后续需要在仓库机制层进一步硬化 `main` 的排斥策略，应将其视为 `WS-001` 下的正式工作项，而不是口头约定。

## 6. 当前项目真相边界

1. 当前 checkout 是一个已经可以运行测试的 Claude-hosted plugin 代码仓。
2. 当前公开命令面已经收敛为 `/thoth:*`，并去除了公开内部 skill 与公开 `:codex` 变体。
3. Codex 当前以 executor-mode 方式进入 `run` / `loop` / `review`。
4. 当前仓库尚未落成 `.thoth/` authority、durable supervisor runtime、run ledger、lease registry 等 `Thoth V2` 能力。
5. 文档中必须明确区分：
   - 当前已实现事实
   - 已锁定但尚未实现的目标架构

## 7. 升级给用户的条件

仅在以下情况升级给用户：

- 仍有必须由用户拍板的目标、边界、分支政策或资源决策
- 硬外部阻塞导致无法推进
- 多条探索路径连续失败，项目明显停滞
- 当前 checkout 事实与既有规划材料之间出现无法自行化解的高影响冲突

## 8. 更新纪律

发生以下事件时必须更新相应状态文档：

- 新建 TODO
- TODO 状态变化
- blocker 出现或消失
- milestone 完成或重排
- 新证据产生
- 某个探索失败或被放弃
- 一次 автоном工作会话结束

最小要求：

- 工作会话结束前更新 `run-log.md`
- 若 top next action 改变，则同时更新 `project-index.md`
- 若用户拍板改变解释边界，则同时更新 `change-decisions.md`
- 若新增或重核外部官方资料，则同时更新 `.agent-os/official-sources/platform-index.md`
