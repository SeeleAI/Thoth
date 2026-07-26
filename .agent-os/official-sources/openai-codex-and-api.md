# OpenAI Codex And API Notes

## Purpose

This file provides a consolidated analysis of OpenAI's current official public documentation on `Background mode`, `Webhooks`, `Codex web/cloud`, `Subagents`, `Subagent concepts`, `Hooks`, `Automations`, `Local environments`, `Config basics/reference`, `Skills`, and `Plugins build/install`.

The official pages remain authoritative; this file is only a repo-local cached synthesis layer.

## Verification Snapshot

- `last_verified_utc`: `2026-04-30T09:36:50Z`
- `sources`: `SRC-OAI-001` ~ `SRC-OAI-014`

## 1. OpenAI API primitives

### Background mode

The core semantics currently expressed by the official page are:

- This is an asynchronous execution mode under the `Responses API`, suitable for long-running tasks.
- A task enters a background lifecycle through `background=true`, rather than requiring the client to keep waiting synchronously.
- The current documentation examples already use `gpt-5.4`.
- This capability forms a complementary pattern with webhooks / polling for status reads.
- The current page explicitly states that `background mode` is incompatible with `zero data retention`.

What it is not:

- It is not the Codex app's own task-hosting semantics.
- It is not a cross-session repo-native runtime ledger.
- It is not a worker orchestration framework.

Design implications for Thoth:

- If long-running tasks are later connected through the OpenAI API layer, `background mode + webhook` is an API primitive, not the control plane itself.
- It can serve as an external asynchronous execution backend, but it cannot replace `.thoth`-level repo authority and the durable ledger.

### Webhooks

The core semantics currently expressed by the official page are:

- Webhooks are a mechanism for notifying clients of asynchronous results.
- When used with background tasks, the typical pattern is:
  - Create a background task.
  - Receive the callback on the server.
  - Verify the signature.
  - Advance local state based on the event.

What it is not:

- It is not state storage.
- It is not a task orchestration system.
- It is not a durable run ledger.

Design implications for Thoth:

- A webhook is suitable for “injecting state after external execution completes,” but it is not suitable to serve directly as Thoth's own runtime state machine.

## 2. Codex product/runtime surface

### Codex web / cloud

The direction currently presented by the official page is:

- Codex, as a hosted coding-agent product surface, can process tasks in cloud/web environments.
- The focus is “hosted execution and collaboration across multiple work surfaces,” not merely wrapping API requests.

The consolidated understanding in this repository:

- Codex cloud/web is a host-product capability.
- It and `Responses API background mode` are two different conceptual layers:
  - The former is oriented toward product workflows.
  - The latter is oriented toward an API primitive.

### Subagents

The official page and the concepts page together express these core semantics:

- Subagents divide work among smaller agent units or specialized roles.
- They are used to isolate context, divide responsibilities, improve parallelism, or increase specialization.

What it is not:

- It is not an independent final authority.
- It is not a global control plane.
- It is not a guarantee of automatically obtaining long-term durability.

Design implications for Thoth:

- This is consistent with our understanding that “Codex is only a worker / subtask executor.”
- However, the OpenAI official pages describe Codex's own product/runtime mechanisms and cannot be equated directly with Thoth's runtime contract.

### Hooks

As of the official latest page at `2026-04-25T17:06:00Z`, `Codex Hooks` has two most important signals:

- The page no longer carries the `Experimental` label.
- Enabling it requires a `config.toml` feature flag.

Additional important points:

- Platform-support information itself is highly volatile.
- The current documentation explicitly states that Windows does not yet support this capability.

Design implications for Thoth:

- Even though the page no longer labels it `Experimental`, hooks remain a highly volatile host extension point and should not be treated architecturally as repo authority or a durability substrate.
- In this repository, related documentation should still describe it as a “host extension integration surface,” rather than a stable cross-version baseline.

### Automations

Official product direction:

- The Codex app supports automating coding workflows.
- This capability is strongly associated with GitHub / repo workflows.
- The current page emphasizes that automations can run in the background and execute tasks in dedicated worktrees.

The consolidated understanding in this repository:

- Automations are more like a hosted product-workflow layer.
- They can inform Thoth's design for automatic triggering and continuous operation, but cannot replace repo-native authority.

### CLI shell and approvals

As of this round of source rechecking, the official `Codex CLI features` page has four key signals regarding “shell / live session”:

- Codex CLI has a built-in terminal workflow and supports running shell commands directly from the interactive interface.
- The CLI has explicit approval modes; it does not automatically elevate long-running shell tasks into a durable supervisor.
- The page treats shell interaction, patch editing, planning, and execution as parts of the same interactive agent loop.
- The official documentation does not describe the CLI shell as a project-level persistent session store or durable monitor.

Design implications for Thoth:

- The `Codex` side is better suited to serve as the “current interactive execution shell” and subtask worker.
- If a task requires recoverable long-running operation, the CLI shell itself cannot be treated as a durability substrate.
- A more appropriate approach is for `Thoth` to hold the run ledger / heartbeat / attach state, while using the Codex shell as the foreground execution surface or a short-lived worker.

