# Claude Code Runtime And Platforms

## Purpose

本文件综合解析 Anthropic 官方关于 `How Claude Code works`、`Claude Code on the web`、`Remote Control`、`Sub-agents`、`Hooks`、`GitHub Actions`、`Best practices`、`Discover plugins`、`Plugins reference` 的当前公开说明。

## Verification Snapshot

- `last_verified_utc`: `2026-04-26T12:11:33Z`
- `sources`: `SRC-ANT-001` ~ `SRC-ANT-016`

## 1. Runtime model

### How Claude Code works

官方解释页当前表达的重点可以概括为：

- Claude Code 是一个 agentic coding environment，而不是单次补全文本工具。
- 它围绕：
  - 会话上下文
  - 工具调用
  - 文件与终端交互
  - 计划与执行循环
  来工作。

它不是什么：

- 不是天然 durable 的 repo-native control plane
- 不是自动跨 session 保持后台长任务 authority 的系统

对 Thoth 的设计含义：

- 当前 `Thoth` 作为 Claude-hosted plugin 是合理的宿主接入方式。
- 但仅靠 Claude Code 本身，不能替代 `.thoth` 想要达成的 durable runtime / repo ledger / lease registry。

## 2. Platform surfaces

### Claude Code on the web

截至本轮核验，官方页面当前明确写的是：

- `Claude Code on the web` 处于 `research preview`

页面表达的关键方向：

- 计划可在 web 端生成和评论
- 用户可在浏览器与远端执行之间切换
- web 端与终端/远程执行面之间有工作流衔接

对 Thoth 的设计含义：

- 这说明 Claude Code 已经有“web planning + remote execution”方向的产品形态。
- 但因为它仍是 `research preview`，任何依赖该能力的设计都必须视为高波动。

### Remote Control

官方文档当前表达的是：

- Claude Code 支持某种远程控制/衔接终端的产品工作流
- 这类能力依赖账号、认证与产品面前提
- 远程控制更接近“把用户带回一个正在运行或可接管的宿主环境”，而不是把 repo 状态本身外包给平台

对 Thoth 的设计含义：

- Remote Control 可以启发“新 session 接管旧执行面”的用户体验设计
- 但不能被等同为 `.thoth` 的 lease transfer 协议

### Agent SDK runtime, sessions, and storage

本轮新增回源了 Claude Code Agent SDK 的 overview / sessions / session storage / hosting / monitoring 页面，和 Thoth 最相关的官方事实是：

- SDK 会创建和恢复长期 session，而不是每轮都新建无状态调用。
- session storage 是显式概念，官方提供持久化与恢复路径。
- hosting 文档明确区分 session owner、server process，以及 sleep/wake 生命周期。
- session continuity 不只包含消息，还包括工具状态与运行中的 shell 上下文。

对 Thoth 的设计含义：

- Claude Code 宿主侧确实已经提供“跨 turn 持续会话”的官方 substrate，这比单纯 CLI prompt loop 更接近长时自主运行。
- 但它的 authority 仍是宿主级 session/runtime，不是 repo-native project ledger。
- 对 Thoth 来说，最好的关系不是二选一，而是：
  - Claude session/storage 负责宿主连续性
  - `.thoth/runs/*` 负责项目级真相、可审计恢复点和跨宿主接管

## 3. Extension and specialization

### Sub-agents

官方文档当前表达的重点：

- Claude Code 支持 sub-agents，用于分担研究或并行上下文工作
- sub-agents 与 task/tool 调用模型关联紧密
- 官方文档显式区分 foreground subagent 与 background subagent，且子代理拥有独立上下文窗口与独立工具轨迹

对 Thoth 的设计含义：

- 这与“外部 worker / 子任务执行体”的心智模型兼容
- 但 sub-agent 不是 durable authority，也不是项目级真相层

### Shell and monitor

本轮回源 `Agent SDK monitoring` 与 `hosting` 页面后，和长时任务最相关的信号是：

- Claude Agent SDK 有专门的 `Monitor` 工具，定位就是观察与跟踪长时间运行的 bash 进程。
- 官方文档明确强调 shell 状态会在会话中保留，这意味着后续步骤可以继续使用同一终端上下文。
- 监控面不仅是“看日志”，而是支持对进行中的 shell 工作做进度观察、状态判断和后续接续。
- 这套能力建立在会话与宿主 runtime 上，而不是建立在 repo 本身。

对 Thoth 的设计含义：

- 如果目标是让 live session 更稳定、更像“可持续自主运行”，Claude 宿主目前给出的最强官方抓手就是 persistent shell + monitor + session storage。
- Thoth 不应该重复发明一个宿主内 shell monitor；它更应该消费这些宿主信号，把关键状态折叠进 `.thoth/runs/*`。
- 当 Claude session 丢失、进程漂移或宿主升级导致状态断裂时，恢复 authority 应回到 `.thoth`，而不是假设 Monitor 本身就是最终真相。

### Skills and custom commands

本轮重新核验 `skills` / custom commands 官方文档后，和 Thoth 直接相关的结论是：

- `.claude/commands/*.md` 与 skill 走的是同一机制
- slash command 本质上仍是 prompt-backed skill，而不是宿主硬编码命令
- custom command 支持 shell preprocessing 与 `$ARGUMENTS`
- 若 shell preprocessing 被策略禁用，命令内容会被替换成类似 `[shell command execution disabled by policy]`，而不是静默成功

对 Thoth 的设计含义：

