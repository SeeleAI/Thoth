# Claude Code Runtime And Platforms

## Purpose

This file synthesizes the current public documentation published by Anthropic for `How Claude Code works`, `Claude Code on the web`, `Remote Control`, `Sub-agents`, `Hooks`, `GitHub Actions`, `Best practices`, `Discover plugins`, and `Plugins reference`.

## Verification Snapshot

- `last_verified_utc`: `2026-04-30T09:36:50Z`
- `sources`: `SRC-ANT-001` ~ `SRC-ANT-017`

## 1. Runtime model

### How Claude Code works

The current explanation page can be summarized as emphasizing:

- Claude Code is an agentic coding environment, not a one-shot text-completion tool.
- It operates around:
  - session context
  - tool calls
  - file and terminal interaction
  - planning and execution loops

What it is not:

- It is not inherently a durable repo-native control plane.
- It is not a system that automatically preserves authority for long-running background tasks across sessions.

Design implications for Thoth:

- `Thoth` as a Claude-hosted plugin is currently a reasonable host integration method.
- Claude Code alone, however, cannot replace the durable runtime / repo ledger / lease registry that `.thoth` is intended to provide.

## 2. Platform surfaces

### Claude Code on the web

As of this verification round, the official page explicitly states that:

- `Claude Code on the web` is in `research preview`.

The key directions expressed on the page are:

- plans can be generated and commented on in the web interface
- users can switch between the browser and remote execution
- workflows connect the web interface with the terminal/remote execution surface

Design implications for Thoth:

- This shows that Claude Code already has a product form oriented toward “web planning + remote execution.”
- Because it remains a `research preview`, however, any design that depends on this capability must be treated as highly volatile.

### Remote Control

The current official documentation states that:

- Claude Code supports a product workflow for remote control and connecting to a terminal.
- Such capabilities depend on account, authentication, and product-surface prerequisites.
- Remote Control is closer to “bringing the user back to a running or take-over-capable host environment” than to outsourcing the repository state itself to the platform.

Design implications for Thoth:

- Remote Control can inspire user-experience design in which a new session takes over an old execution surface.
- It must not, however, be equated with `.thoth`'s lease transfer protocol.

### Agent SDK runtime, sessions, and storage

This round added source verification for the Claude Code Agent SDK overview / sessions / session storage / hosting / monitoring pages. The official facts most relevant to Thoth are:

- The SDK creates and restores long-lived sessions rather than creating a new stateless call for every turn.
- Session storage is an explicit concept, and the official documentation provides persistence and restoration paths.
- The hosting documentation clearly distinguishes the session owner, server process, and sleep/wake lifecycle.
- Session continuity includes not only messages, but also tool state and the context of the running shell.

Design implications for Thoth:

- The Claude Code host does provide an official substrate for “sessions that persist across turns,” which is closer to long-running autonomous operation than a simple CLI prompt loop.
- Its authority, however, remains the host-level session/runtime, not a repo-native project ledger.
- For Thoth, the best relationship is not an either-or choice, but:
  - Claude session/storage handles host continuity.
  - `.thoth/runs/*` handles project-level truth, auditable recovery points, and cross-host takeover.

## 3. Extension and specialization

### Sub-agents

The current official documentation emphasizes that:

- Claude Code supports sub-agents for distributing research or parallel context work.
- Sub-agents are closely tied to the task/tool call model.
- The official documentation explicitly distinguishes foreground subagents from background subagents, and subagents have independent context windows and independent tool traces.

Design implications for Thoth:

- This is compatible with the mental model of an “external worker / subtask execution entity.”
- A sub-agent is not durable authority or a project-level truth layer.

### Shell and monitor

After rechecking the `Agent SDK monitoring` and `hosting` pages this round, the signals most relevant to long-running tasks are:

- The Claude Agent SDK has a dedicated `Monitor` tool specifically for observing and tracking long-running bash processes.
- The official documentation explicitly emphasizes that shell state is preserved within a session, which means subsequent steps can continue using the same terminal context.
- The monitoring surface is not merely for “viewing logs”; it supports observing progress, determining status, and continuing in-progress shell work.
- This capability is built on sessions and the host runtime, not on the repository itself.

Design implications for Thoth:

- If the goal is to make a live session more stable and more like “sustained autonomous operation,” the strongest official mechanisms currently offered by the Claude host are persistent shell + monitor + session storage.
- Thoth should not reinvent an in-host shell monitor; it should consume these host signals and fold the key state into `.thoth/runs/*`.
- When a Claude session is lost, a process drifts, or a host upgrade breaks continuity, recovery authority should return to `.thoth`, rather than assuming that Monitor itself is the final source of truth.

### Skills and custom commands

After rechecking the official `skills` / custom commands documentation this round, the conclusions directly relevant to Thoth are:

- `.claude/commands/*.md` and skills use the same mechanism.
- A slash command is fundamentally still a prompt-backed skill, not a host-hardcoded command.
- Custom commands support shell preprocessing and `$ARGUMENTS`.
- If shell preprocessing is disabled by policy, the command content is replaced with something like `[shell command execution disabled by policy]`, rather than succeeding silently.

Design implications for Thoth:

- Claude `/thoth:*` cannot contain only descriptive text; otherwise Claude will treat the command as a prompt to “have the model complete the task itself.”
- For `/thoth:*` to actually reach the repo runtime, the command surface must bridge to the repo-local CLI, after which Claude should only summarize the result.
- This also means self-tests cannot look only at whether “Claude's reply sounds successful”; they must verify real bridge events and canonical authority files.

