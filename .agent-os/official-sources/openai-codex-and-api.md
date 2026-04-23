# OpenAI Codex And API Notes

## Purpose

本文件综合解析 OpenAI 官方关于 `Background mode`、`Webhooks`、`Codex web/cloud`、`Subagents`、`Subagent concepts`、`Hooks`、`Automations`、`Local environments`、`Skills`、`Plugins build/install` 的当前公开说明。

authority 仍是官方页面；本文件只是 repo-local 缓存综合层。

## Verification Snapshot

- `last_verified_utc`: `2026-04-23T14:55:53Z`
- `sources`: `SRC-OAI-001` ~ `SRC-OAI-011`

## 1. OpenAI API primitives

### Background mode

官方页面当前表达的核心语义：

- 这是 `Responses API` 下的异步执行模式，适合长任务。
- 任务通过 `background=true` 进入后台生命周期，而不是要求客户端一直保持同步等待。
- 文档当前示例已经使用 `gpt-5.4`。
- 该能力与 webhook / 轮询状态读取形成配套模式。
- 当前页面明确写到：`background mode` 与 `zero data retention` 不兼容。

它不是什么：

- 不是 Codex app 自身的任务托管语义
- 不是跨 session 的 repo-native runtime ledger
- 不是 worker orchestration 框架

对 Thoth 的设计含义：

- 如果未来需要接 OpenAI API 层的长任务，`background mode + webhook` 是 API primitive，不是控制平面本身。
- 它可以作为外部异步执行后端，但不能代替 `.thoth` 级别的 repo authority 与 durable ledger。

### Webhooks

官方页面当前表达的核心语义：

- Webhooks 是异步结果通知机制。
- 与后台任务配合时，典型模式是：
  - 创建后台任务
  - 服务端接收回调
  - 校验签名
  - 再根据事件推进本地状态

它不是什么：

- 不是状态存储
- 不是任务编排系统
- 不是 durable run ledger

对 Thoth 的设计含义：

- Webhook 适合做“外部执行完成后的状态注入”，不适合直接充当 Thoth 自己的运行时状态机。

## 2. Codex product/runtime surface

### Codex web / cloud

官方页面当前展示的方向是：

- Codex 作为一个托管的 coding agent 产品面，可把任务放到 cloud/web 环境中处理。
- 重点在“托管执行与多工作面协作”，不是单纯的 API 请求包装。

本仓库的综合理解：

- Codex cloud/web 是宿主产品能力。
- 它与 `Responses API background mode` 是两层不同概念：
  - 前者偏产品工作流
  - 后者偏 API primitive

### Subagents

官方页面与 concepts 页一起表达的核心语义：

- Subagents 是把工作拆给更小的代理单元或专门角色。
- 它们用于隔离上下文、分工协作、提升并行性或专门化程度。

它不是什么：

- 不是独立的最终 authority
- 不是全局控制平面
- 不是自动获得长期 durability 的保证

对 Thoth 的设计含义：

- 这和我们对“Codex 只是 worker / 子任务执行体”的理解一致。
- 但 OpenAI 官方页描述的是 Codex 自己的产品/运行机制，不能直接等同于 Thoth 的 runtime contract。

### Hooks

截至本轮核验，官方 `Codex Hooks` 页最重要的信号有两个：

- 页面带有 `Experimental` 性质
- 启用需要 `config.toml` feature flag

额外重要点：

- 平台支持信息本身属于高波动区
- 当前文档明确指出 Windows 暂不支持该能力

对 Thoth 的设计含义：

- 任何试图把 Codex hooks 当成稳定长期扩展点的设计都必须极其谨慎。
- 在本仓库内，相关文档只能写成“可利用的宿主扩展能力候选”，不能写成稳定基线。

### Automations

官方产品方向：

- Codex app 支持把编码工作流自动化。
- 该能力与 GitHub / repo 工作流有强关联。

本仓库的综合理解：

- Automations 更像是托管产品工作流层。
- 它可以启发 Thoth 的自动触发和持续运行设计，但不能代替 repo-native authority。

### Local environments

官方页面当前表达的重点：

- Codex 可以连接到本地环境执行或读取上下文，而不是只待在纯远端托管空间。
- 这本质上是在定义“产品宿主如何接近你的真实开发环境”。

它不是什么：

- 不是对本地环境拥有永久 authority
- 不是自动等于项目级状态治理

对 Thoth 的设计含义：

- 这与 `.thoth` 想要建立的 repo-level durable truth 并不冲突。
- 更合理的关系是：
  - local environment 提供执行与上下文接近性
  - `.thoth` 提供项目级 authority 与 recovery

### Skills

本轮围绕 Thoth 的 Codex public surface 重核后，官方 `Codex Skills` 页对我们最关键的信号有三个：

- `SKILL.md` 仍是公开 skill 的核心入口文件。
- `agents/openai.yaml` 属于官方 metadata 层，可用于 skill 展示与默认提示。
- skill 名称与展示元数据属于宿主呈现层，不应被误当成 runtime authority。

对 Thoth 的设计含义：

- Thoth 的 Codex public surface 可以继续保持单一 skill。
- `.agents/skills/thoth/` 这层是 Codex-facing projection，不是 `.thoth` authority。
- `openai.yaml` 应进入生成链路与测试护栏，避免手工漂移。

### Plugins build / install

本轮围绕 Codex 官方 plugin 对齐重核后，官方 `Plugins build` / `Install plugins` 页对我们最关键的信号有四个：

- `.codex-plugin/plugin.json` 是官方 plugin manifest。
- plugin `name` 是 manifest identity，同时也是 component namespace 的关键部分。
- manifest 采用标准 metadata 字段和 `interface` 展示层，而不是仓库自定义字段。
- Codex 当前 CLI 的安装/更新主路径是 marketplace source：`marketplace add` / `marketplace upgrade`。

对 Thoth 的设计含义：

- README 里的 Codex 安装说明必须写成 marketplace source 安装，而不能照搬 Claude 的 `install` 子命令叙事。
- Thoth 的 plugin manifest 应尽量收敛到官方 schema，减少 repo 自定义字段。
- 即使 plugin / skill 展示层做了 UI metadata 收敛，也不能把它们当成 authority；真正 authority 仍是 `.thoth`。

## 3. Cross-cutting distinctions

### API primitive vs product runtime

- `Background mode` / `Webhooks`:
  - API primitive
  - 服务于异步执行与回调
- `Codex cloud / subagents / hooks / automations / local environments / skills / plugins`:
  - 产品/宿主运行面
  - 服务于 Codex 的任务执行形态与扩展机制

### Stable vs volatile

高波动内容：

- Codex hooks
- cloud/web product behavior
- automations
- local environments
- subagent operational details
- skills / plugin presentation metadata

相对更稳的内容：

- background mode 作为异步 API primitive 的总体角色
- webhook 在异步通知中的总体角色
- subagent concepts 页给出的抽象心智模型

## 4. Rules For Using These Notes

- 任何涉及具体支持矩阵、配置方式、平台限制、preview/experimental 状态的问题，必须先回官方 latest 页面。
- 不允许把 OpenAI 产品页里的当前交互行为直接当作 Thoth 已实现能力。
- 若后续要设计 `.thoth` 与 OpenAI API 的异步桥接，应优先把 `background mode` 视为外部执行 primitive，而不是内部 authority。
