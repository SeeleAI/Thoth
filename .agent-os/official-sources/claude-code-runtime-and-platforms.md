# Claude Code Runtime And Platforms

## Purpose

本文件综合解析 Anthropic 官方关于 `How Claude Code works`、`Claude Code on the web`、`Remote Control`、`Sub-agents`、`Hooks`、`GitHub Actions`、`Best practices` 的当前公开说明。

## Verification Snapshot

- `last_verified_utc`: `2026-04-23T04:04:51Z`
- `sources`: `SRC-ANT-001` ~ `SRC-ANT-007`

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

对 Thoth 的设计含义：

- Remote Control 可以启发“新 session 接管旧执行面”的用户体验设计
- 但不能被等同为 `.thoth` 的 lease transfer 协议

## 3. Extension and specialization

### Sub-agents

官方文档当前表达的重点：

- Claude Code 支持 sub-agents，用于分担研究或并行上下文工作
- sub-agents 与 task/tool 调用模型关联紧密

对 Thoth 的设计含义：

- 这与“外部 worker / 子任务执行体”的心智模型兼容
- 但 sub-agent 不是 durable authority，也不是项目级真相层

### Hooks

官方 `Hooks` 文档当前非常关键，因为它给出了结构化事件模型。

本轮核验确认的关键信号：

- hooks 是事件驱动的
- 有丰富生命周期事件
- `SessionStart` 与 `SubagentStart` 都有明确输入合同
- hooks 可收到结构化 JSON 输入
- 某些事件支持通过输出控制行为或阻止操作

尤其重要的事实：

- `SessionStart` 可用于会话开始或恢复时注入上下文
- `SubagentStart` / `SubagentStop` 允许观察子代理生命周期
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
