# Upstream Transplant Ledger

This file records the provenance, boundaries, and expected state of Thoth's current upstream-derived implementation substrate. It is a migration ledger, not a product design document.

## Current Import

1. Upstream project: Paseo
2. Upstream repository: `https://github.com/getpaseo/paseo`
3. Upstream branch: `main`
4. Actual upstream HEAD used: `5fc53c576ef0d4dee55455ccc95660703f71b892`
5. Verification command: `git ls-remote https://github.com/getpaseo/paseo.git refs/heads/main`
6. Source acquisition method: GitHub archive tarball fallback for the exact commit above.
7. Clone/cache time: `2026-06-30`
8. Upstream license: `AGPL-3.0`
9. Thoth active license after import: `AGPL-3.0-or-later`

## Raw Cache Policy

1. Local raw cache path: `.agent-os/upstreams/paseo/`
2. The raw cache is ignored by git through `.gitignore`.
3. The raw cache preserves upstream layout after applying the explicit exclusion policy below.
4. The raw cache is not project authority and must not be staged or committed.
5. The dirty local checkout under `/mnt/cfs/5vr0p6/yzy/harness/paseo` is intentionally not used.

## Exclusion Policy

Excluded from raw cache and tracked source:

1. Any path matching `audio`, `speech`, `voice` or `dictation`.
2. Obvious TTS/STT/PCM/WAV implementation files even when their paths do not contain the full words above.
3. Audio/media files: `*.wav`, `*.webm`, `*.mp3`, `*.m4a`, `*.ogg`.
4. `.git`, `node_modules`, `dist`, `build`, `.expo`, `.next`, `.wrangler`, `coverage`, caches, logs, environment files, tokens, private keys and generated secrets.

Voice-related upstream features are not part of the current Thoth MVP line. Because broad UI/protocol files can still contain stale references after feature-file exclusion, those references are treated as expected-broken promoted-source residue and must be removed during dependency and compile triage before any voice-related capability is exposed.

## Promoted Source Map

Tracked `_paseo` seed directories have been promoted into formal source trees and deleted. The promoted substrate is expected to be non-runnable and temporarily broken until future migration tasks digest it.

1. `packages/protocol/`
   - Source: upstream `packages/protocol`
   - Purpose: protocol messages, fixtures, tests and package metadata substrate.
2. `packages/client/`
   - Source: upstream `packages/client`
   - Purpose: daemon client, WebSocket transport and relay E2EE client substrate.
3. `packages/relay/`
   - Source: upstream `packages/relay`
   - Purpose: Cloudflare Worker relay and WebSocket relay substrate.
4. `packages/cli/`
   - Source: upstream `packages/cli`
   - Purpose: CLI command shape and tests substrate.
5. `packages/app/`
   - Source: upstream `packages/app`
   - Purpose: shared app shell, UI state and client surface substrate.
6. `packages/app/highlight/`
   - Source: upstream `packages/highlight`
   - Purpose: nested UI highlighting substrate; not a root workspace package.
7. `packages/desktop/`
   - Source: upstream `packages/desktop`
   - Purpose: Electron shell, builder config and desktop lifecycle substrate.
8. `packages/drivers/src/agent/`
   - Source: upstream `packages/server/src/server/agent`
   - Purpose: provider registry, Claude, Codex app-server, ACP, OpenCode, session, history, permission and question handling substrate.
9. `packages/daemon/`
   - Source: upstream `packages/server`
   - Purpose: daemon/server shell, WebSocket, managed process, workspace, worktree, persistence and session runtime substrate.
   - Note: the upstream agent subtree is not duplicated here because it is promoted to `packages/drivers/src/agent/`.
10. `packages/core/src/`
    - Source: selected upstream `packages/server/src` non-provider helper areas when clearly reusable.
    - Purpose: storage/projection/context/runtime utility substrate that may later move or be narrowed during compile triage.

## Rename Policy

1. Raw cache keeps upstream text and names.
2. Promoted source uses aggressive semantic renaming where practical:
   - `@getpaseo` -> `@thoth`
   - `getpaseo` -> `thoth`
   - `PASEO` -> `THOTH`
   - `Paseo` -> `Thoth`
   - `paseo` -> `thoth`
3. Formal package identity is normalized to `@thoth/*`, `private: true`, `AGPL-3.0-or-later`, version `0.0.0` and root `workspaces: ["packages/*"]`.
4. Provenance files may still mention the upstream project name when needed for license and source attribution.

## Expected Broken State

1. Imports may point at packages or files that do not exist in the Thoth monorepo yet.
2. Tests may not run.
3. Scripts may reference build outputs, missing dependencies or source paths that are not reconciled yet.
4. Some broad source files may still contain broken voice/audio/speech/dictation references, but those features are not product scope.
5. This is intentional. Promoted source is raw implementation substrate for future migration, not a completed product feature.

## Follow-Up

1. Run dependency and compile triage before claiming any package is buildable.
2. Keep root workspaces constrained to `packages/*` and do not create a root `packages/highlight` workspace.
3. Keep Thoth as a control plane: no direct hidden LLM API calls outside configured harness/provider sessions.
