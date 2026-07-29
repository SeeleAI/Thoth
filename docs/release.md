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

The current fixed Beta was published from source `eaa1aa5fd44c64e97823fa441d04ad3c3bf772d1` by exact-SHA workflow
`30383055325` (`MVP Beta Release` run `33`). All 11 mandatory jobs passed. Public prerelease `361273193` and direct
tag `v0.0.0-mvp-beta` target that exact source, are non-draft/prerelease, and expose exactly 26 desktop-only assets.

Fresh public downloads verify:

- `BUILD-SOURCE.txt`: `89` bytes,
  `0af0b4e2743aba7fb0de12dd79c49f7771215c19a4f32132244d817dbab51eac`
- `MVP-UPDATE.json`: `2,455` bytes,
  `b53db387763604a3b1695fb3aad0e3c4e8375dcbc39d0b2a8ef1fa12fc1d3fe4`
- `SHA256SUMS`: `2,418` bytes,
  `c3f9d329aca9b61e2de2ee4ecc3c524d4c9bd17a4f966fd2b03efea1a4d1918d`
- `Thoth-x86_64.AppImage`: `137,822,613` bytes,
  `b287f036cfe4d6de7c4c18a284a68998fc9232b187e86e42691de555c3252b21`

The source metadata, schema-1 update manifest, checksum file and extracted `resources/build-identity.json` agree
on the source/workflow. The downloaded AppImage completed the real-window `Tasks | Schedules`, Workspace-script,
five-chunk file-transfer, Files/Changes, Browser and Desktop bridge journey with `ok=true`.

## Authorized Unpublished Candidate

The current Provider-interaction correction is release-ready on base
`d801b8e9e1e200f65bd94532e537f673c7e9567b` but is not yet the public Release. Local verification includes one
native Provider session across Thoth hot switching, structured question-id array answers, completed-native-Plan
authority, Daemon-owned Implement, real Codex, built-Web UI and a real-window AppImage journey. The local AppImage
is `137,830,579` bytes with SHA-256
`babb5596ce24cbe111d37ee6d8a82191ef1292510e000814afc7ea3253fbd054`; it is candidate evidence, not a public
asset. `NTH-EV-074` becomes verified only after the exact release-source workflow and fresh public downloads pass.

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

For the Provider-interaction candidate, the release-source commit may be created only after Foundation, Provider
Control, interaction, complete Thoth, shared-`300s` Refactor, real Codex, real built-Web, isolation and rebuilt
AppImage journeys are green. The AppImage report must preserve Workspace scripts, direct five-chunk file transfer,
full `Tasks | Schedules` UI/navigation and add Provider Features Plan, native question-id array response,
completed-Plan-only Implement and same-thread continuation. The workflow must retain the existing hosted Relay and
internal Server CLI gates even though this correction does not deploy Relay or publish Server CLI.

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
Only then may `NTH-TD-051` become verified and `NTH-TD-036` return as the sole top next action.

The independent `SeeleAI/Thoth-Relay` deployment and any future production relay/web deployment are
outside this release authorization.
