[English](./README.md) | [简体中文](./README.zh-CN.md)

<div align="center">
  <h1>🐦 Thoth — Dashboard-First Runtime for Autoresearch</h1>
  <img src="assets/thoth.png" width="80%" alt="Thoth 标志" />
  <p><strong>面向 autoresearch 的 dashboard-first 编排运行时。</strong></p>
  <p>把容易漂移的 agent 工作收敛成 durable runs、locked work items 和可裁决的结果。</p>
  <p>
    <img alt="运行时 Dashboard First" src="https://img.shields.io/badge/runtime-dashboard--first-4B5563?style=for-the-badge&labelColor=3F3F46&color=0F766E" />
    <img alt="模式 Autoresearch" src="https://img.shields.io/badge/mode-autoresearch-4B5563?style=for-the-badge&labelColor=3F3F46&color=B45309" />
    <img alt="引擎 Orchestration" src="https://img.shields.io/badge/engine-orchestration-4B5563?style=for-the-badge&labelColor=3F3F46&color=2563EB" />
    <img alt="可信 Work Locked" src="https://img.shields.io/badge/trust-work--locked-4B5563?style=for-the-badge&labelColor=3F3F46&color=6D28D9" />
  </p>
  <p>
    <img alt="Claude Code Plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-4B5563?style=flat-square&labelColor=3F3F46&color=0284C7" />
    <img alt="Codex Plugin" src="https://img.shields.io/badge/Codex-plugin-4B5563?style=flat-square&labelColor=3F3F46&color=65A30D" />
    <img alt="Ready Work --work-id" src="https://img.shields.io/badge/tasks-strict%20--work--id-4B5563?style=flat-square&labelColor=3F3F46&color=7C3AED" />
    <img alt="Version 0.1.4" src="https://img.shields.io/badge/version-0.1.4-4B5563?style=flat-square&labelColor=3F3F46&color=0369A1" />
    <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-4B5563?style=flat-square&labelColor=3F3F46&color=84CC16" />
  </p>
  <img src="assets/thoth-teaser-figure-v2.png" width="100%" alt="Thoth 概念首屏图" />
</div>

## 控制平面一览

```text
                               THOTH CONTROL PLANE

                    Claude Code surfaces      Codex surfaces
                 /thoth:* command set        $thoth command set
                              \                 /
                               \               /
                                +-------------+
                                              |
                                              v

+----------------------------------------------------------------------------+
| Layer 1. Host Surface                                                      |
|                                                                            |
|  init   discuss   run   loop   review   status   dashboard                 |
|  report doctor    sync  extend                                             |
+----------------------------------------------------------------------------+
                                              |
                                              v
+----------------------------------------------------------------------------+
| Layer 2. Planning Authority                                                |
|                                                                            |
|  init      -> bootstrap .thoth authority and host projections              |
|  discuss   -> record discussions, decisions, and work items                |
|  sync      -> regenerate projections and derived surfaces                  |
|                                                                            |
|  Discuss -> Decision -> Work Item Object Graph                             |
|                                         |                                  |
|                                         v                                  |
|                               Ready Work (--work-id)                      |
+----------------------------------------------------------------------------+
                                              |
                                              v
+----------------------------------------------------------------------------+
| Layer 3. Execution Runtime                                                 |
|                                                                            |
|  run      -> one durable execution packet                                  |
|  loop     -> one durable recoverable loop packet                           |
|  review   -> structured findings through the same protocol                 |
|                                                                            |
|                           +---------------------------+                    |
|                           | Ready Work (--work-id)   |                    |
|                           +-------------+-------------+                    |
|                                         |                                  |
|                              +----------+----------+                       |
|                              |                     |                       |
|                              v                     v                       |
|                            Run                   Loop                      |
|                              |                     |                       |
|                              +----------+----------+                       |
|                                         |                                  |
|                                         v                                  |
|                 Run Ledger / Events / Artifacts / Result                   |
|                                         |                                  |
|                                         v                                  |
|                  Mechanical Validation / Acceptance                        |
|                                                                            |
|  attach   watch   resume   stop                                            |
+----------------------------------------------------------------------------+
                                              |
                                              v
+----------------------------------------------------------------------------+
| Layer 4. Read Surfaces                                                     |
|                                                                            |
|  dashboard -> human-visible runtime workbench                              |
|  status    -> active / stale / attachable run summaries                    |
|  report    -> derived project truth from current authority                 |
|  doctor    -> health, projection, and runtime-shape audit                  |
|                                                                            |
|                     +-----------+-----------+-----------+-----------+      |
|                     |           |           |           |                  |
|                     v           v           v           v                  |
|                 Dashboard    Status      Report      Doctor                |
+----------------------------------------------------------------------------+

关键约束:
- `.thoth` 是共享 machine/runtime authority
- `.agent-os` 是 human governance layer
- `run` 和 `loop` 都是 strict `--work-id` surface
- `dashboard`、`status`、`report`、`doctor` 是 read surfaces，不写 authority
- 每个 live packet 都必须进入 `complete` 或 `fail`
```

