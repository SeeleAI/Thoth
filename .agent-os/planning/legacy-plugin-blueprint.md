# Legacy Plugin Blueprint

## Purpose

本文件承接 `/root/.claude/plans/fuzzy-imagining-rose.md` 的高信息量内容。它描述的是一版更早、更完整、偏 Claude-plugin-first 的 Thoth 蓝图，不等于当前 repo 的全部已实现事实，但其中大量命令合同、模块边界、dashboard 设想、测试矩阵和迁移来源仍然对后续设计有价值。

阅读本文件时必须同时记住：

- 当前 repo 真相以代码树和核心 `.agent-os/` 文档为准。
- 本文件是“历史蓝图 + 可复用设计输入”。
- 凡是与当前实现冲突者，以当前实现和后续 V2 收敛结论为准。

## Original Context And Intent

原始蓝图把 Thoth 定义为一个可复用的 Claude Code plugin，目标是从 NeuralShader 中抽取出一套通用的研究/工程项目操作系统。

原始核心心智模型：

- Audit System: 面向人类的真相、证据、审计与决策层
- Execution System: 面向 AI 的执行、循环、验证与委派层

原始设计原则：

- `断舍离`
- 第一性原理
- dashboard-centric
- script-driven
- test-comprehensive

这些原则在今天仍然有效，但“Claude plugin 是最终宿主”这一假设已经被后续 V2 规划削弱；现在更准确的说法是“当前交付物是 Claude-hosted plugin，目标方向是更宿主无关的 `.thoth` runtime”。

## Original Decision Log Snapshot

原始蓝图中的早期决策包括：

| Topic | Early choice | Current interpretation |
| --- | --- | --- |
| Product name | `Thoth` | 仍然有效 |
| Repo path | `/mnt/cfs/5vr0p6/yzy/thoth` | 仍然有效 |
| Public commands | `11 main + 3 :codex variants` | 已被后续产品化修正；公开 `:codex` 变体已废弃 |
| Skills | `7` | 作为内部分层思想仍然有效，但不应公开暴露为 slash surface |
| Dashboard | `7 panels` | 仍然是重要方向，但当前 repo 尚未完全落成该形态 |
| Loop model | `task` / `metric` dual mode | 仍是高价值设计输入 |
| Discuss scope | 只改 YAML/config/DB/docs，不改代码 | 作为治理边界仍有价值 |
| Init behavior | full deployment | 已被后续 audit-first adopt/init 重新定义 |
| Extend behavior | add/modify with safety gates | 仍是合理产品护栏 |
| Testing posture | pytest + golden data | 仍然是高价值测试哲学 |
| Hooks | SessionStart + SessionEnd | 仍是重要交互点 |
| Codex integration | 独立 `:codex` commands | 已被 executor-mode 替代 |

## Original Directory Blueprint And Current Status

### Public and internal structure

| Blueprint area | Original intent | Current status |
| --- | --- | --- |
| `.claude-plugin/` | plugin metadata | `current` |
| `commands/` | public slash commands | `current` |
| `skills/thoth-*` | internal behavioral layers | `partial`，目录仍在，但公共暴露策略已收敛 |
| `agents/` | internal worker agents | `current` |
| `hooks/` | session lifecycle hooks | `current` |
| `templates/agent-os/` | target-project state scaffold | `current` |
| `templates/dashboard/` | target-project dashboard template | `current` |
| `templates/hooks/` | target-project hook templates | `current` |
| `templates/scripts/` | target-project helper scripts | `current` |
| `templates/tests/` | target-project tests | `current` |
| `scripts/` | plugin management scripts | `current` |
| `tests/` | plugin tests | `current` |

### Historically proposed but now superseded pieces

| Original idea | Why it matters | Current status |
| --- | --- | --- |
| Public `/thoth:run:codex` / `/thoth:loop:codex` / `/thoth:review:codex` | Shows the old public delegation surface | `superseded` by `--executor codex` |
| Public internal skills (`thoth-core`, `thoth-audit`, etc.) | Shows the old public/internal confusion point | `superseded`; internal layering should stay hidden |
| `.research-config.yaml` as direct project authority | Important for historical layout mapping | `target migration input`; V2 wants `.thoth/` as machine authority |

## Command Blueprint

原始蓝图给出了 14 个命令合同，其中大量流程和边界仍值得保留，但公共命令面已经历产品化修正。

### Stable command contract ideas still worth keeping

- 每个命令都有明确的 `Scope Guard`
- 每个命令都有 `Plan Mode`
- 工作流尽量脚本化、固定化，而不是自由发挥
- 错误必须具体处理，不能静默失败

