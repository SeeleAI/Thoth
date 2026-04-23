# External Source Governance

## Purpose

本文件定义 `Codex` 与 `Claude Code` 外部官方资料在本仓库中的真源治理协议。它是 `.agent-os/official-sources/` 的根合同。

## Truth Model

围绕 `Codex` 与 `Claude Code` 的平台知识，分三层真相：

1. 官方 authority
   - 对应官方文档页面本身
2. repo-local 缓存综合层
   - `.agent-os/official-sources/*.md`
3. Thoth 设计推论层
   - 当前 repo 对这些平台能力的设计含义、产品含义、迁移含义

禁止混淆：

- 不允许把 Thoth 推论写成官方事实
- 不允许把 repo-local 综合层写成最终 authority
- 不允许把 preview / experimental 产品说明写成稳定长期承诺

## Allowed Authority Domains

- OpenAI:
  - `developers.openai.com`
  - `platform.openai.com` 仅限与官方 OpenAI 文档直接相关的控制台/平台页面
- Anthropic:
  - `code.claude.com`
  - 若 `code.claude.com` 官方文档明确跳转到 Anthropic 官方产品页，可引用该跳转目标，但必须注明跳转链路

## Freshness Policy

### High-volatility pages

以下主题默认 `30` 天过期：

- 背景执行 / webhooks
- cloud / web / remote / local environments
- subagents
- hooks
- automations
- GitHub Actions
- 任何带 `preview` / `research preview` / `experimental` 标签的页面

### Concept and best-practice pages

以下主题默认 `60` 天过期：

- 运行原理类 explainers
- 概念页
- best practices 页

## Mandatory Live-check Rules

以下场景必须先回官方 latest，再给结论：

1. 本地 `last_verified_utc` 已超出 `stale_after_days`
2. 页面被标为：
   - `preview`
   - `research preview`
   - `experimental`
3. 问题涉及：
   - 是否支持某能力
   - 当前限制或平台兼容性
   - 配置字段或 feature flag
   - hooks / subagents / background / remote / local environment 的具体工作方式
   - automation / GitHub Action / cloud/web 产品行为
4. 本地综合结论与最新页面存在冲突或明显缺口

## Required Metadata

任何被吸收到 `.agent-os/official-sources/` 的官方来源，都必须记录：

- `source_id`
- `url`
- `status_tag`
- `volatility`
- `stale_after_days`
- `last_verified_utc`
- `must_live_check_when`

## Writing Rules

写综合解析时必须显式区分三种句式：

- 官方事实：
  - 使用 `官方页面当前说明为...`
  - 或 `截至 <last_verified_utc>，该页面表述为...`
- 本地综合：
  - 使用 `本仓库将其归纳为...`
- Thoth 推论：
  - 使用 `对 Thoth 的设计含义是...`

## Conflict Resolution

当出现冲突时，处理顺序如下：

1. 以 live 官方页面为准
2. 更新 `platform-index.md` 的 `last_verified_utc`
3. 修正相关综合解析
4. 若冲突影响已有长期设计判断，在 `change-decisions.md` 或 `run-log.md` 记账

## Recovery Path

涉及平台知识恢复时，顺序固定为：

1. `AGENTS.md`
2. 本文件
3. `platform-index.md`
4. 对应产品详解
5. 官方 latest 页面

## Scope Boundary

本文件只治理：

- OpenAI Codex
- OpenAI API 中与 agentic / background / webhook 相关的官方能力
- Anthropic Claude Code

不治理：

- 第三方博客
- 社区帖子
- 非官方转述
- 用户聊天记录中的旧认知
