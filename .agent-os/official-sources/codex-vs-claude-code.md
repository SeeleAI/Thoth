# Codex Vs Claude Code

## Purpose

This file is not itself an official source; it is a cross-platform comparison layer based on official sources. It is intended only to help `Thoth` clarify the differences and design implications of the capabilities provided by the two host/platform ecosystems.

## Verification Snapshot

- `last_verified_utc`: `2026-04-30T09:36:50Z`
- `source_basis`:
  - `platform-index.md`
  - `openai-codex-and-api.md`
  - `claude-code-runtime-and-platforms.md`

## Comparison Matrix

| Dimension                     | OpenAI Codex Official Facts                                                                                                                           | Claude Code Official Facts                                                                                                          | Design Implications for Thoth                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control plane                 | Codex provides its own cloud/web/app/automation host surfaces, and also has API primitives that can support asynchronous execution                    | Claude Code provides local/remote/web/CI host surfaces and an agentic tool loop                                                     | Both can serve as hosts, but neither is equivalent to `.thoth`'s repo-native authority                                                                                                                                      |
| Long-running background tasks | OpenAI has API `background + webhook/polling` primitives on one side, while Codex automations run tasks in a background worktree on the other         | Claude Code Agent SDK provides long-lived sessions, a persistent shell, `Monitor`, and session storage                              | If Thoth connects to the OpenAI API, the background behaves more like an external job system; if it runs on Claude, it can make deeper use of the host's persistent sessions, but authority should still reside in `.thoth` |
| Subagents                     | Codex has subagents and concepts documentation, emphasizing task decomposition and specialization                                                     | Claude Code has sub-agents, and the official documentation explicitly distinguishes foreground/background subagents                 | Both support subtasks/subagents, but neither should be treated as authority                                                                                                                                                 |
| Hooks                         | The current Codex hooks page no longer carries the `Experimental` label, but still requires a feature flag, and its support matrix is highly volatile | Claude hooks already have a rich event model, structured JSON, and session/subagent/tool lifecycle events                           | Claude hooks are more worth relying on in the short to medium term; Codex hooks can be integrated but should not bear durability or authority                                                                               |
| Shell / Monitor               | Official Codex materials place greater emphasis on CLI shell interaction and approval modes, without an official durable monitor substrate            | The official Claude Agent SDK explicitly provides a persistent shell and a `Monitor` tool for observing long-running bash processes | Long-running monitoring should preferentially use the Claude host surface; Codex is better suited as an interactive worker and supplementary execution surface                                                              |
| Web interaction surface       | Codex has a cloud/web product surface                                                                                                                 | Claude Code on the web is currently a `research preview`                                                                            | Both have web surfaces, but both belong to a highly volatile product layer                                                                                                                                                  |
| Local/Remote environments     | Codex publicly presents the concept of local environments, emphasizing proximity to a real local environment                                          | Claude Code provides remote control and integration with the terminal/browser                                                       | Both are narrowing the distance between the agent and the real development environment, but authority should still be placed in the repository                                                                              |
| Automation                    | The Codex app has automations                                                                                                                         | Claude Code has a GitHub Actions path                                                                                               | Both can serve as automation execution surfaces, but neither should directly replace project-state governance                                                                                                               |
| Authority                     | OpenAI API background/webhook does not provide a repo ledger                                                                                          | Claude Code host capabilities likewise do not provide a repo-native ledger                                                          | `.thoth` should remain the project-level authority layer                                                                                                                                                                    |
| Volatility of facts           | The Codex product surface has been changing rapidly recently, with hooks being even more volatile                                                     | Claude web/remote/hooks/GitHub Actions are likewise highly volatile                                                                 | A freshness policy must be enforced; old summaries cannot be trusted on their own                                                                                                                                           |

## Main Conclusions

### 1. OpenAI API primitives and host products are separate layers

- `Background mode` / `Webhooks` are API primitives
- `Codex cloud/web/subagents/hooks/automations/local environments` are product host surfaces

### 2. Claude Code is a stronger live-session host, not a durable truth layer

- Claude Code has very strong host extension points, especially hooks/sub-agents/remote and the Agent SDK's session/storage/monitor
- But project-level durable truth should still be maintained by Thoth itself

### 3. Thoth should treat both ecosystems as host/execution surfaces

The safer mental model is:

- OpenAI Codex: worker / execution surface / optional hosted workflow surface / external async primitive bridge
- Claude Code: current host shell / monitor / session surface / execution surface
- `.thoth`: future project authority / durable runtime / recovery plane

## Guardrails

- Do not write that “Codex or Claude Code already natively provides the entire runtime contract required by `.thoth`.”
- Do not write that “a platform's current preview behavior is a long-term stable commitment.”
- For every specific capability and limitation, check freshness in `platform-index.md` before deciding whether a live check is needed.
