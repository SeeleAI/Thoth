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

The repository contains promoted implementation substrate. It is not a complete runnable product yet.

The first development gate is the foundation set:

- `packages/app/highlight`
- `packages/relay`
- `packages/protocol`
- `packages/client`

The daemon, web app export, desktop packaged smoke, Android Debug APK, test relay deployment and Codex provider smoke now have verified development entrypoints. The Thoth MVP business chain is still not implemented, and broader non-foundation packages may still contain incomplete wiring. Do not delete promoted code simply because some broader paths remain expected-broken.

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
curl -sS http://127.0.0.1:6688/api/health
```

The smoke must show `6767` owned by the reserved local legacy daemon and `6688` owned by Thoth.

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
npm run gh -- auth status --hostname github.com
npm run gh -- api user
npm run gh -- repo view SeeleAI/Thoth-Relay
```

`npm run gh -- ...` wraps the system `gh` binary and forces `GH_CONFIG_DIR` to `.dev/gh`.
That keeps the Thoth checkout's GitHub login separate from global `~/.config/gh`.
Do not run plain `gh auth login` for repository work.

To create or replace the local login, pass the token through stdin so the token is not placed in
the shell command line:

```bash
printf '%s\n' "$GITHUB_TOKEN" | npm run gh -- auth login --hostname github.com --with-token
```

The `.dev/gh` directory is ignored and must never be staged.

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
