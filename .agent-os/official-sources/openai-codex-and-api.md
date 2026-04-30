# OpenAI Codex And API Notes

## Purpose

本文件综合解析 OpenAI 官方关于 `Background mode`、`Webhooks`、`Codex web/cloud`、`Subagents`、`Subagent concepts`、`Hooks`、`Automations`、`Local environments`、`Config basics/reference`、`Skills`、`Plugins build/install` 的当前公开说明。

authority 仍是官方页面；本文件只是 repo-local 缓存综合层。

## Verification Snapshot

- `last_verified_utc`: `2026-04-30T09:36:50Z`
- `sources`: `SRC-OAI-001` ~ `SRC-OAI-014`

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

截至 `2026-04-25T17:06:00Z` 的官方 latest 页面，`Codex Hooks` 最重要的信号有两个：

- 页面当前不再带 `Experimental` 标记
- 启用需要 `config.toml` feature flag

额外重要点：

- 平台支持信息本身属于高波动区
- 当前文档明确指出 Windows 暂不支持该能力

对 Thoth 的设计含义：

- 即便页面不再写成 `Experimental`，hooks 仍属于高波动宿主扩展点，设计上不应被当成 repo authority 或 durability substrate。
- 在本仓库内，相关文档仍应写成“宿主扩展接入面”，而不是稳定跨版本基线。

### Automations

官方产品方向：

- Codex app 支持把编码工作流自动化。
- 该能力与 GitHub / repo 工作流有强关联。
- 当前页面强调 automations 可以在后台运行，并在专用 worktree 中执行任务。

本仓库的综合理解：

- Automations 更像是托管产品工作流层。
- 它可以启发 Thoth 的自动触发和持续运行设计，但不能代替 repo-native authority。

### CLI shell and approvals

截至本轮回源，官方 `Codex CLI features` 页对“shell / live session”最关键的信号有四个：

- Codex CLI 内置终端工作流，支持直接从交互界面运行 shell 命令。
- CLI 有明确的 approval modes，而不是把 shell 长任务自动升格为 durable supervisor。
- 页面把 shell 交互、补丁编辑、计划与执行视为同一交互式 agent loop 的一部分。
- 官方文档没有把 CLI shell 说成项目级持久 session store 或 durable monitor。

对 Thoth 的设计含义：

- `Codex` 侧更适合作为“当前交互式执行壳”和子任务 worker。
- 若任务需要可恢复的长时运行，不能把 CLI shell 本身当成 durability substrate。
- 更合理的方式是让 `Thoth` 持有 run ledger / heartbeat / attach state，再把 Codex shell 作为前台执行面或短生命周期 worker。

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

### Config basics / reference

截至本轮核验，官方 `Config Basics` / `Config Reference` 页对 Thoth 最关键的信号有四个：

- user-scoped config 路径是 `~/.codex/config.toml`
- project-scoped override 路径是 `<repo>/.codex/config.toml`
- hooks 配置文件路径是 `~/.codex/hooks.json` 或 `<repo>/.codex/hooks.json`
- `Config Basics` 的 sandbox 说明把 writable roots 下的 `.git` 与 `.codex` 标为 protected paths

对 Thoth 的设计含义：

- repo-root `.codex` 是 Codex 宿主保留配置层，不应再被 Thoth 当成受管 authority 目录。
- 若需要为 Codex 生成 hooks 配置，应该把可审计投影放在 `.thoth/derived/`，再由全局或宿主配置层接入，而不是把 `.codex/` 直接纳入 Thoth 的 init/sync 管辖。
- heavy host-real 的 preflight 直接管理 `~/.codex/config.toml` 与 `~/.codex/hooks.json` 是与官方层级一致的。

### Skills

本轮围绕 Thoth 的 Codex public surface 重核后，官方 `Codex Skills` 页对我们最关键的信号有三个：

- `SKILL.md` 仍是公开 skill 的核心入口文件。
- `agents/openai.yaml` 属于官方 metadata 层，可用于 skill 展示与默认提示。
- skill 名称与展示元数据属于宿主呈现层，不应被误当成 runtime authority。

对 Thoth 的设计含义：

- Thoth 的 Codex installable surface 仍应保持单一 skill。
- `openai.yaml` 应进入生成链路与测试护栏，避免手工漂移。

### Plugins build / install

本轮围绕 Codex 官方 plugin 对齐重核后，官方 `Plugins build` / `Install plugins` 页对我们最关键的信号有五个：

- `.codex-plugin/plugin.json` 是官方 plugin manifest。
- plugin `name` 是 manifest identity，同时也是 component namespace 的关键部分。
- manifest 采用标准 metadata 字段和 `interface` 展示层，而不是仓库自定义字段。
- `marketplace.json` 定义 marketplace root、owner 和 plugins 列表。
- 官方当前把“添加 marketplace source”和“从 plugin directory 安装插件”区分成两个层次，而不是 Claude 风格的单条 `plugin install` 叙事。

对 Thoth 的设计含义：

- README 里的 Codex 安装说明必须明确分成两步：
  - 先 `marketplace add` 接入 source
  - 再从 Codex plugin directory 安装或启用 `thoth`
- repo marketplace 应与 installable plugin package 分层：
  - marketplace root 放在 `.agents/plugins/marketplace.json`
  - plugin entry 的 `source.path` 指向 `./plugins/<plugin-name>`
  - installable plugin 自己再持有 `.codex-plugin/plugin.json` 与 `skills/`
- Thoth 的 plugin manifest 应尽量收敛到官方 schema，减少 repo 自定义字段。
- 即使 plugin / skill 展示层做了 UI metadata 收敛，也不能把它们当成 authority；真正 authority 仍是 `.thoth`。

本仓库在本机 `codex-cli 0.125.0` 的实际 CLI 帮助中额外观察到：

- `codex plugin marketplace add` 接受的是 source，例如 `owner/repo[@ref]`
- `codex plugin marketplace upgrade` 接受的是已配置的 marketplace name

对 Thoth 的操作含义是：

- `codex plugin marketplace add SeeleAI/Thoth` 是正确的首次接入命令
- 后续升级不应再写 `SeeleAI/Thoth`，而应写成 `codex plugin marketplace upgrade thoth`

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
- config basics / reference 中的路径、protected-path 与 hooks 接入细节
- cloud/web product behavior
- automations
- CLI shell / approval behavior
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