## 为什么是 Thoth

Thoth 是一个 dashboard-first orchestration runtime for autoresearch。它的前提很简单：聊天记录本身不是操作系统，真实状态必须能跨会话保留，执行过程必须可见，完成与否必须能被机械裁决。

## 失败模式表

| 问题 | 为什么重要 |
| --- | --- |
| 工作不持久 | 长时间任务会随着会话结束一起死亡，人去睡觉后 agent 也无法继续工作，而且没有可恢复、可审计的持久状态。 |
| 并行工作不可见 | 多个线程或委托运行会彼此漂移，而人很难知道当前究竟什么在运行。 |
| Agent 会过早宣称完成 | 一段流畅的总结可能掩盖了其实没有任何机械验证通过。 |
| 文档和状态会持续腐化漂移 | 决策、契约和运行时事实会慢慢脱节，最后没人知道哪个层才是 authority。 |

## Thoth 修正机制表

| 机制 | 它做什么 | 对应修正 |
| --- | --- | --- |
| Hooks + watchdog + runtime | 让执行过程始终挂靠到 durable ledger 和可观察的生命周期事件上。 | 工作不持久 |
| Dashboard-first visibility | 在一个统一读面里显示 live、stale、attachable 和 host-specific 的运行时真相。 | 并行工作不可见 |
| Mechanical yes/no acceptance | 用 validator、ledger 和 result payload 强制裁决工作是否真的通过。 | Agent 会过早宣称完成 |
| Object graph + execution system + locked work items | 先冻结边界，再编译成任务，并防止 authority 各层继续漂移。 | 文档和状态会持续腐化漂移 |

## 系统一览

人不应该把注意力花在漏斗里每一粒沙子上。Thoth 让 AI 负责沙漏中段，而 dashboard 只展示最后留下来的金子：decisions、tasks、runs、results，以及当前可裁决的结论。

## 架构流程表

| 阶段 | 目的 | 输入 | 输出 |
| --- | --- | --- | --- |
| Intent | 捕获用户请求和操作边界。 | 人类目标、约束、仓库上下文 | 用于规划的方向 |
| Decision | 在执行漂移之前先锁定关键选择。 | Intent、未决问题、治理约束 | 已记录的 decisions |
| Work Item | 冻结 goal、constraints、execution plan、eval、runtime policy 和 decisions。 | Discussion、decisions、requirements、acceptance 规则 | Ready 或 blocked work item |
| Run | 执行一个 frozen `work_id@revision`。 | Work item、controller policy、host surface | `.thoth/objects/run` 与 `.thoth/runs/<run_id>` ledger |
| Result | 产出机械裁决，而不只是叙述性总结。 | Validator 输出、artifacts、runtime checks | Structured result 和 acceptance evidence |
| Dashboard | 让人无需回放聊天记录就能读取最终状态。 | Ledgers、read model、derived summaries | 可检查的项目真相 |

## 快速开始

1. 在你使用的宿主面安装 Thoth。

```bash
claude plugin marketplace add SeeleAI/Thoth --scope user
claude plugin install thoth@thoth --scope user
codex plugin marketplace add SeeleAI/Thoth
```

对 Codex 来说，`marketplace add` 只是把 marketplace 源接进来。然后还需要在 Codex 的 plugin directory 里安装或启用 `thoth` 插件。

插件安装完成后，这里有意区分两层入口：

- 公开插件入口：`Claude /thoth:*`、`Codex $thoth <command>`，以及插件提供的 shell wrapper `thoth <command>`
- 源码仓开发回退入口：`python -m thoth.cli <command>`

