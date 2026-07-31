# Release

Thoth has one explicitly authorized MVP beta release flow. This document records that narrow
authorization; it does not authorize npm publishing, app-store submission, production relay deploys
or changes to `main`.

## Manual Authorization Rule

Previewing release contents is not permission to publish. The user explicitly authorized the
`v0.0.0-mvp-beta` flow on `2026-07-16`, including the two branch pushes, GitHub Actions execution,
tag replacement and GitHub Release mutation described below.

The agent must wait for explicit user authorization before any of the following:

- push
- tag creation
- GitHub Release mutation
- npm publish
- desktop installer upload
- Cloudflare deploy
- EAS cloud build
- App Store or Play Store submission

The user renewed the same narrow authorization on `2026-07-17` for the install-flow, branding and
build-ID updater repair on `release/mvp-actions`, including its branch push and replace-in-place MVP
Release run. This does not expand the authorization to `main`, npm, stores or hosted infrastructure.

`NTH-CD-088` renews the narrow authorization on `2026-07-27` for the verified organic integration of exact Paseo
range `5fc53c57..b589599a`. It authorizes normal fast-forward pushes of one release-source commit to
`agent/dev/mvp` and `release/mvp-actions`, followed by the existing exact-SHA fixed-Beta workflow and public asset
reverification. It does not authorize force push, `main`, Relay deployment, npm/store/mobile publication, or any
operation on the independent Paseo service.

`NTH-CD-096` renews the same narrow authorization on `2026-07-28` for the verified organic integration of Paseo
v0.2.3's exact 36-commit target-side set plus the Workspace-owned Schedule App completion. It authorizes one
release-source SHA to be normally fast-forwarded to `agent/dev/mvp` and `release/mvp-actions`, followed by the
existing exact-SHA fixed-Beta workflow and fresh public-asset/AppImage verification. It does not authorize force
push, merge/rebase, `main`, Relay deployment, npm/mobile/store/Nix/Docker publication or any operation on the
independent Paseo service. A failed mandatory workflow leaves the existing fixed Release intact.

`NTH-CD-099` renews the same narrow authorization on `2026-07-29` for the verified same-session RuntimeBundle,
Provider-native Plan and structured Provider-question correction. It authorizes one exact release-source SHA to be
normally fast-forwarded to `agent/dev/mvp` and `release/mvp-actions`, followed by the existing fixed-Beta workflow
and fresh public AppImage verification. The downloaded AppImage must exercise Provider Features Plan, the native
QuestionFormCard, completed-Plan-only Implement and same-thread continuation. It does not authorize force push,
merge/rebase, `main`, Relay deployment, npm/mobile/store/Nix/Docker publication or any operation on independent
Paseo. A failed mandatory workflow leaves the existing fixed Release intact.

`NTH-CD-102` renews the same narrow authorization on `2026-07-30` for the verified Decision Map Clarify,
single Intent Contract, target-anchored Loop and schema-v6 migration replacement. It authorizes one exact
release-source SHA to be normally fast-forwarded to `agent/dev/mvp` and `release/mvp-actions`, followed by the
existing fixed-Beta workflow and fresh public AppImage verification. The downloaded AppImage must exercise the
Decision Map, one Intent Contract, Quick on the visible thread, Loop checkpoint/fresh Review/reset, `@Task`, Stop
and schema-v5-to-v6 migration. It does not authorize force push, merge/rebase, `main`, Relay deployment,
npm/mobile/store/Nix/Docker publication or any operation on independent Paseo. A failed mandatory workflow leaves
the existing fixed Release intact.

The exact upstream receipt for that authorization is annotated tag object `5f71b185c3d170dec26ea00b91b52a550d510fcd`
at commit `43cf858c3760679ec9be805ba8b903cdf20f7103`, selected by
`v0.2.2...v0.2.3 --right-only` from merge base `36f38245cab51bbe0b43b6ac42fd41aa757064d9`.
Later Paseo `main` is not part of the Release.

## MVP Beta Authority

- Version: `0.0.0-mvp-beta`
- Tag: `v0.0.0-mvp-beta`
- Development branch: `agent/dev/mvp`
- Release automation branch: `release/mvp-actions`
- Release: <https://github.com/SeeleAI/Thoth/releases/tag/v0.0.0-mvp-beta>
- Trigger: every push to `release/mvp-actions`
- Publication: GitHub Release only; all npm workspace packages remain private
- Default hosted transport: Relay v3 TLS at `relay.test.thoth.seeles.ai:443`

The workflow builds and validates all native artifacts before touching the existing MVP Release. Its
publish job checks that the branch HEAD still matches the workflow SHA, deletes only the prior MVP
Release/tag, creates a draft prerelease on the current commit, uploads the complete artifact set,
compares the exact asset-name manifest and then makes it public. A failed build leaves the previous
MVP Release intact. Historical releases such as `thoth-plugin-final-archive` are never removed.