### Local environments

The focus currently expressed by the official page is:

- Codex can connect to local environments to execute or read context, rather than remaining only in a purely remote hosted space.
- This essentially defines “how the product host approaches your real development environment.”

What it is not:

- It does not have permanent authority over the local environment.
- It is not automatically equivalent to project-level state governance.

Design implications for Thoth:

- This does not conflict with the repo-level durable truth that `.thoth` seeks to establish.
- The more appropriate relationship is:
  - The local environment provides execution and proximity to context.
  - `.thoth` provides project-level authority and recovery.

### Config basics / reference

As of this round of verification, the official `Config Basics` / `Config Reference` pages have four key signals for Thoth:

- The user-scoped config path is `~/.codex/config.toml`.
- The project-scoped override path is `<repo>/.codex/config.toml`.
- The hooks configuration file path is `~/.codex/hooks.json` or `<repo>/.codex/hooks.json`.
- The sandbox description in `Config Basics` marks `.git` and `.codex` under writable roots as protected paths.

Design implications for Thoth:

- The repo-root `.codex` is a configuration layer reserved for the Codex host and should no longer be treated by Thoth as a managed authority directory.
- If hooks configuration needs to be generated for Codex, the auditable projection should be placed in `.thoth/derived/` and then connected through the global or host configuration layer, rather than placing `.codex/` directly under Thoth's init/sync governance.
- Having a heavy host-real preflight manage `~/.codex/config.toml` and `~/.codex/hooks.json` directly is consistent with the official hierarchy.

### Skills

After rechecking Thoth's Codex public surface in this round, the official `Codex Skills` page has three key signals for us:

- `SKILL.md` remains the core entry file for a public skill.
- `agents/openai.yaml` belongs to the official metadata layer and can be used for skill presentation and default prompts.
- Skill names and presentation metadata belong to the host presentation layer and should not be mistaken for runtime authority.

Design implications for Thoth:

- Thoth's Codex installable surface should remain a single skill.
- `openai.yaml` should be included in the generation pipeline and test guardrails to prevent manual drift.

### Plugins build / install

After rechecking alignment with official Codex plugins in this round, the official `Plugins build` / `Install plugins` pages have five key signals for us:

- `.codex-plugin/plugin.json` is the official plugin manifest.
- The plugin `name` is the manifest identity and is also a key part of the component namespace.
- The manifest uses standard metadata fields and an `interface` presentation layer, rather than repository-custom fields.
- `marketplace.json` defines the marketplace root, owner, and plugins list.
- The official documentation currently distinguishes “adding a marketplace source” from “installing a plugin from a plugin directory” as two layers, rather than presenting a single Claude-style `plugin install` narrative.

Design implications for Thoth:

- The Codex installation instructions in the README must be clearly divided into two steps:
  - First connect the source with `marketplace add`.
  - Then install or enable `thoth` from the Codex plugin directory.
- The repo marketplace should be layered separately from the installable plugin package:
  - The marketplace root is placed at `.agents/plugins/marketplace.json`.
  - The plugin entry's `source.path` points to `./plugins/<plugin-name>`.
  - The installable plugin itself holds `.codex-plugin/plugin.json` and `skills/`.
- Thoth's plugin manifest should converge as much as possible on the official schema, minimizing repository-custom fields.
- Even if the plugin / skill presentation layer consolidates UI metadata, those items must not be treated as authority; the actual authority remains `.thoth`.

This repository additionally observed in the actual CLI help for local `codex-cli 0.125.0` that:

- `codex plugin marketplace add` accepts a source, such as `owner/repo[@ref]`.
- `codex plugin marketplace upgrade` accepts the name of a configured marketplace.

The operational implications for Thoth are:

- `codex plugin marketplace add SeeleAI/Thoth` is the correct initial connection command.
- Subsequent upgrades should not use `SeeleAI/Thoth` again; they should use `codex plugin marketplace upgrade thoth`.

## 3. Cross-cutting distinctions

### API primitive vs product runtime

- `Background mode` / `Webhooks`:
  - API primitive
  - Serves asynchronous execution and callbacks.
- `Codex cloud / subagents / hooks / automations / local environments / skills / plugins`:
  - Product/host runtime surface.
  - Serves Codex's task-execution forms and extension mechanisms.

### Stable vs volatile

Highly volatile content:

- Codex hooks
- Paths, protected-path details, and hooks integration details in config basics / reference.
- cloud/web product behavior
- automations
- CLI shell / approval behavior
- local environments
- subagent operational details
- skills / plugin presentation metadata

Relatively more stable content:

- The overall role of background mode as an asynchronous API primitive.
- The overall role of webhooks in asynchronous notification.
- The abstract mental model provided by the subagent concepts page.

## 4. Rules For Using These Notes

- For any question involving a specific support matrix, configuration method, platform limitation, or preview/experimental status, consult the official latest page first.
- Current interaction behavior on OpenAI product pages must not be treated directly as an implemented Thoth capability.
- If an asynchronous bridge between `.thoth` and the OpenAI API is designed later, `background mode` should first be treated as an external execution primitive, not internal authority.