### Original command set and current interpretation

| Command | Original role | Current status |
| --- | --- | --- |
| `/thoth:init` | 创世，完整初始化项目操作层 | `partial`，但语义已从“直接 scaffold”转向“audit-first adopt/init” |
| `/thoth:run` | 单任务执行 | `current` |
| `/thoth:run:codex` | 单任务 Codex 委派 | `superseded`，改为 `/thoth:run --executor codex` |
| `/thoth:loop` | 自主循环 | `current` |
| `/thoth:loop:codex` | 循环内 Phase 3 委派 Codex | `superseded`，改为 `/thoth:loop --executor codex` |
| `/thoth:discuss` | 只讨论与文档治理 | `current as design intent` |
| `/thoth:status` | 结构化状态输出 | `current as design intent` |
| `/thoth:review` | 第一性原理审查 | `current` |
| `/thoth:review:codex` | Codex 审查委派 | `superseded`，改为 `/thoth:review --executor codex` |
| `/thoth:doctor` | 状态完整性审计 | `current as design intent` |
| `/thoth:extend` | 修改 plugin 自身 | `current as design intent` |
| `/thoth:sync` | 对齐持久化数据 | `current as design intent` |
| `/thoth:report` | 生成进展报告 | `current as design intent` |
| `/thoth:dashboard` | 启停 dashboard | `current as design intent` |

### Important original behavioral details

#### `/thoth:init`

原始蓝图中的关键细节：

- 预条件是 git repo 存在且尚未初始化
- 通过 3 批问题收集项目名、结构、dashboard 配置
- 生成 `.research-config.yaml`、`.agent-os/`、dashboard、hooks、scripts、tests
- 自动安装依赖并验证

今天的解释：

- “问问题再生成”的姿势依然重要
- 但“发现已有结构就直接拒绝或直接生成”的心智模型已经不够
- 后续应升级为：
  - audit
  - infer
  - preview
  - itemized questions
  - apply
  - rollback

#### `/thoth:run`

原始蓝图强调：

- 单个聚焦修改
- 先 `doctor --quick`
- 机械验证后再提交
- 更新任务状态并同步 todo

这些约束对当前产品面仍然有价值。

#### `/thoth:loop`

原始蓝图中最重要的执行协议输入：

- dual mode:
  - `task`
  - `metric`
- 8-phase loop:
  - Preconditions
  - Review
  - Ideate
  - Modify
  - Commit
  - Verify
  - Guard
  - Decide / Log / Continue
- plateau 检测
- 修改原子性
- metric mode 需要机械 verify command

这些内容后来被 V2 durable runtime 规划进一步增强，而不是完全丢弃。

#### `/thoth:discuss`

原始边界：

- 可以改 YAML、config、DB、`.agent-os/*.md`
- 不能改代码
- 每次修改后自动 validate / sync

这是一个强治理边界设计，后续仍可沿用其原则。

#### `/thoth:review`

原始设计要求：

- 先声明评审角色
- 以第一性原理拆解
- 按 strengths / weaknesses / risks / blind spots 输出
- 重要结论回写 `.agent-os/`

该设计与当前用户偏好高度一致。

## Skills Blueprint

原始蓝图中存在 7 个 skill 层：

- `thoth-core`
- `thoth-audit`
- `thoth-exec`
- `thoth-memory`
- `thoth-counsel`
- `thoth-codex`
- `thoth-testing`

### Still valuable design meaning

| Skill | Original meaning | Lasting value |
| --- | --- | --- |
| `thoth-core` | scope guard, plan mode, task state machine | 命令统一治理层 |
| `thoth-audit` | evidence rules, verification protocol, deliverable checks | 审计与验证合同层 |
| `thoth-exec` | 8-phase execution loop | 执行协议层 |
| `thoth-memory` | git-as-memory, TSV results logging | 运行记忆层 |
| `thoth-counsel` | discuss/review 合同 | 治理与评审层 |
| `thoth-codex` | Codex 委派运行时 | worker delegation 层 |
| `thoth-testing` | golden data + deterministic tests | 测试哲学层 |

### Important historical correction

这些分层作为内部架构是合理的，但不应作为用户可见公开命令或公开内部 skill 直接暴露。这一修正已在当前 repo 中落实。

## Dashboard Blueprint

原始蓝图给出了 7 个 dashboard panel 与 15 个 API endpoint，信息密度很高，应完整保留作为后续产品/Runtime 可视化合同输入。

### 7 panels