在全新仓库或空目录里，应优先使用插件安装出来的 `thoth` wrapper；`python -m thoth.cli` 只用于你明确想绑定到某个 checked-out Thoth 源码树时。

2. 初始化你希望由 Thoth 接管的仓库。

```text
/thoth:init
$thoth init
```

3. 从一个已编译任务启动第一次 strict run。

```text
/thoth:run --work-id task-1
$thoth run --work-id task-1
```

4. 打开读面。

```text
/thoth:dashboard
$thoth dashboard
```

## 宿主安装与升级

| 宿主 | 首次安装 | 稳定升级 | 关键说明 |
| --- | --- | --- | --- |
| Claude Code | `claude plugin marketplace add SeeleAI/Thoth --scope user`，然后 `claude plugin install thoth@thoth --scope user` | `claude plugin marketplace update thoth`，然后 `claude plugin update thoth --scope user` | `plugin update` 之后需要重启 Claude Code，新版本才会真正生效。 |
| Codex | `codex plugin marketplace add SeeleAI/Thoth`，然后在 Codex 的 plugin directory 里安装或启用 `thoth` | `codex plugin marketplace upgrade thoth` | `add` 接受的是 `SeeleAI/Thoth` 这类 source；`upgrade` 接受的是已配置的 marketplace 名，也就是本仓库里的 `thoth`。 |

## 验证方式

默认开发验证现在是“只跑按需 target”，而不是 broad/full sweep。

### Atomic selftest

- 公开 selftest 入口已经收敛为 atomic-only：

```bash
python -m thoth.selftest --case plan.discuss.compile --case runtime.run.live
```

- 不带 `--case` 直接执行 `python -m thoth.selftest` 会故意失败，并打印当前可用 case catalog。
- 每个 case 都有自己独立的 workdir 和 artifact 目录，JSON 报告按 `case_id` 分项记账，而且任何 case 都不能依赖前一个 case 的副作用。
- 发布门、回归门和关闭门都必须记录显式 case ID 列表，不能再用 `hard`、`heavy` 这类聚合别名代替。
- 当前 catalog 分为两类：一类是 repo-local capability probe，例如 `plan.discuss.compile`、`runtime.run.live`、`runtime.loop.sleep`、`review.exact_match`、`observe.dashboard`、`hooks.codex`；另一类是 host-surface probe，例如 `surface.codex.run.live_prepare`、`surface.claude.loop.stop`。

### Targeted pytest

- 允许的开发态入口：

```bash
python -m pytest -q tests/unit/test_selftest_registry.py
python -m pytest -q tests/unit/test_selftest_helpers.py::test_validate_pytest_invocation
python -m pytest -q --thoth-target selftest-core
```

- 默认禁止：裸 `pytest`、目录级调用例如 `pytest tests/unit`，以及 `pytest --thoth-tier heavy` 这种 broad tier sweep。
- broad runs 只保留给显式的发布/CI 场景，必须额外带 `--thoth-allow-broad`，或设置 `THOTH_ALLOW_BROAD_TESTS=1`。
- `--thoth-tier` 只作为这些豁免 broad runs 的覆盖入口保留，不再是默认开发接口。
- target manifest 固定在 `thoth/test_targets.py`。
- 如需把改动路径翻译成推荐测试，可使用下面的辅助脚本：

```bash
python scripts/recommend_tests.py thoth/observe/selftest/runner.py tests/conftest.py
```

## 命令总表

