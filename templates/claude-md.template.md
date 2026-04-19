# AGENTS.md

本文件是 `{{PROJECT_NAME}}` 的项目操作合同，由 Thoth 插件自动生成。

## 1. 使命

- 保留用户定义的最终目标、要求与验收边界，不允许代理私自改写其含义。
- 让项目仅靠文件恢复上下文，而不是依赖聊天记录。
- 保持真实状态、证据、失败探索和单一最高优先级下一步动作可见。

## 2. 恢复顺序

1. 先读本文件。
2. 再读 `.agent-os/project-index.md`。
3. 再读 `.agent-os/requirements.md`、`.agent-os/architecture-milestones.md`、`.agent-os/todo.md`。
4. 最近会话历史最后再看 `.agent-os/run-log.md`。

## 3. 文档角色

`.agent-os/` 必须至少包含：

- `project-index.md`: 当前真相、活跃工作流、唯一 top next action、阻塞与恢复指针
- `requirements.md`: 用户目标、要求、验收标准、非目标、硬约束
- `change-decisions.md`: 后续用户拍板造成的解释变化
- `architecture-milestones.md`: 当前架构、工作流、里程碑与里程碑验收
- `todo.md`: backlog / ready / doing / blocked / done / verified / abandoned
- `acceptance-report.md`: 最终或中间验收结论与证据
- `lessons-learned.md`: 失败探索、陷阱、放弃原因与重试条件
- `run-log.md`: 轻量时间序列运行记录

## 4. 真相与证据规则

1. 无证据不得声称完成、通过、收敛或满足目标。
2. `done` 不是 `verified`；关闭项前必须同步更新证据和文档状态。
3. 失败探索必须进 `lessons-learned.md`，不能静默丢弃。

## 5. 研究任务自检纪律

1. 所有研究任务状态存储在 `.agent-os/research-tasks/` 的结构化 YAML 文件中。
2. 每个任务必须有硬数字完成标准（`criteria.threshold`）。
3. 标记任务阶段为 completed 前，必须先运行：
   ```
   python .agent-os/research-tasks/verify_completion.py <task_id>
   ```
4. 每个阶段的产物必须使用 structured deliverables（数组格式）。
5. 标记 verdict 时，`evidence_paths` 必须指向真实存在的产物文件。
6. 失败的假设必须填写 `failure_analysis`。
7. 任何任务状态变更必须同时更新 YAML、`run-log.md`，并运行 `sync_todo.py`。
8. Git commit 前会自动运行 pre-commit hook。首次 clone 后需运行 `bash scripts/install-hooks.sh`。
9. 配置驱动：方向、里程碑等在 `.research-config.yaml` 和 `.agent-os/milestones.yaml` 中定义。
10. 每次 session 结束前，必须运行 `bash scripts/session-end-check.sh`。

## 6. 交互纪律

所有与本项目的交互应通过 Thoth 插件命令进行：
- `/thoth:run` — 执行单次任务
- `/thoth:loop` — 自主迭代执行
- `/thoth:discuss` — 讨论（不改代码）
- `/thoth:status` — 查看状态
- `/thoth:review` — 第一性原理审查
- `/thoth:doctor` — 系统健康检查
- `/thoth:sync` — 同步状态
- `/thoth:report` — 生成报告
- `/thoth:dashboard` — 启动看板
