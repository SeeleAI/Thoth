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

1. `dev` 是本仓库唯一的日常开发控制平面分支。
2. 所有默认开发工作都必须在 `dev` 上进行，包括代码、测试、生成物、治理文档与代理操作合同的修改。
3. `main` 是发布/稳定集成分支。
4. 未经用户明确批准，不允许直接修改 `main` 上的 repo-tracked 代码或文档；若当前工作树位于 `main`，应先切回 `dev` 或其他获批开发分支，再继续编辑。
5. 以下动态开发态文档允许存在于 `dev`，但默认不进入 `main`：
   - `AGENTS.md`
   - `CLAUDE.md`
   - `.agent-os/`
6. `dev -> main` 的默认代码集成策略是 `cherry-pick`，而不是直接 `merge dev`。
7. 面向 `main` 的代码提交必须尽量与开发态文档变更分开，避免把控制平面状态带入发布面。
8. 若后续需要在仓库机制层进一步硬化 `main` 的排斥策略，应将其视为 `WS-001` 下的正式工作项，而不是口头约定。
9. 任何新功能开发都必须同时检查并同步 `Claude Code` 与 `Codex` 两个宿主面的行为、投影、安装面与测试面；除非用户明确批准，不允许只在单一宿主上落地而让另一侧漂移。
10. 每次开发完成后，都必须按本仓库约束完成完整收尾：
   - 在 `dev` 上完成开发与验证
   - 将应发布的代码提交按默认策略集成到 `main`（默认 `cherry-pick`）
   - `push origin dev` 与 `push origin main`
   - 更新当前机器上的本地 `Claude Code` 与 `Codex` 的 `Thoth` 安装，使其与仓库最新状态一致

## 6. 当前项目真相边界

1. 当前 checkout 已包含 host-neutral command spec，并从同一主源投影 Claude `/thoth:*` 与 Codex `$thoth <command>` public surface。
2. Claude 侧 `--executor codex` 继续保留；Codex 侧公开面收敛为单一 `$thoth` 入口。
3. 当前仓库已落成 repo-local `thoth` Python 包、`.thoth` authority tree、基础 durable run ledger / supervisor runtime，以及 Codex 官方 plugin/skill surface。
4. dashboard runtime 读面以 `.thoth/runs/*` 为准，并显式展示 host、executor、attachable、stale、supervisor_state 等字段。
5. 文档中必须明确区分：
   - 当前已实现事实
   - 已锁定但尚未实现的目标架构
6. `/thoth:init` 必须按 audit-first adopt/init 语义工作：先审查当前 repo 的代码、文档与现有控制平面状态，再通过 migration ledger 进行受管更新，不得假设目标 repo 是空白仓库。
7. 当前 checkout 已新增 strict execution planning authority：`.thoth/project/decisions/`、`.thoth/project/contracts/` 与编译生成的 `.thoth/project/tasks/`；`run` / `loop` 默认只接受 `--task-id`，不允许自由文本直接进入执行。

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

## 9. 行为准则整合

以下行为准则已并入本仓库的 `AGENTS.md` / `CLAUDE.md`，用于降低常见 LLM 编码失误。若与上文冲突，仍以上文项目治理约束和用户当轮指令为准。

### 9.1 Think Before Coding

**不要假设。不要掩饰困惑。先暴露权衡。**

- 在实施前明确写出关键假设；若高影响前提不清楚，先停下来核对。
- 若存在多个合理解释，不要静默选一个；要把分歧点显式化。
- 若更简单的方案已经足够，要主动指出，不为“灵活性”凭空加层。
- 若信息不清晰，应直接说明卡点，而不是带着模糊理解继续实现。

### 9.2 Simplicity First

**只写解决当前问题所需的最小代码，禁止投机式扩展。**

- 不实现用户未要求的功能。
- 不为一次性逻辑提前抽象。
- 不引入未被要求的“可配置性”“可扩展性”或防御式复杂度。
- 不为不可能场景添加噪音式错误处理。
- 若实现明显比问题本身更复杂，应先回退到更小方案。

### 9.3 Surgical Changes

**只改必须改的地方；只清理自己引入的问题。**

- 编辑现有实现时，不顺手重构无关代码、注释或格式。
- 保持周边文件的既有风格，除非用户明确要求统一。
- 只删除因本次修改而变成未使用的导入、变量、函数。
- 若发现既有死代码或相邻问题，可以报告，但不要借机扩大改动面。
- 每一行变更都应能直接追溯到当前请求。

### 9.4 Goal-Driven Execution

**先定义可验证成功条件，再循环到验证通过。**

- 将“修一下”“支持一下”这类宽泛请求翻译成可核验目标。
- 多步任务默认采用“步骤 -> 验证方式”思维，而不是先写一大段实现。
- 对 bugfix，优先形成可复现证据，再修复并复验。
- 对重构，优先保护既有行为和测试边界，避免把“重写”伪装成“整理”。

推荐使用的最小计划格式如下：

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

### 9.5 在 Thoth 仓库中的具体落地

- 对 `init` / `sync` / `run` / `loop` / `review` 等 public commands，不允许用宿主自然语言补齐缺失执行证据。
- 对 `thoth:init`，必须坚持 `audit-first adopt/init`：先审查现状，再生成 preview / migration 证据，再做受管更新。
- 对双宿主 surface、bridge、plugin、skill、dashboard、hook 等改动，默认同时检查 Claude Code 与 Codex，不允许单侧漂移。
- 对治理文档或 prompt 合同的修改，同样遵循“最小改动、目标驱动、证据优先”，不要把行为准则写成与项目真实边界相冲突的口号。
