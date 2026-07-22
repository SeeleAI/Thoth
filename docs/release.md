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

The user authorized a guarded `--force-with-lease` update of `agent/dev/mvp` only against the
previously audited remote SHA, followed by a normal push of `release/mvp-actions`. `main` must not be
merged, pushed, rebased or retagged by this flow. If the audited remote branch SHA changes before
push, stop and inspect the concurrent update rather than overriding it.

The independent `SeeleAI/Thoth-Relay` deployment and any future production relay/web deployment are
outside this release authorization.
