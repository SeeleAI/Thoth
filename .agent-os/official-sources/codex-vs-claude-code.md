# Codex Vs Claude Code

## Purpose

本文件不是官方来源本身，而是基于官方来源的 cross-platform 对照层。它只用于帮助 `Thoth` 明确两类宿主/平台能力的差异与设计含义。

## Verification Snapshot

- `last_verified_utc`: `2026-04-23T04:04:51Z`
- `source_basis`:
  - `platform-index.md`
  - `openai-codex-and-api.md`
  - `claude-code-runtime-and-platforms.md`

## Comparison Matrix

| Dimension | OpenAI Codex 官方事实 | Claude Code 官方事实 | 对 Thoth 的设计含义 |
| --- | --- | --- | --- |
| 控制平面 | Codex 提供自己的 cloud/web/app/automation 宿主面，同时也有 API primitive 可配合异步执行 | Claude Code 提供本地/远程/web/CI 宿主面与 agentic tool loop | 两者都能做宿主，但都不等于 `.thoth` 的 repo-native authority |
| 后台长任务 | OpenAI API 用 `background mode + webhooks` 建异步任务模式 | Claude Code 更偏宿主交互与执行面，本身不是 API-style background primitive | 若 Thoth 接 OpenAI API，后台是外部 primitive；若跑在 Claude Code，durability 仍需 Thoth 自己承担 |
| 子代理 | Codex 有 subagents 与 concepts 文档，强调任务拆分与专门化 | Claude Code 有 sub-agents，并与 Task/tool 和 hooks 事件耦合 | 两边都支持子任务/子代理，但子代理都不应被当成 authority |
| Hooks | Codex hooks 当前带 `Experimental` 信号，且支持矩阵高波动 | Claude hooks 已有丰富事件模型和结构化输入合同 | 短中期更值得依赖的是 Claude hooks；Codex hooks 只能谨慎使用 |
| Web 交互面 | Codex 有 cloud/web 产品面 | Claude Code on the web 当前是 `research preview` | 两边都有 web 面，但都属高波动产品层 |
| Local/Remote environments | Codex 公开 local environments 概念，强调接近真实本地环境 | Claude Code 有 remote control 与终端/浏览器衔接 | 两边都在缩短 agent 与真实开发环境的距离，但 authority 仍应放 repo 内 |
| 自动化 | Codex app 有 automations | Claude Code 有 GitHub Actions 路线 | 两边都可作为自动化执行面，但不应直接替代项目状态治理 |
| Authority | OpenAI API background/webhook 不提供 repo ledger | Claude Code 宿主能力也不提供 repo-native ledger | `.thoth` 仍应是项目级 authority 层 |
| 事实波动性 | Codex 产品面近期变化快，hooks 更高波动 | Claude web/remote/hooks/GitHub Actions 同样高波动 | 必须强制 freshness policy，不能只信旧总结 |

## Main Conclusions

### 1. OpenAI API primitives and host products are separate layers

- `Background mode` / `Webhooks` 是 API primitive
- `Codex cloud/web/subagents/hooks/automations/local environments` 是产品宿主层

### 2. Claude Code is a strong host, not a durable truth layer

- Claude Code 的宿主扩展点很强，特别是 hooks/sub-agents/remote/web
- 但项目级 durable truth 仍然应该由 Thoth 自己维护

### 3. Thoth should treat both ecosystems as host/execution surfaces

更稳妥的心智模型是：

- OpenAI Codex: worker / execution surface / optional hosted workflow surface
- Claude Code: current host shell / event surface / execution surface
- `.thoth`: future project authority / durable runtime / recovery plane

## Guardrails

- 不允许写成“Codex 或 Claude Code 已经天然提供 `.thoth` 所需全部 runtime contract”
- 不允许写成“某平台当前 preview 行为是长期稳定承诺”
- 一切具体能力与限制都要回 `platform-index.md` 查 freshness，再决定是否 live-check
