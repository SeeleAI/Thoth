# Change Decisions

## Purpose

Append-only 记录用户后续拍板与解释变化，不通过偷偷改写 `requirements.md` 来掩盖方向变化。

## Entries

- `CD-001` `2026-04-22` `[accepted]`: Thoth V2 的控制平面采用 `Thoth 主控`，外部 Codex 仅作每轮或显式子任务 worker
- `CD-002` `2026-04-22` `[accepted]`: 运行时真相模型为“repo ledger 为权威，SQLite 仅为派生索引/缓存”
- `CD-003` `2026-04-22` `[accepted]`: `/thoth:init` 的目标语义是“先审计，再 preview，再 apply”，而不是盲目 scaffold
- `CD-004` `2026-04-23` `[accepted]`: `dev` 分支保留开发态文档系统，`main` 不保留 `AGENTS.md`、`CLAUDE.md`、`.agent-os/`
- `CD-005` `2026-04-23` `[accepted]`: `dev -> main` 的默认集成策略为 `cherry-pick`
- `CD-006` `2026-04-23` `[accepted]`: 当前公开命令面保持显式 `/thoth:*`，内部协议层与内部 worker 不暴露为公开 slash surface
- `CD-007` `2026-04-23` `[accepted]`: `Codex` / `Claude Code` 平台知识采用“官方 docs 为 authority，仓库文档为缓存综合层”的治理模型
- `CD-008` `2026-04-23` `[accepted]`: dashboard 的长时运行真相采用 `task-first UI + run-ledger truth + smart polling` 模型
- `CD-009` `2026-04-23` `[accepted]`: 所有默认开发工作都在 `dev`，未经用户明确批准不得直接修改 `main`
- `CD-010` `2026-04-23` `[accepted]`: Thoth 的验证体系采用“双层门槛 + repo-real 默认 + host-real 自动追加”模型
- `CD-011` `2026-04-23` `[accepted]`: Codex 分发面按官方 plugin manifest/schema 对齐，但不改动 Claude Code 公开 surface 与 `.thoth` authority 边界
- `CD-012` `2026-04-23` `[accepted]`: `/thoth:init` 必须升级为 audit-first adopt/init
- `CD-013` `2026-04-23` `[accepted]`: 新功能开发必须同步兼顾 Claude Code 与 Codex，且开发完成后必须完成 `dev -> main -> push both -> update local installs` 收尾
- `CD-014` `2026-04-24` `[accepted]`: 严格任务执行模型固定为 `Decision -> Contract -> compiler-generated Task`，`run` / `loop` 默认只接受 `--task-id`
- `CD-015` `2026-04-24` `[accepted]`: 仓库的唯一保留上游切换为 `https://github.com/SeeleAI/Thoth`
- `CD-016` `2026-04-24` `[accepted]`: 公开仓库不保留个人邮箱、私人本地路径或外部项目来源链
- `CD-017` `2026-04-25` `[accepted]`: pytest 测试面固定分为 `light` / `medium` / `heavy` 三层；`light` 目标 `20s` 内、`medium` 目标 `2` 分钟内且包含 `light`、`heavy` 为全量，用于重构和最终收口
- `CD-018` `2026-04-25` `[accepted]`: `thoth/selftest.py` 的 heavy 主门禁改为最小 deterministic Python repo + 明确 validator + review-to-loop 闭环；不再把前端浏览器链路作为命令语义主证明
- `CD-019` `2026-04-25` `[accepted]`: 本轮只做 Thoth 整体代码简化；前提是不能丢功能、不能破坏既有目标与治理约束、不能放松现有验收语义
- `CD-020` `2026-04-25` `[accepted]`: Thoth 的设计要按高维分层重新冻结；`contract` 只是其中一层，层与层之间必须清晰解耦，且协议/数据高度确定
- `CD-021` `2026-04-25` `[accepted]`: 本轮只有在 `Codex-only` closing gate 真实通过后才算结束；之后仍必须按约束完成 `dev -> main -> push both`
- `CD-022` `2026-04-25` `[accepted]`: 本轮最高层骨架固定为 `Surface / Plan / Run / Observe`；其内部只保留七个实现子层，host difference 只允许停留在 `Surface / Host Adapter`
- `CD-023` `2026-04-25` `[accepted]`: 结果模型固定为 `RunResult + TaskResult`；run ledger 的长期 canonical 文件集固定为 `run.json`、`state.json`、`events.jsonl`、`result.json`、`artifacts.json`
- `CD-024` `2026-04-25` `[accepted]`: `TaskResult` 是长期存在但可重建的 task 当前态文件；`sync` 允许按 run 历史重建它，但不得伪造或改写历史 `RunResult`
- `CD-025` `2026-04-25` `[accepted]`: `review` 的 public contract 固定为 live-only；`loop` 只允许消费同 `task_id + target` 且晚于 `TaskResult.last_closure_at` 的 review findings
- `CD-026` `2026-04-25` `[accepted]`: 旧内部模块路径不做兼容保留；`thoth/runtime.py`、`thoth/task_contracts.py`、`thoth/project_init.py`、`thoth/claude_bridge.py`、`thoth/host_hooks.py` 直接从主实现中删除，全部切到新包级实现
- `CD-027` `2026-04-25` `[accepted]`: 本轮 closeout 先删除临时目录并提交当前 `dev` 工作，再只执行 `push origin dev`；`main` 的 cherry-pick、`push origin main` 与本机安装刷新暂缓，等待用户后续批准
- `CD-028` `2026-04-27` `[accepted]`: 若 `run` / `loop` 缺少 `--task-id`，Thoth 必须严格拒绝执行；只允许基于用户给出的 prompt 召回最接近的 `3` 个现有 task 候选并立即停下，禁止创建任何新 task，禁止在未拿到 `task-id` 前触碰项目代码
- `CD-029` `2026-04-27` `[accepted]`: `run` 固定为一次 `plan -> exec -> validate -> reflect` 的 Python 机械状态机；`loop` 固定为父级 bounded orchestrator，每轮显式创建独立 child `run`，预算来自 task authority 的 `runtime_contract.loop.*`，且 validator 输出必须满足严格 JSON schema
- `CD-030` `2026-04-28` `[accepted]`: 用户已批准按既定分支治理约束完成本轮收尾，即在 `dev` 上提交完整变更、仅将发布面代码 `cherry-pick` 到 `main`，并推送两个分支
- `CD-031` `2026-04-28` `[accepted]`: `heavy` 的关闭门语义重定义为“双宿主 public-command conformance gate”而不是“真实开发闭环 gate”；`heavy` 不再重跑 `hard`，总预算固定为 `300s`，固定命令矩阵为 `init/status/doctor/discuss/run/review/dashboard/loop/sync`，其中 `run/loop` 只验证 `--sleep` handoff / watch / stop 协议，`review` 必须 exact-match 固定单 finding，且不允许改动 probe repo 的 `tracker/` 源码
- `CD-032` `2026-04-28` `[accepted]`: 当前公开验证合同改为“atomic selftest cases + targeted pytest runs”。`python -m thoth.selftest` 只允许显式 `--case` 列表，发布/回归/关闭门都必须枚举 case IDs；`pytest` 默认只允许显式 file/nodeid 或 `--thoth-target`，裸 `pytest`、目录级 `pytest` 与 `--thoth-tier` broad runs 默认失败，只有 `--thoth-allow-broad` 或 `THOTH_ALLOW_BROAD_TESTS=1` 才允许豁免；仓库同时提供 `thoth/test_targets.py` 与 `scripts/recommend_tests.py` 作为固定推荐入口
- `CD-033` `2026-04-29` `[accepted]`: 统一对象图与 Agent Runtime Kernel 成为新的实现合同：`.thoth/objects/<kind>/<object_id>.json` 是唯一 canonical object authority；删除独立 `Contract` kind；`work_item.payload` 承载 goal、constraints、execution plan、eval、runtime policy 与 decisions；`run` 固定绑定 `work_id@revision` 且只做最小 phase chain；`loop` / `orchestration` / `auto` 属于 controller service；active run/controller 引用的 work item 在 terminal 前完全不可修改
- `CD-034` `2026-04-29` `[accepted]`: 本轮 Runtime Kernel 关闭门只包含核心五项 selftest：`discuss.subtree.close`、`run.phase_contract`、`run.locked_work`、`loop.controller`、`observe.object_graph`。`auto` / `orchestration` 保留已有代码、public surface 与测试覆盖，但本轮不深化、不 refactor、不纳入关闭门。
- `CD-035` `2026-04-29` `[accepted]`: 发布后本机安装刷新必须走远端 marketplace upgrade/update；禁止用本机 checkout、cache、临时目录、`rsync` 或其他本地覆盖方式刷新 Claude Code / Codex 的 Thoth 安装。若远端 upgrade/update 失败，只记录 blocker 与真实输出，不做本地兜底覆盖。
