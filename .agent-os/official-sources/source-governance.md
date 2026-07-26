# External Source Governance

## Thoth Reset Note

This directory is now a historical cache from the archived plugin line. It remains useful as a source map, but it is not current product truth for Thoth. Any new implementation decision must revalidate the relevant official page, local source checkout, or live tool behavior before relying on these notes.

## Purpose

This file defines the source-of-truth governance protocol for external official materials concerning `Codex` and `Claude Code` in this repository. It is the root contract for `.agent-os/official-sources/`.

## Truth Model

Platform knowledge concerning `Codex` and `Claude Code` is divided into three layers of truth:

1. Official authority
   - The official documentation page itself
2. Repo-local cached synthesis layer
   - `.agent-os/official-sources/*.md`
3. Thoth design inference layer
   - The design, product, and migration implications of these platform capabilities for the current repo

Do not conflate these layers:

- Do not present Thoth inferences as official facts
- Do not present the repo-local synthesis layer as the final authority
- Do not present preview / experimental product descriptions as stable long-term commitments

## Allowed Authority Domains

- OpenAI:
  - `developers.openai.com`
  - `platform.openai.com` only for console/platform pages directly related to official OpenAI documentation
- Anthropic:
  - `code.claude.com`
  - If the official `code.claude.com` documentation explicitly redirects to an official Anthropic product page, that redirect target may be cited, but the redirect chain must be noted

## Freshness Policy

### High-volatility pages

The following topics expire after `30` days by default:

- Background execution / webhooks
- cloud / web / remote / local environments
- subagents
- hooks
- automations
- GitHub Actions
- Any page labeled `preview` / `research preview` / `experimental`

### Concept and best-practice pages

The following topics expire after `60` days by default:

- Explainers on how things work
- Concept pages
- best practices pages

## Mandatory Live-check Rules

In the following situations, check the latest official source first, then provide a conclusion:

1. The local `last_verified_utc` has exceeded `stale_after_days`
2. The page is labeled:
   - `preview`
   - `research preview`
   - `experimental`
3. The question concerns:
   - Whether a capability is supported
   - Current limitations or platform compatibility
   - Configuration fields or feature flags
   - The specific behavior of hooks / subagents / background / remote / local environment
   - The behavior of automation / GitHub Action / cloud/web products
4. The local synthesis conflicts with or has an obvious gap relative to the latest page

## Required Metadata

Every official source incorporated into `.agent-os/official-sources/` must record:

- `source_id`
- `url`
- `status_tag`
- `volatility`
- `stale_after_days`
- `last_verified_utc`
- `must_live_check_when`

## Writing Rules

When writing a synthesis, explicitly distinguish among the following three forms of wording:

- Official fact:
  - Use `The official page currently states that...`
  - Or `As of <last_verified_utc>, the page states that...`
- Local synthesis:
  - Use `This repository synthesizes it as...`
- Thoth inference:
  - Use `The design implication for Thoth is...`

## Conflict Resolution

When a conflict occurs, handle it in the following order:

1. Use the live official page as the authority
2. Update `last_verified_utc` in `platform-index.md`
3. Correct the relevant synthesis
4. If the conflict affects an existing long-term design judgment, record it in `change-decisions.md` or `run-log.md`

## Recovery Path

When recovering platform knowledge, use this fixed order:

1. `AGENTS.md`
2. This file
3. `platform-index.md`
4. The corresponding product deep dive
5. The latest official page

## Scope Boundary

This file governs only:

- OpenAI Codex
- Official OpenAI API capabilities related to agentic / background / webhook functionality
- Anthropic Claude Code

It does not govern:

- Third-party blogs
- Community posts
- Unofficial restatements
- Outdated understandings from user chat history
