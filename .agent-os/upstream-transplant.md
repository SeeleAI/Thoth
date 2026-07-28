# Upstream Transplant Ledger

This file records the provenance, boundaries, and expected state of Thoth's current upstream-derived implementation substrate. It is a migration ledger, not a product design document.

## Current Import

1. Upstream project: Paseo
2. Upstream repository: `https://github.com/getpaseo/paseo`
3. Upstream reference: annotated tag `v0.2.2`
4. Accepted upstream target: `b589599a8f21bcc9e4c911603082566ce320a3c8`
5. Tag object: `4759a5baa8a1bf165f282a758081cb49e61a4630`
6. Verification: official full clone, exact tag-object/commit resolution, ancestry from
   `5fc53c576ef0d4dee55455ccc95660703f71b892`, and schema-version-2 manifest/provenance gates.
7. Source acquisition method: repository-local authenticated full clone; capabilities were reconstructed through
   current Thoth ownership rather than mechanically importing the range.
8. Clone/cache reverified: `2026-07-27`
9. Upstream license: `AGPL-3.0`
10. Thoth active license after import: `AGPL-3.0-or-later`

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

## Continuing Synchronization Policy

1. The initial import SHA remains provenance, not a promise that future Paseo patches or directory
   structure will continue to apply cleanly to Thoth.
2. Thoth and Paseo are expected to diverge as Thoth replaces imported structure with its canonical
   Workspace/Task authority, Protocol/Client/Daemon chain, HarnessAdapter, ToolGateway, SQLite shards,
   recovery model and product-specific UX.
3. Future synchronization reviews exact Paseo ranges as capability and engineering-intent inventories.
   It does not use floating `main`, automatic merge, mechanical cherry-pick, or directory replacement as
   the integration model.
4. Local improvements may be adopted or adapted through the current Thoth owner and interface. Any
   upstream change to ownership, formal interfaces, state, storage, protocol, transport, Provider
   lifecycle, package topology, recovery, security or Release topology is architecture-level.
5. Architecture-level changes must be surfaced as a discussion packet before product-source edits. The
   packet records exact commits and paths, upstream intent, Thoth impact and authority conflicts, options,
   recommendation and the required user decision. Integration remains deferred until a concrete
   `NTH-CD-*` decision approves or rejects that exact direction.
6. The canonical `.agent-os/skills/sync-paseo-into-thoth` workflow and its schema-version-2 manifest and
   classification gates enforce this policy for future ranges.

## Paseo v0.2.2 Organic Integration

1. Review base: `5fc53c576ef0d4dee55455ccc95660703f71b892`.
2. Approved target: annotated tag `v0.2.2`, tag object
   `4759a5baa8a1bf165f282a758081cb49e61a4630`, commit
   `b589599a8f21bcc9e4c911603082566ce320a3c8`.
3. Exact range inventory: `393` commits, `1,475` changed paths, `143` architecture candidates and `43`
   required architecture reviews. The range ends at the tag commit and excludes later Paseo `main`.
4. `NTH-CD-076` through `NTH-CD-088` approve selective adaptation through current Thoth ownership and lock the
   rejected/deferred boundaries. The source is an engineering-intent inventory; no mechanical cherry-pick,
   directory replacement or Paseo authority is permitted.
5. The schema-version-2 coherent classification has `14` capability groups. It covers all `393/393` commits,
   explicitly assesses all `143/143` architecture candidates, classifies all `43/43` required candidates as
   architectural and has zero pending reviews or validation failures. Eight merge-only commits with no independent
   combined diff are retained as explicit merge-bookkeeping entries rather than being assigned fabricated paths.
6. Working manifest, classification and provenance reports stay under ignored
   `.agent-os/artifacts/paseo-sync/`. Durable decisions and final evidence are recorded in tracked project ledgers.
7. Organic implementation, all required local Stage 4 gates, corrective exact-SHA workflow `30318942696`, the
   fixed 26-asset desktop-only Beta replacement, public checksum/build-identity checks, and the downloaded AppImage
   product journey pass under verified `NTH-EV-071`. Published Thoth source is
   `cf5067fa3835c498f3842a5b2e371d4cb3b25577`; `NTH-TD-048` is verified.

## Follow-Up

1. Run dependency and compile triage before claiming any package is buildable.
2. Keep root workspaces constrained to `packages/*` and do not create a root `packages/highlight` workspace.
3. Keep Thoth as a control plane: no direct hidden LLM API calls outside configured harness/provider sessions.
