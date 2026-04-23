# Platform Source Index

## Purpose

本文件是 `Codex` 与 `Claude Code` 官方资料在本仓库内的统一登记表。它的职责是：

- 记录允许作为 authority 的官方来源
- 记录每个来源的波动性与刷新阈值
- 记录最近一次 live-check 时间
- 指向仓库内的综合解析文档

## Authority Rule

- 本文件不是最终 authority。
- 最终 authority 始终是对应的官方页面本身。
- 本文件是 repo-local 缓存索引层，便于恢复、复核和后续维护。

## Verification Snapshot

- `verified_at_utc`: `2026-04-23T04:04:51Z`
- `verified_by`: `Codex`
- `policy`: `high-volatility 30 days / concept-and-best-practice 60 days`

## Source Registry

| source_id | owner | topic | url | local_doc | status_tag | volatility | stale_after_days | last_verified_utc | must_live_check_when | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SRC-OAI-001` | OpenAI | Background mode | https://developers.openai.com/api/docs/guides/background | `openai-codex-and-api.md` | `active` | `high` | `30` | `2026-04-23T04:04:51Z` | 用于异步执行、任务生命周期、后台模式限制判断时 | 当前页面使用 `gpt-5.4` 示例，并明确 `background=true`；ZDR 语义属高波动信息 |
| `SRC-OAI-002` | OpenAI | Webhooks | https://developers.openai.com/api/docs/guides/webhooks | `openai-codex-and-api.md` | `active` | `high` | `30` | `2026-04-23T04:04:51Z` | 用于 webhook 事件、签名校验、回调契约判断时 | 与 Background mode 经常组合使用 |
| `SRC-OAI-003` | OpenAI | Codex web / cloud | https://developers.openai.com/codex/cloud | `openai-codex-and-api.md` | `active` | `high` | `30` | `2026-04-23T04:04:51Z` | 用于 Codex cloud/web 执行能力、交互面、托管流程判断时 | 产品面变化风险高 |
| `SRC-OAI-004` | OpenAI | Codex Subagents | https://developers.openai.com/codex/subagents | `openai-codex-and-api.md` | `active` | `high` | `30` | `2026-04-23T04:04:51Z` | 用于子代理配置、调用方式、职责边界判断时 | 与 concepts 页配套阅读 |
| `SRC-OAI-005` | OpenAI | Codex Subagent concepts | https://developers.openai.com/codex/concepts/subagents | `openai-codex-and-api.md` | `active` | `medium` | `60` | `2026-04-23T04:04:51Z` | 用于解释性概念、设计心智模型判断时 | 概念页比功能页更稳，但仍应定期回源 |
| `SRC-OAI-006` | OpenAI | Codex Hooks | https://developers.openai.com/codex/hooks | `openai-codex-and-api.md` | `experimental` | `high` | `30` | `2026-04-23T04:04:51Z` | 任何 hooks 支持矩阵、配置方式、平台兼容性判断时 | 当前页面标记为 `Experimental`，且需 feature flag；平台支持信息高波动 |
| `SRC-OAI-007` | OpenAI | Codex Automations | https://developers.openai.com/codex/app/automations | `openai-codex-and-api.md` | `active` | `high` | `30` | `2026-04-23T04:04:51Z` | 用于自动化触发、GitHub 集成、计划任务判断时 | 产品工作流可能快速变化 |
| `SRC-OAI-008` | OpenAI | Codex Local environments | https://developers.openai.com/codex/app/local-environments | `openai-codex-and-api.md` | `active` | `high` | `30` | `2026-04-23T04:04:51Z` | 用于本地环境接入、权限/连接方式、宿主边界判断时 | 与 cloud/web/codex app 的边界要最新核对 |
| `SRC-ANT-001` | Anthropic | How Claude Code works | https://code.claude.com/docs/en/how-claude-code-works | `claude-code-runtime-and-platforms.md` | `active` | `medium` | `60` | `2026-04-23T04:04:51Z` | 用于 Claude Code 运行原理、agent loop、tooling model 判断时 | 原理页相对稳，但仍需回源确认 |
| `SRC-ANT-002` | Anthropic | Claude Code on the web | https://code.claude.com/docs/en/claude-code-on-the-web | `claude-code-runtime-and-platforms.md` | `research-preview` | `high` | `30` | `2026-04-23T04:04:51Z` | 任何 web 端能力、限制、远程执行流程判断时 | 当前文档明确为 `research preview` |
| `SRC-ANT-003` | Anthropic | Remote Control | https://code.claude.com/docs/en/remote-control | `claude-code-runtime-and-platforms.md` | `active` | `high` | `30` | `2026-04-23T04:04:51Z` | 用于远程接管、终端/浏览器衔接、认证前提判断时 | 交互路径和账号前提属于高波动产品行为 |
| `SRC-ANT-004` | Anthropic | Claude Code Sub-agents | https://code.claude.com/docs/en/sub-agents | `claude-code-runtime-and-platforms.md` | `active` | `high` | `30` | `2026-04-23T04:04:51Z` | 用于 sub-agent 能力、配置、隔离语义判断时 | 与 hooks 和 task tool 强相关 |
| `SRC-ANT-005` | Anthropic | Claude Code Hooks | https://code.claude.com/docs/en/hooks | `claude-code-runtime-and-platforms.md` | `active` | `high` | `30` | `2026-04-23T04:04:51Z` | 任何 hooks 事件、输入 JSON、控制语义判断时 | 事件矩阵和输入合同对实现影响很大，必须保持最新 |
| `SRC-ANT-006` | Anthropic | Claude Code GitHub Actions | https://code.claude.com/docs/en/github-actions | `claude-code-runtime-and-platforms.md` | `active` | `high` | `30` | `2026-04-23T04:04:51Z` | 用于 CI/CD、PR automation、非交互运行判断时 | 与 best practices、hooks、remote 工作流耦合 |
| `SRC-ANT-007` | Anthropic | Claude Code Best practices | https://code.claude.com/docs/en/best-practices | `claude-code-runtime-and-platforms.md` | `active` | `medium` | `60` | `2026-04-23T04:04:51Z` | 用于推荐性工作流、提示与工程实践判断时 | 这是建议层，不是强合同，但仍属官方指导 |

## Read Path

优先恢复路径：

1. `source-governance.md`
2. 本文件
3. 对应产品详解：
   - `openai-codex-and-api.md`
   - `claude-code-runtime-and-platforms.md`
4. 跨平台对照：
   - `codex-vs-claude-code.md`
5. 真要回答具体特性或限制时，回到原始官方 URL live-check

## Maintenance Note

任何新增外部平台知识，必须先补本索引，再补综合解析，不允许只在某个总结文档里裸写结论。