- Claude `/thoth:*` 不能只放说明文，否则 Claude 会把命令当“让模型自己完成任务”的提示
- 要想让 `/thoth:*` 真正落到 repo runtime，必须在命令 surface 中桥接 repo-local CLI，再让 Claude只做结果总结
- 这也意味着自测不能只看“Claude 回复得像成功了”，必须验证 bridge 真事件和 canonical authority 文件

### Permissions

本轮重新核验 `permissions` 官方文档后，和 Thoth 直接相关的结论是：

- `dontAsk` 会自动拒绝所有未被预先允许的工具调用
- `.claude/settings.local.json` 是每个项目、每个开发者的本地允许规则入口，适合放不进 Git 的 trusted allowlist
- 权限优先级是：managed > CLI args > `.claude/settings.local.json` > `.claude/settings.json` > user settings
- Bash allow 规则可以用于让特定受信脚本在 `dontAsk` 下无交互执行

对 Thoth 的设计含义：

- Claude host 自测若想稳定验证 `/thoth:*` 真执行面，就不能依赖人工点批准
- 正确路径是在临时测试仓中写入仅放行 Thoth bridge 脚本的 `.claude/settings.local.json`
- 这类 allowlist 只是宿主权限层，不是 `.thoth` authority，也不应被误写进项目共享真相层

### Plugins and marketplaces

本轮新增回源 `Discover plugins` 与 `Plugins reference` 页面后，和 Thoth 安装升级最相关的官方事实是：

- Claude Code 有官方 plugin directory，也支持从 GitHub、URL 或本地路径添加 marketplace。
- `claude plugin install <plugin@marketplace>` 是安装插件的公开 CLI 路径。
- `claude plugin marketplace update [name]` 用于刷新 marketplace source。
- `claude plugin update <plugin>` 用于把已安装插件更新到最新版本。
- 官方当前明确写明：`plugin update` 后需要 restart，更新才会真正生效。

对 Thoth 的设计含义：

- README 需要把 Claude 的“刷新 marketplace”和“更新已安装插件”分成两个动作，而不是只写 install。
- `thoth@thoth` 里的前一个 `thoth` 是 plugin name，后一个 `thoth` 是 marketplace name；这和 Codex 的 `marketplace add SOURCE / marketplace upgrade NAME` 语义不同，文档必须显式区分。
- 若后续做发布流程硬化，`.claude-plugin/plugin.json` 与 marketplace 元数据中的 version 必须同步维护，否则用户升级路径会失去稳定语义。
- Claude marketplace schema 与 Codex marketplace schema 不是同一份合同；不要把 Codex 的 `policy`、对象型 `source` 或顶层 `interface` 直接塞进 `.claude-plugin/marketplace.json`。

### Hooks

官方 `Hooks` 文档当前非常关键，因为它给出了结构化事件模型。

本轮核验确认的关键信号：

- hooks 是事件驱动的
- 有丰富生命周期事件
- `SessionStart` 与 `SubagentStart` 都有明确输入合同
- `SessionStart` 支持在新建、恢复、清空压缩后等不同来源触发
- hooks 可收到结构化 JSON 输入
- 某些事件支持通过输出控制行为或阻止操作

尤其重要的事实：

- `SessionStart` 可用于会话开始或恢复时注入上下文
- `SubagentStart` / `SubagentStop` 允许观察子代理生命周期
- `PreToolUse` / `PostToolUse` 与通知类 hooks 让外部系统有机会围绕工具调用做校验、记账和告警
- hooks 文档对输入字段和控制语义写得很细

对 Thoth 的设计含义：

- Claude Code hooks 是当前宿主层最值得严肃利用的扩展点之一
- 它很适合做：
  - 会话恢复提示
  - 运行时检查
  - 事件记录
- 但它仍然只是宿主事件扩展面，不等于 repo-native runtime authority

### GitHub Actions

官方文档将 Claude Code 带入非交互式 CI / GitHub 自动化面。

本仓库的综合理解：

- 这提供了“把 Claude Code 放进自动化流水线”的官方支点
- 但它偏非交互执行与仓库协作，不直接提供项目级状态 authority

### Best practices

官方 best practices 页应被视为：

- 推荐性工程实践
- 工作流、提示、上下文与协作的官方建议

它不是什么：

- 不应被误当成稳定 API contract
- 不应覆盖更具体页面里的 feature-level 行为说明

## 4. Cross-cutting distinctions

### Host extensions vs durable runtime

- Claude Code hooks / sub-agents / web / remote / GitHub Actions:
  - 都是宿主产品能力或扩展点
- `.thoth` authority / run ledger / lease registry:
  - 是 Thoth 想要在项目侧建立的控制平面

### Stable vs volatile

高波动内容：

- Claude Code on the web
- Remote Control
- Agent SDK monitoring / hosting / session storage 的实现细节
- hooks 事件矩阵与行为细节
- GitHub Actions 集成方式
- sub-agent operational semantics

相对更稳内容：

- How Claude Code works 的总体运行模型
- Best practices 的方向性建议

## 5. Rules For Using These Notes

- 任何涉及 preview 功能、平台支持、事件输入字段、会话/子代理 hooks 语义的判断，都必须先回官方 latest 页面。
- 不允许把 Claude Code 当前产品体验写成 Thoth 当前已实现能力。
- 若后续要设计 Thoth 的宿主集成层，应优先把 Claude hooks 视为“宿主事件注入面”，而不是“最终真相层”。