Until the user chooses a new version, updates replace this same Release and tag. They do not create
additional MVP beta releases.

## MVP Build-ID Updates

`MVP-UPDATE.json` is the update authority for newly packaged desktop clients. It records
the fixed tag/version, source commit, workflow run, publication time and each preferred native
installer's platform, architecture, strategy, byte size, SHA-256 and fixed Release URL. Clients use
their bundled commit as identity; equal semver with a different commit is an update.

One click on Check for updates authorizes check, download, verification and handoff to the platform
installer. Windows runs the NSIS installer, macOS opens the unsigned beta DMG, AppImage performs an
atomic replacement and restart, and DEB/RPM opens the system installer. Operating-system permission
and install confirmations are not bypassed.

The previously published build contains the former `electron-updater` implementation. A remote
manifest cannot replace code that is already installed, and the fixed semver prevents that legacy
client from reliably selecting this replacement. Users must manually install one build produced by
this change. All subsequent fixed-tag beta replacements can then use the commit-based updater.

## Artifact Policy

The release contains unsigned/ad-hoc macOS and Windows desktop packages, Linux desktop packages,
updater manifests, source-commit metadata and checksums. It contains no Android APK, iOS package or
server CLI tgz. Actions still build and install the server CLI internally for daemon and Relay gates.

The fixed Beta asset manifest contains exactly 26 desktop-only assets. It excludes APK, iOS, public Server CLI,
npm, Nix, and Docker outputs. After publication, verification downloads `BUILD-SOURCE.txt`, `MVP-UPDATE.json`,
`SHA256SUMS`, and `Thoth-x86_64.AppImage` from the public Release rather than reusing workflow or local files; size,
SHA-256, source commit, update manifest, embedded build identity, and the complete packaged journey must agree.

## Current Published Receipt

The current fixed Beta was published from source `c32ab051370ae1675b05ee53713ca60ac32f24ad` by exact-SHA workflow
`30604155018`. All 11 mandatory jobs passed. Public prerelease `362857331` and direct
tag `v0.0.0-mvp-beta` target that exact source, are non-draft/prerelease, and expose exactly 26 desktop-only assets.

Fresh public downloads verify:

- `BUILD-SOURCE.txt`: `89` bytes,
  `eb8cc39f11d00bb382d97191e143ebafa7321d56ad733dc7c55c2c836c78557e`
- `MVP-UPDATE.json`: `2,455` bytes,
  `216636e2f88fa25740ccfa084e03cc2cbe4b8808f03311fa73db335875e025dd`
- `SHA256SUMS`: `2,418` bytes,
  `e83ec4cb566b2a71cae13388debbb2e528452e0e084b75d484711ca59f67404b`
- `Thoth-x86_64.AppImage`: `137,826,775` bytes,
  `e78269655d4e9f07f2eb1358cd36d8b1f6f99ec357d57df6b8c6123cf4eef4ab`

The source metadata, schema-1 update manifest, checksum file and extracted `resources/build-identity.json` agree
on the source/workflow. The downloaded AppImage completed the real-window Decision Map, single Intent Contract,
Quick, Loop native Plan/Implement, four semantic checkpoints, four fresh Reviews, reorient/retry, `@Task`, Stop,
schema-v6 migration, `Tasks | Schedules`, Workspace-script, five-chunk file-transfer, Files/Changes, Browser and
Desktop bridge journey with `ok=true`. Its durable state is `8,592,628` bytes with exactly two content-addressed
RuntimeBundles.

## Provider Interaction Replacement History

Provider-interaction release source `c03d60cd14cd4ee330d30a38b0007807eb410a3d` was pushed to both authorized
branches, but exact-SHA workflow `30453064159` failed before publish. macOS x64 exposed a partial PID-lock JSON
read, and the hosted Relay journey exposed lost native-thread tool-catalog state in the external scripted Provider
after daemon restart. Publish was skipped, so the prior public Release remained safely at `eaa1aa5f` with its 26
assets during that failed attempt.

Both corrective paths now pass focused tests, the complete hosted Relay journey and a rebuilt local AppImage
real-window journey. The local candidate is `137,830,605` bytes with SHA-256
`ba878cdabaf1bd5f9488d1241f2491d012834d075f0b5d0c69cf55b188403059`. It includes same-thread Provider Plan,
structured question id `target`, answer array `['Local']`, completed-Plan-only Implement and all prior packaged
surfaces. Corrective source `d898f25f` then passed exact-SHA workflow `30459786832`, replaced the fixed Release and
passed fresh public-download and downloaded-AppImage verification. The failed predecessor remains evidence and is
not treated as a successful publication.

