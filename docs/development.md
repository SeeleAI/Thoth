# Development

This document is the executable development guide for Thoth. Product truth and decisions live in `.agent-os/`; this file explains how to work in the repository.

## Environment

- Node.js: `24.14.0`
- npm: `11.9.0`
- Package manager: npm workspaces
- Runtime direction: TypeScript / Node
- Local toolchain/artifact directory: `.dev/` (ignored)

Install dependencies:

```bash
npm install
```

Root `.npmrc` intentionally sets `ignore-scripts=true`, `audit=false` and `fund=false`.
Desktop tests and packaging therefore initialize the platform Electron binary explicitly with
`npm run setup:electron`; do not weaken the repository-wide install policy to restore dependency
postinstall hooks.
This keeps first-day installs deterministic and prevents optional native lifecycle scripts from
blocking normal development setup. Native/toolchain work must be done through explicit root
scripts such as `package:android:debug-apk`, not through package install side effects.

Do not use pnpm/yarn in this repository unless a future decision changes the package manager.

## Current State

The canonical Workspace / Task / HarnessAdapter main chain is implemented and exercised through source, real Web,
Android Debug APK, AppImage-managed daemon, and real Codex entrypoints. Current milestone, blocker, Release, and
sole-next-action truth remains in `.agent-os/project-index.md`; do not infer it from a package's historical state.

The Foundation gate remains the first development gate and covers:

- `packages/app/highlight`
- `packages/relay`
- `packages/protocol`
- `packages/client`

Daemon, App, Desktop, CLI, TUI, Core, and Drivers have separate owner-level gates because they are outside the
Foundation package set. A green Foundation gate does not by itself prove the complete product or a Release.

## Architecture-First Development

`Simply Is First` means the final architecture must be simple; it does not authorize a simplified implementation.

Before a nontrivial code change, write down in the task or working update:

1. The canonical final module being implemented.
2. Its production API and state owner.
3. The real milestone or architecture risk being tested.
4. The command or product journey that will verify that exact boundary.

Implement final modules in sequence. Prefer a production-correct module A with B still pending over a temporary `A' + B' + C'` path that imitates the complete product and must later be replaced.

Rapid experiments may use fixtures at external provider, network or platform boundaries, but the fixture must enter through the same adapter contract and traverse the same public API, authority state machine and lifecycle as the real product. A test-only RPC, hidden UI, local success factory, provider-name business branch or fallback is not a valid experiment.

When a real implementation misses a target, record the actual value and failure evidence. Diagnose and improve the final module. Do not lower the target, narrow the behavior, add a degraded path or reinterpret acceptance. If the locked architecture itself is wrong, update the canonical architecture decision before implementing a replacement.

## Runtime Isolation

Thoth must run without taking over the reserved local legacy service port.

- Thoth direct daemon default: `127.0.0.1:6688`
- Reserved local legacy daemon port: `127.0.0.1:6767`
- Thoth dev home: `.dev/thoth-runtime/home`
- Thoth desktop dev user data: `.dev/thoth-runtime/user-data`
- Relay test endpoint: `relay.test.thoth.seeles.ai`
- Human web review local entry: `http://127.0.0.1:8082/`
- Human web review public mapping: `http://180.76.242.105:8148/`

Do not stop, restart, migrate or reuse the service on `6767`. Thoth runtime code must not automatically probe `localhost:6767` or `127.0.0.1:6767`; those addresses are allowed only in tests, historical examples or explicit guards that prove Thoth avoids the reserved legacy service.

Use the dev profile helper when starting a local daemon:

```bash
source scripts/dev-home.sh
configure_dev_thoth_home
npm run dev:daemon
```

Or use the root script directly:

```bash
npm run dev:daemon
```

Check isolation:

```bash
npm run smoke:isolation
```

The smoke must show the reserved service still owns `6767`, no Thoth command points to that port, and any listener
on `6688` has a different PID. It does not start a user daemon merely to populate `6688`; when no Thoth daemon is
running, an empty `6688` listener set is valid.

## Human Dogfood UI

The future Thoth I development entry, such as `npm run dev:thoth`, must launch the same user
experience as the current releasable full UI. It may target a local daemon, local providers,
development logs or development config, but the user-facing flow, layout, copy, composer controls,
task cards, stream states and reports must match the releasable product UI.

Humans use that UI for dogfood, review and experience testing. Agents use repository tests,
typechecks, builds and explicit smoke commands as the normal validation path.

Do not build a separate mock, reduced, debug-only or agent-facing UI as the primary Thoth I review
surface.

Current web review entry:

```bash
npm run build:web
THOTH_DAEMON_PROXY_TARGET=127.0.0.1:6688 HOST=0.0.0.0 PORT=8082 npm run serve:web
```

`npm run dev:web:demo` is the shorthand for serving the same real web export on `0.0.0.0:8082`
with the local Thoth daemon WebSocket proxy enabled.
The public mapped URL for this machine is `http://180.76.242.105:8148/`.

## Standard Commands

Run commands through root npm scripts:

```bash
npm run validate:repo
npm run format:check
npm run lint:foundation
npm run build:foundation
npm run typecheck:foundation
npm run test:foundation
npm run check:foundation
```

Formatting and linting:

```bash
npm run format
npm run format:check
npm run lint
npm run lint:fix
```

Repository-local GitHub CLI:

```bash
THOTH_GH_CONFIG_DIR=.dev/gh-royalvice npm run gh -- auth status --hostname github.com
THOTH_GH_CONFIG_DIR=.dev/gh-royalvice npm run gh -- api user
THOTH_GH_CONFIG_DIR=.dev/gh-royalvice npm run gh -- repo view SeeleAI/Thoth-Relay
```

`npm run gh -- ...` wraps the system `gh` binary and forces `GH_CONFIG_DIR` to the ignored
`THOTH_GH_CONFIG_DIR` value, defaulting to `.dev/gh`.
That keeps the Thoth checkout's GitHub login separate from global `~/.config/gh`.
Do not run plain `gh auth login` for repository work.

To create or replace the local login, pass the token through stdin so the token is not placed in
the shell command line:

```bash
printf '%s\n' "$GITHUB_TOKEN" | THOTH_GH_CONFIG_DIR=.dev/gh-royalvice npm run gh -- auth login --hostname github.com --with-token
```

The `.dev/gh*` directories are ignored and must never be staged.

## Provider Authentication And Claude Reauthentication

Provider authentication belongs to the Provider's official control surface. Thoth does not copy,
refresh, or store Claude Code credentials in Workspace authority, Driver receipts, or `.thoth`.

If a Claude login expires, reauthenticate with the official Claude Code CLI on the machine running
the daemon, then start a new Claude Agent in Thoth. A running Claude session keeps the authentication
context with which it started, so reauthentication does not silently replace that session's identity.
After signing in, use Thoth's semantic CLI to recheck availability and the catalog:

```bash
claude
npm run cli -- provider ls
npm run cli -- provider models claude
```

The first command is Provider-owned authentication; the two `npm run cli` commands only query the
Thoth daemon's Provider capability and model projections.

Paseo synchronization uses the repository-local five-stage Skill and exact-SHA reports:

```bash
npm run paseo:inspect -- --repo <official-clone> --from <base-sha> --to <target-sha> --out <ignored-manifest.json>
npm run paseo:verify-provenance -- --manifest <ignored-manifest.json> --classification <ignored-classification.json>
npm run paseo:check-boundaries -- --repo . --base <thoth-base-sha> --out <ignored-boundary-report.json>
```

Raw clones and generated reports stay under ignored `.agent-os/upstreams/` and `.agent-os/artifacts/`. Architecture
changes require a concrete `NTH-CD-*` decision before product-source edits. Integration rebuilds the approved
capability through the current Protocol / Client / Daemon / Core / Drivers / shell owners; it does not cherry-pick
or preserve Paseo authority.

The accepted v0.2.3 review is deliberately not the linear text range between tag commits because v0.2.2 and
v0.2.3 diverge. Its exact source inventory is:

```text
v0.2.2...v0.2.3 --right-only
merge base: 36f38245cab51bbe0b43b6ac42fd41aa757064d9
target:     43cf858c3760679ec9be805ba8b903cdf20f7103
commits:    36
```

Local AppImage automation uses localhost CDP and an isolated daemon. Do not inject an external proxy into that
control path; unset proxy variables or include both `127.0.0.1` and `localhost` in `NO_PROXY`. Hosted Relay
acceptance is different: on Node 24, set `NODE_USE_ENV_PROXY=1` together with this environment's HTTP(S) proxy so
the `ws` stack actually uses it. These are execution-environment rules, not alternate product transports.

Android packaging:

```bash
npm run doctor:android
npm run setup:android-toolchain
npm run package:android:debug-apk
```

The debug APK must keep Thoth identity (`sh.thoth.debug`) and must not request
`android.permission.RECORD_AUDIO`.

Desktop packaging:

```bash
npm run package:desktop:linux-appimage
```

The Linux AppImage is a local artifact under `packages/desktop/release/` and must not be staged.

iOS packaging:

```bash
npm run package:ios:prebuild
npm run package:ios:build
```

`package:ios:build` requires macOS with Xcode.

## Command Discipline

Use root npm scripts as the public command surface. Do not make routine changes by directly invoking `npx oxfmt`, `npx oxlint`, `npx vitest` or `npx tsc`. Direct tool calls are only for debugging a root script failure, and the final report must say so.

Run root build, typecheck, and test scripts that clean shared package outputs serially. In particular, concurrent
commands that both rebuild `packages/protocol/dist` can create a temporary package-not-found failure that does not
represent source behavior.

## Generated And Local Files

Never stage:

- `.dev/`
- `.agent-os/upstreams/`
- `.agent-os/artifacts/`
- `packages/app/android/`
- `packages/app/ios/`
- `packages/desktop/release/`
- `node_modules/`
- build outputs such as `dist/`, `build/`, `.expo/`, `.wrangler/`

Generated Android/iOS native folders are local packaging outputs, not source authority.
