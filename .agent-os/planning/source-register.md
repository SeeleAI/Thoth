# Planning Source Register

## Purpose

本文件证明以下 5 份外部规划材料已经被完整吸收进当前仓库的 `.agent-os/` 文档系统，后续可以不再依赖原始路径进行恢复：

- `/root/.claude/plans/fuzzy-imagining-rose.md`
- `/tmp/thoth-planning-20260422T152336Z/00-index.md`
- `/tmp/thoth-planning-20260422T152336Z/01-decision-rounds.md`
- `/tmp/thoth-planning-20260422T152336Z/02-synthesized-architecture.md`
- `/tmp/thoth-planning-20260422T152336Z/03-open-schema-questions.md`

## Preservation Rules

- 规则 1: 不把旧蓝图误写成当前实现事实。
- 规则 2: 不把当前 repo 的已实现状态和 V2 目标架构混写。
- 规则 3: 不压扁原始材料的信息密度，必须保留：
  - 原始设计蓝图
  - 决策轨迹
  - 已收敛目标架构
  - 仍未关闭的协议/Schema 问题
- 规则 4: 当前恢复入口仍以 `AGENTS.md -> project-index.md -> active items -> run-log.md` 为主；高信息量规划材料下沉到 `.agent-os/planning/`。

## Coverage Matrix

| Source | Role in source set | Primary destination | Secondary destination |
| --- | --- | --- | --- |
| `fuzzy-imagining-rose.md` | 早期完整插件蓝图，覆盖命令面、skills、dashboard、session hooks、测试与实现顺序 | `planning/legacy-plugin-blueprint.md` | `architecture-milestones.md`, `lessons-learned.md` |
| `00-index.md` | 规划快照总索引与范围定义 | `planning/decision-trace.md` | `project-index.md`, `planning/source-register.md` |
| `01-decision-rounds.md` | 逐轮问答与架构收敛轨迹 | `planning/decision-trace.md` | `change-decisions.md`, `architecture-milestones.md`, `todo.md` |
| `02-synthesized-architecture.md` | 已锁定 V2 架构总合同 | `planning/target-architecture.md` | `architecture-milestones.md`, `requirements.md` |
| `03-open-schema-questions.md` | 实施前仍未关闭的高优先协议问题 | `planning/open-questions.md` | `todo.md`, `architecture-milestones.md` |

## Destination Documents

### Core recovery documents

- `project-index.md`
  - 继续维护唯一 top next action。
  - 现在显式把规划细节的主入口指向 `.agent-os/planning/`。
- `requirements.md`
  - 保留“不可丢失原始规划材料信息量”的硬约束。
  - 增加“已被仓库内文档吸收”的说明。
- `architecture-milestones.md`
  - 继续保存当前实现结构与 V2 目标架构的分层边界。
  - 新增对规划承载文档的引用。
- `todo.md`
  - 把规划吸收本身作为已完成治理动作记账。
  - 将开放协议问题继续映射为后续正式工作项。
- `acceptance-report.md`
  - 记录本次“规划材料吸收完成”的证据。
- `run-log.md`
  - 记录本次吸收动作，保证下次恢复能知道发生过什么。

### High-information planning documents

- `planning/legacy-plugin-blueprint.md`
  - 承接旧版完整插件蓝图。
  - 对每一块内容标注其与当前 repo 的关系：`current` / `partial` / `superseded` / `target-v2`。
- `planning/decision-trace.md`
  - 保留规划快照范围与 25 轮决策轨迹。
  - 供未来做“为什么会这样设计”的回放。
- `planning/target-architecture.md`
  - 承接已经 decision-complete 的 V2 总体架构。
  - 明确 authority stack、runtime model、public/internal surface、测试哲学。
- `planning/open-questions.md`
  - 保留尚未关闭的协议问题，并映射到当前 repo 的后续任务。

## Deletion Safety Statement

只要以下文档保留在仓库内：

- `planning/source-register.md`
- `planning/legacy-plugin-blueprint.md`
- `planning/decision-trace.md`
- `planning/target-architecture.md`
- `planning/open-questions.md`

并且核心 `.agent-os/*.md` 继续引用它们，则恢复当前 repo 的设计背景与 V2 目标时，不再需要依赖原始 5 份外部路径。

## Last Consolidation

- Consolidated on: `2026-04-23`
- Source count: `5`
- Consolidation posture: `full-read + semantic split + repo-local recovery integration`