## Decision Map Replacement History

Decision Map source `eacb2b6df0983f0b19f3fd83d4657938b435c73e` reached exact-SHA workflow `30601495104`.
Preflight passed every gate before the CLI suite, where the Schedule observer exposed an accidental three-second
window for asynchronously created Task authority. Publish and all native jobs were skipped, so the prior Release
remained intact. The observer now uses the same 30-second semantic deadline as the surrounding authority checks
and preserves final Task, Schedule and daemon receipts on failure.

Corrective source `a62ff6e107f684a183b5bc9dd8d7054de40acd13` reached workflow `30602467471`. Its added
receipts proved the Schedule fixture selected host Claude despite provisioning scripted Codex. The fixture now
owns and selects its scripted Provider, and a terminal Schedule run without Task authority fails immediately with
the exact run receipt rather than waiting for a timeout. No product fallback or Provider-specific business branch
was added, and publish was again skipped.

Source `16216432a3a72a608833c034f33ffa7b47507ee9` reached workflow `30603411869`, where the complete Daemon
suite exposed an order-sensitive assertion for two intentionally concurrent Workspace routes. The expected and
actual projections are now normalized by `scriptName` before exact comparison; production RouteStore behavior was
not changed. All downstream jobs, including publish, were skipped.

Final corrective source `c32ab051370ae1675b05ee53713ca60ac32f24ad` passed exact-SHA workflow
`30604155018`, including preflight, Linux/Windows/macOS native builds, three native CLI smokes, internal Server CLI,
hosted Relay and publish. It replaced the fixed Release only after every mandatory job succeeded, then passed the
fresh public-download identity checks and downloaded-AppImage product journey recorded above. The three failed
workflows remain failure evidence rather than being rerun or reclassified as successful releases.

## Credentials And GitHub Operations

All repository GitHub operations use the Royalvice repository-local configuration:

```bash
THOTH_GH_CONFIG_DIR=.dev/gh-royalvice npm run gh -- auth status --hostname github.com
THOTH_GH_CONFIG_DIR=.dev/gh-royalvice npm run gh -- api user
```

Do not use global `~/.config/gh`, place credentials in command arguments, commit signing material or
reuse a credential exposed in chat. Local Android keystore material stays in ignored
`.dev/release-keys/` and is not consumed by the desktop-only workflow. Build jobs have
`contents: read`; only the final publish job has `contents: write` through its automatic
`GITHUB_TOKEN`.

## Branch Safety

Both authorized source pushes are normal fast-forwards only:

```text
agent/dev/mvp       -> exact release-source SHA
release/mvp-actions -> same exact release-source SHA
```

Force push, `--force-with-lease`, merge, rebase, history rewrite, and any `main` mutation are forbidden. If an
audited remote SHA changes before push, stop and inspect the concurrent update rather than overriding it. A push
timeout is not success: query the remote SHA before deciding whether retry is needed.

After public verification, the evidence-only closeout commit is pushed normally to `agent/dev/mvp` only;
`release/mvp-actions` stays at the published release-source SHA so documentation does not trigger a second Release.

For the Decision Map/Loop candidate, the release-source commit may be created only after Foundation, complete
owner suites, `accept:thoth:fast`, three cognition judges, real Codex, fresh Web, schema-v6 migration, rebuilt
AppImage and hosted Relay journeys are green. The AppImage report must preserve Provider Features Plan,
Workspace scripts, direct five-chunk file transfer and full `Tasks | Schedules` UI/navigation while adding the
Decision Map, one Intent Contract, Quick, Loop checkpoint/fresh Review/reset, `@Task`, Stop and exact schema-v6
receipts. The workflow retains the hosted Relay and internal Server CLI gates even though this replacement does
not deploy Relay or publish Server CLI.

After workflow success, download public files into an ignored per-source directory and run the product journey
against that downloaded executable, not the local or Actions artifact. Keep localhost CDP/daemon traffic outside
external proxies:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  -u http_proxy -u https_proxy -u all_proxy \
  NO_PROXY=127.0.0.1,localhost \
  npm run smoke:packaged:appimage-thoth -- \
  --appimage <public-download>/Thoth-x86_64.AppImage \
  --output-dir <public-download>/journey
```

The final evidence must cross-check GitHub asset metadata, `BUILD-SOURCE.txt`, `MVP-UPDATE.json`, `SHA256SUMS`,
local SHA-256 and extracted `resources/build-identity.json` against the exact release-source SHA and workflow ID.
Only then may `NTH-TD-052` become verified and `NTH-TD-036` return as the sole top next action.

The independent `SeeleAI/Thoth-Relay` deployment and any future production relay/web deployment are
outside this release authorization.