### Permissions

After rechecking the official `permissions` documentation this round, the conclusions directly relevant to Thoth are:

- `dontAsk` automatically rejects all tool calls that have not been pre-approved.
- `.claude/settings.local.json` is the local allow-rules entry point for each project and developer, and is suitable for trusted allowlists that should not be placed in Git.
- The permission precedence is: managed > CLI args > `.claude/settings.local.json` > `.claude/settings.json` > user settings.
- Bash allow rules can be used to let specific trusted scripts run non-interactively under `dontAsk`.

Design implications for Thoth:

- If Claude host self-tests are to reliably verify the real execution surface of `/thoth:*`, they cannot depend on a human clicking approval.
- The correct path is to write a `.claude/settings.local.json` in a temporary test repository that allows only the Thoth bridge script.
- This kind of allowlist is only a host permission layer; it is not `.thoth` authority and must not be mistakenly written into the project's shared truth layer.

### Plugins and marketplaces

After rechecking the `Discover plugins`, `Plugins reference`, and `Plugin marketplaces` pages this round, the official facts most relevant to Thoth installation and upgrades are:

- Claude Code has an official plugin directory and also supports adding a marketplace from GitHub, a URL, or a local path.
- `claude plugin install <plugin@marketplace>` is the public CLI path for installing a plugin.
- `claude plugin marketplace update [name]` refreshes the marketplace source.
- `claude plugin update <plugin>` updates an installed plugin to the latest version.
- `claude plugin marketplace remove <name>` removes a marketplace; the local CLI currently also supports `claude plugin uninstall <plugin@marketplace> --scope user` for uninstalling a user-level plugin.
- The official documentation currently states explicitly that a restart is required after `plugin update` for the update to take effect.

Design implications for Thoth:

- The README needs to present Claude's “refresh marketplace” and “update installed plugin” as two separate actions, rather than documenting only install.
- The stable Claude Code upgrade command should be written as `claude plugin marketplace update thoth` followed by `claude plugin update thoth@thoth --scope user`; a bare `thoth` is interpreted by the local CLI as the plugin id rather than `thoth@thoth`, and returns `Plugin "thoth" not found`.
- In `thoth@thoth`, the first `thoth` is the plugin name and the second `thoth` is the marketplace name; this differs from the semantics of Codex's `marketplace add SOURCE / marketplace upgrade NAME`, and the documentation must distinguish them explicitly.
- If the release process is hardened later, the version in `.claude-plugin/plugin.json` and the marketplace metadata must be maintained in sync; otherwise the user's upgrade path will lose stable semantics.
- The Claude marketplace schema and Codex marketplace schema are not the same contract; do not place Codex's `policy`, object-shaped `source`, or top-level `interface` directly into `.claude-plugin/marketplace.json`.

### Hooks

The official `Hooks` documentation is currently especially important because it provides a structured event model.

Key signals confirmed this round:

- hooks are event-driven
- there is a rich set of lifecycle events
- `SessionStart` and `SubagentStart` both have explicit input contracts
- `SessionStart` supports triggering from different sources, including a new session, a resumed session, and after context clearing or compaction
- hooks can receive structured JSON input
- some events support controlling behavior or blocking operations through their output

Especially important facts:

- `SessionStart` can be used to inject context when a session starts or resumes.
- `SubagentStart` / `SubagentStop` allow observation of the subagent lifecycle.
- `PreToolUse` / `PostToolUse` and notification hooks give external systems an opportunity to validate, account for, and alert on tool calls.
- The hooks documentation describes input fields and control semantics in considerable detail.

Design implications for Thoth:

- Claude Code hooks are one of the host-layer extension points currently most worth using seriously.
- They are well suited for:
  - session-resumption prompts
  - runtime checks
  - event recording
- They remain only a host event extension surface, however, and are not equivalent to repo-native runtime authority.

### GitHub Actions

The official documentation brings Claude Code into the non-interactive CI / GitHub automation space.

The repository's overall understanding:

- This provides an official foothold for “putting Claude Code into an automated pipeline.”
- It is oriented toward non-interactive execution and repository collaboration, however, and does not directly provide project-level state authority.

### Best practices

The official best practices page should be regarded as:

- recommended engineering practices
- official guidance on workflows, prompts, context, and collaboration

What it is not:

- It should not be mistaken for a stable API contract.
- It should not override feature-level behavior descriptions on more specific pages.

## 4. Cross-cutting distinctions

### Host extensions vs durable runtime

- Claude Code hooks / sub-agents / web / remote / GitHub Actions:
  - are all host product capabilities or extension points
- `.thoth` authority / run ledger / lease registry:
  - are the control plane that Thoth intends to establish on the project side

### Stable vs volatile

Highly volatile content:

- Claude Code on the web
- Remote Control
- implementation details of Agent SDK monitoring / hosting / session storage
- the hooks event matrix and behavior details
- the GitHub Actions integration method
- sub-agent operational semantics

Relatively more stable content:

- the overall runtime model of How Claude Code works
- the directional guidance in Best practices

## 5. Rules For Using These Notes

- Any judgment involving preview features, platform support, event input fields, or session/subagent hook semantics must first be checked against the latest official page.
- Claude Code's current product experience must not be written up as a capability currently implemented by Thoth.
- If Thoth's host integration layer is designed later, Claude hooks should first be treated as a “host event injection surface,” not as the “final truth layer.”