1. 总览 + 决策队列
2. 任务面板
3. 里程碑
4. DAG 依赖图
5. 时间线 / Gantt
6. Todo 个人待办
7. 活动日志

### 15 endpoints

- `GET /api/config`
- `GET /api/progress`
- `GET /api/tasks`
- `GET /api/tasks/{id}`
- `GET /api/tree`
- `GET /api/dag`
- `GET /api/milestones`
- `GET /api/timeline`
- `GET /api/activity`
- `GET /api/status`
- `GET /api/todo`
- `POST /api/todo/projects`
- `POST /api/todo/tasks`
- `PATCH /api/todo/tasks/{id}`
- `POST /api/research-events`

### Tech stack

- Backend: FastAPI + uvicorn + pyyaml + jsonschema + SQLite
- Frontend: Vue 3 + TypeScript + Vite + ECharts + Pinia
- Theme: warm-bear

该设计 today 并非全部当前事实，但仍是后续 dashboard / derived index / human visibility 层的重要输入。

## Session Hooks Blueprint

原始蓝图中的 hooks 设计：

- SessionStart:
  - 发现当前 repo 是否已接入 Thoth
  - 输出项目名与 quick status
  - 未初始化则提示 `/thoth:init`
- SessionEnd:
  - 自动做 quick doctor check
  - 发现问题则提醒，但不阻塞

这一设计在 V2 语义下依然成立，只是 detection source 会逐渐从旧布局迁移到 `.thoth/`。

## Testing Blueprint

原始蓝图对测试的要求非常具体，必须保留：

- plugin tests 与 project tests 双层结构
- unit + integration + golden fixtures
- 每个 script 都要有对应测试
- 初始化流程、dashboard API、loop protocol 都要被测
- 测试应 deterministic、无需用户交互

### Plugin test matrix

- `test_validate.py`
- `test_verify_completion.py`
- `test_check_consistency.py`
- `test_sync_todo.py`
- `test_data_loader.py`
- `test_progress_calculator.py`
- `test_database.py`
- `test_init.py`
- `test_doctor.py`
- `test_sync_script.py`
- `test_report.py`
- `test_status.py`
- `test_dashboard_api.py`
- `test_init_workflow.py`
- `test_loop_protocol.py`

### Project-local tests deployed by init

目标项目初始化后，本地还应有一套针对生成脚本和结构的测试。这一思想对 audit-first adopt/init 依然关键，因为 adoption/migration 本身也需要 black-box 验证。

## Implementation Order Blueprint

原始蓝图按 8 个阶段推进：

1. Skeleton
2. Core scripts
3. Golden test data + unit tests
4. Dashboard templates
5. Skills content
6. Commands content
7. Templates + init
8. Integration test

今天看，这个顺序仍有历史价值，尤其可作为后续 V2 重构时拆分里程碑的参考。

## Verification Blueprint

原始蓝图预设的验证路径包括：

- plugin test suite
- fresh temp project init
- generated project validation
- dashboard startup and API probes
- command smoke path
- session hooks behavior

这些仍然是未来做 `.thoth` adoption/runtime 落地时需要保留的黑盒验收面。

## Porting Inputs

### From NeuralShader

原始蓝图明确列出了一批要从 NeuralShader 移植的资产：

- validation / verification / consistency / sync 脚本
- dashboard backend/frontend
- pre-commit config
- session-end checks

这份映射仍然重要，因为当前 repo 与未来 `.thoth` authority runtime 之间的迁移，并不是从零开始，而是沿着 NeuralShader -> current Thoth -> V2 这条链演化。

### From autoresearch

原始蓝图要借用的核心概念包括：

- autonomous loop protocol
- results logging
- plateau detection
- git memory
- guard logic

这些设计资产后来被 decision rounds 中的 durable/unbounded runtime 语义进一步严格化。

## What Must Not Be Misread

以下内容不能再被误读为“当前 repo 已实现事实”：

- 公开 `:codex` 命令变体
- 公开内部 skills
- `init` 仍是直接一键 scaffold 的最终语义
- 旧 `.research-config.yaml` 是长期 authority
- Claude plugin 本身已经等于 V2 durable runtime

## Lasting Value Summary

尽管这份蓝图已部分过时，但它仍是以下主题的高价值输入：

- 命令级 scope guard 与 plan mode 设计
- discuss / review 的行为边界
- loop 的 task / metric 双模执行协议
- dashboard 信息架构
- session hooks
- 测试矩阵与 golden-data 哲学
- 从 NeuralShader / autoresearch 吸收成熟资产的迁移线索