| 命令 | 宿主入口 | 目的 | 输入 | 结果 |
| --- | --- | --- | --- | --- |
| `init` | `Claude: /thoth:init`<br>`Codex: $thoth init` | 审查仓库并物化 canonical Thoth authority。 | 可选的项目元信息或配置载荷 | `.thoth` authority、生成投影、dashboard 脚手架、脚本与测试 |
| `discuss` | `Claude: /thoth:discuss`<br>`Codex: $thoth discuss` | 在不进入代码执行的前提下记录规划决策。 | 主题、decision payload 或 work payload | 更新后的 discussion、decision 或 work_item 对象，以及生成 docs view |
| `run` | `Claude: /thoth:run`<br>`Codex: $thoth run` | 通过 durable runtime packet 执行一个 ready work item。 | `--work-id`，可选 host 或 executor 控制，以及 attach/watch/stop | 含 state、events、phase results、artifacts 和 terminal result 的 durable run ledger |
| `loop` | `Claude: /thoth:loop`<br>`Codex: $thoth loop` | 通过 controller service 对一个 ready work item 做迭代执行。 | `--work-id`，可选 resume 或 sleep 控制 | Controller object、child run lineage 和有边界的迭代历史 |
| `review` | `Claude: /thoth:review`<br>`Codex: $thoth review` | 在不改源码的前提下产出结构化 findings。 | review target、可选 `--work-id`、可选 executor 控制 | 通过共享协议写入的 structured review result |
| `status` | `Claude: /thoth:status`<br>`Codex: $thoth status` | 展示项目健康状态和活动中的 durable runs。 | 可选 `--json` | 基于 authority 和本机 registry 派生出的共享状态快照 |
| `dashboard` | `Claude: /thoth:dashboard`<br>`Codex: $thoth dashboard` | 启动或管理本地 dashboard runtime。 | 可选动作：`start`、`stop` 或 `rebuild` | 由 `.thoth` ledgers 驱动的本地 dashboard 进程和读接口 |
| `report` | `Claude: /thoth:report`<br>`Codex: $thoth report` | 从当前项目真相生成结构化报告。 | 可选输出格式，例如 `md` 或 `json` | 基于 ledgers 和项目文档派生出的进度报告 |
| `doctor` | `Claude: /thoth:doctor`<br>`Codex: $thoth doctor` | 审计健康状态、生成面和 runtime shape。 | 可选 `--quick` 或 host 检查 | 含验证结论的健康报告 |
| `sync` | `Claude: /thoth:sync`<br>`Codex: $thoth sync` | 重新生成投影并对齐派生 surface。 | 无必需位置参数 | 已刷新的 host projections 和同步后的派生文件 |
| `extend` | `Claude: /thoth:extend`<br>`Codex: $thoth extend` | 在自身测试门槛下演进 Thoth 本体。 | 变更请求或受影响路径 | 保持 public-surface parity 的已验证仓库修改 |

## 为什么值得信任

| 信号 | 你可以检查什么 |
| --- | --- |
| Durable runtime truth | `.thoth/runs/*` 保留 run、state、events、artifacts 和 result payload。 |
| Locked planning authority | ``.thoth/objects/discussion/`、`.thoth/objects/decision/` 和 `.thoth/objects/work_item/` 定义了执行允许做什么。 |
| Script-backed verification | Validators、doctor checks 和 selftests 以机械方式裁决 pass 或 fail。 |
| Shared read model | `status`、`report` 和 `dashboard` 都读取同一 authority，而不是依赖聊天记忆。 |

## 适用对象

| 适合谁 | 为什么 |
| --- | --- |
| 研究和实验型仓库 | 它们需要 durable memory、可回放结果，以及可见的长运行工作。 |
| 用 AI 做真实改动的工程团队 | 它们需要让代码执行、review 和 acceptance 始终可审计。 |
| 想同时保持 Claude Code 与 Codex 一致性的团队 | 它们需要一个 host-neutral command model，而不是两套不断漂移的工作流。 |

## 当前限制

| 当前边界 | 含义 |
| --- | --- |
| `run` 和 `loop` 是 strict `--work-id` surface | 自由文本执行会被有意拒绝。 |
| Host parity 是语义一致，不是 UX 完全一致 | Claude 和 Codex 仍然各自需要安装和本地运行时接线。 |
| Dashboard 是本地服务，不是托管控制平面 | 操作者需要一台能运行 backend 和 frontend 资产的机器。 |
| 首屏 logo 当前主要以 PNG 形态发布 | 后续仍适合补一版干净的 SVG 和 icon family，用于更小尺寸与插件包装场景。 |

---

## 贡献者

由一群希望 AI 工作始终可检查的人公开构建。

[![Contributors](https://contrib.rocks/image?repo=SeeleAI/Thoth)](https://github.com/SeeleAI/Thoth/graphs/contributors)

参与路径：[发起一个 pull request](https://github.com/SeeleAI/Thoth/pulls) 或 [开启一个 discussion](https://github.com/SeeleAI/Thoth/discussions)。

## 许可证

MIT。详见 [LICENSE](LICENSE)。
