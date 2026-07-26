# Thoth

Thoth is a local-first task control plane for AI work. It turns a compact user intent into a
clarified, recoverable and reviewable task while keeping provider execution inside configured
Agent Harness sessions.

## MVP Beta

The automated MVP beta channel is fixed at
[`v0.0.0-mvp-beta`](https://github.com/SeeleAI/Thoth/releases/tag/v0.0.0-mvp-beta). The release
contains unsigned desktop packages for macOS, Windows and Linux, a signed universal Android APK,
and a server CLI bundle.

Install the server CLI directly from the GitHub Release with Node.js `24.14.0` or newer:

```bash
npm install -g https://github.com/SeeleAI/Thoth/releases/download/v0.0.0-mvp-beta/thoth-server-cli-0.0.0-mvp-beta.tgz
```

The server CLI is not published to the npm registry. Desktop packages are unsigned in this MVP:
macOS may show a Gatekeeper warning and Windows may show a SmartScreen warning. The Android APK is
signed with a dedicated Thoth MVP beta key so future replacements remain upgrade-compatible.

Fresh MVP installs use the Relay v3 test service at `relay.test.thoth.seeles.ai:443` over TLS.

## Current Status

- Development branch: `agent/dev/mvp`.
- Automated release branch: `release/mvp-actions`.
- Current release version: `0.0.0-mvp-beta`.
- Current implementation: TypeScript / Node npm-workspaces product with daemon, CLI, TUI,
  web/mobile app, desktop shell, relay and provider drivers.
- Current license: `AGPL-3.0-or-later`.
- Copyright holder: `SeeleAI`.
- Package policy: all `@thoth/*` packages remain private and are not published to npm.
- Archived plugin release: <https://github.com/SeeleAI/Thoth/releases/tag/thoth-plugin-final-archive>
- Archived plugin branch: `archive/main-20260627`

## What Thoth Is For

Thoth is designed to reduce the user’s cognitive burden and entry barrier. The user should be able to describe intent naturally; Thoth should clarify only the few decisions that matter, register durable tasks when needed, run asynchronous loops, review results adversarially, and report with evidence.

The core product direction is:

1. One Thoth, not a visible agent dashboard.
2. UI shells are replaceable; authority belongs to Thoth.
3. Tasks are recoverable, reviewable, asynchronous loops.
4. Success is based on acceptance and evidence, not executor self-report.
5. Harnesses such as Claude Code, Codex, ACP-compatible tools, and future providers are adapters, not the source of truth.

## Repository Shape

```text
packages/
  protocol/   shared protocol and event contracts
  client/     shared client SDK and transports
  core/       pure domain model and lifecycle rules
  daemon/     local authority server and scheduler
  drivers/    harness adapters
  tui/        OpenTUI workspace control surface
  app/        shared desktop/mobile app surface
  desktop/    Electron wrapper and daemon lifecycle
  relay/      E2EE WebSocket relay
  cli/        scriptable advanced client
```

The root `package.json` is the canonical command surface. See [`docs/development.md`](docs/development.md),
[`docs/testing.md`](docs/testing.md), [`docs/packaging.md`](docs/packaging.md) and
[`docs/release.md`](docs/release.md) before changing runtime, packaging or release behavior.

## Design Authority

Start here:

- [Core Principles](.agent-os/designs/core-design-principles.md)
- [High-Level Design](.agent-os/designs/thoth-high-level-design.md)
- [MVP User Journey](.agent-os/designs/thoth-mvp-user-journey.md)
- [Engineering Architecture](.agent-os/designs/thoth-engineering-architecture.md)
- [Prompt Contract Seeds](.agent-os/designs/thoth-prompt-contract-seeds.md)

The historical long-form migration note remains available at `.agent-os/designs/thoth-migration-architecture-20260625.md` for historical traceability.

## Development Note

Development follows `.agent-os/project-index.md`, `.agent-os/todo.md` and the canonical design
documents above. The archived plugin runtime is historical only and is not installed or maintained
from this branch.

See [`NOTICE`](NOTICE) and [`.agent-os/upstream-transplant.md`](.agent-os/upstream-transplant.md) for license and upstream seed provenance.
