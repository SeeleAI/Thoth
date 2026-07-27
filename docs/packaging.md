# Packaging

This document describes local and MVP beta packaging flows. Packaging commands alone do not
authorize push, tag creation, Release mutation, cloud deploys or store submission; the explicit MVP
authorization and branch policy are recorded in [`release.md`](release.md).

## MVP Beta Artifact Contract

The fixed MVP version is `0.0.0-mvp-beta`. The `release/mvp-actions` workflow builds:

- macOS arm64/x64 DMG and ZIP packages
- Windows arm64/x64 NSIS and ZIP packages
- Linux x64 AppImage, DEB, RPM and tar.gz packages
- legacy Electron updater manifests for already-published clients, build-source metadata,
  `MVP-UPDATE.json` and `SHA256SUMS`

The server CLI bundle is built and installed only inside Actions for daemon and Relay acceptance.
It is not uploaded to the public Release. Android remains a local source/build target and is not
part of the MVP beta Release.

Run the local release-contract check before packaging:

```bash
npm run check:mvp-release-contract
```

It verifies every workspace version, exact internal semver dependency, private-package policy,
lockfile consistency and the absence of internal `file:` dependencies.

## Internal Server CLI Bundle

Build the server CLI GitHub Release bundle:

```bash
npm run package:server-cli
```

The default output is ignored under `.dev/release-artifacts/`. The archive embeds the runtime
`@thoth/*` packages and Clarify/Loop `SKILL.md` assets, while the target machine installs
platform-appropriate third-party dependencies through npm. It requires Node.js `>=24.14.0` and is
not published to the npm registry.

The bundle is an Actions artifact only and has no public Release installation URL.

## Android Debug APK

Android Debug APK is the required local mobile artifact for the first-day infrastructure gate.

Commands:

```bash
npm run doctor:android
npm run setup:android-toolchain
npm run package:android:debug-apk
```

Toolchain policy:

- JDK 17 under `.dev/jdk-17`
- Android SDK under `.dev/android-sdk`
- Gradle user home under `.dev/gradle`
- Generated native project under `packages/app/android/`
- APK output under `packages/app/android/app/build/outputs/apk/debug/app-debug.apk`

The Android packaging script maps `http_proxy`/`https_proxy` environment variables into Gradle
JVM proxy options when present.

The APK is not committed. The packaging script writes a local receipt under `.agent-os/artifacts/android-debug-apk.json` with:

- command
- absolute APK path
- sha256
- byte size
- timestamp

Current verified debug artifact from the runtime isolation run:

- Path: `/mnt/cfs/5vr0p6/yzy/thoth/packages/app/android/app/build/outputs/apk/debug/app-debug.apk`
- sha256: `042b2e4ad9cf46113385cb316d5dc2c13d6d22da4053bcf11896b4b854770702`
- Bytes: `273165007`
- Package: `sh.thoth.debug`
- Permission check: does not request `android.permission.RECORD_AUDIO`

## Android Local Release APK

Build the production-identity universal APK with:

```bash
npm run package:android:release-apk
```

Required environment variables are `THOTH_ANDROID_KEYSTORE_PATH`,
`THOTH_ANDROID_KEYSTORE_PASSWORD`, `THOTH_ANDROID_KEY_ALIAS` and
`THOTH_ANDROID_KEY_PASSWORD`. Production packaging fails when any value is absent and never falls
back to the public debug key. The local fixed MVP key is kept only under ignored
`.dev/release-keys/`; GitHub Actions receives it through repository secrets.

The Release APK contract is:

- package id `sh.thoth`
- version name `0.0.0-mvp-beta`
- universal ABI support
- APK Signature Scheme v2 or newer
- no `android.permission.RECORD_AUDIO`
- no `android.permission.SYSTEM_ALERT_WINDOW`
- no Expo development launcher or EAS OTA project binding

This local artifact is not uploaded to the MVP beta Release. The app does not expose Android
self-update or request `REQUEST_INSTALL_PACKAGES` while mobile publication is paused.

## iOS

iOS local build requires macOS with Xcode. Linux cannot produce a real iOS build.

Commands:

```bash
npm run package:ios:prebuild
npm run package:ios:build
```

On Linux, these scripts must report a clear macOS/Xcode requirement and must not claim a successful iOS build.

## Web/App

The app web export flow uses the real product UI, not a mock review shell.

Commands:

```bash
npm run build:web
THOTH_DAEMON_PROXY_TARGET=127.0.0.1:6688 HOST=0.0.0.0 PORT=8082 npm run serve:web
```

Local human review URL:

```text
http://127.0.0.1:8082/
```

Current public mapping for this environment:

```text
http://180.76.242.105:8148/
```

The public web entry proxies `/ws` back to the local Thoth daemon when
`THOTH_DAEMON_PROXY_TARGET` is set. External devices that cannot use that direct web entry must
still render the real Welcome / Add Host / Paste pairing link experience and use relay pairing.

## Relay

Relay build/typecheck/test are part of the foundation gate. Production deploy is never automatic and requires explicit user authorization.

Current test relay authority is the independent private repository:

```text
SeeleAI/Thoth-Relay
```

Current test endpoint:

```text
https://relay.test.thoth.seeles.ai/health
wss://relay.test.thoth.seeles.ai/ws
```

The test relay accepts browser origins broadly for development convenience, but still requires relay v3 role-scoped tokens through `Sec-WebSocket-Protocol`. Pairing tokens are automatic credentials and must not be placed in URL query parameters, logs, screenshots or documentation examples.

## Desktop

Desktop packaging depends on app export, daemon/CLI build outputs, Electron Builder and platform-specific tooling. It is not part of the foundation gate.

Linux AppImage command:

```bash
npm run package:desktop:linux-appimage
```

The cross-platform MVP workflow uses `packages/desktop/electron-builder.mvp.yml` through:

```bash
npm --workspace=@thoth/desktop run build:mvp -- --publish never <platform targets>
```

Native GitHub-hosted runners build each platform. macOS uses ad-hoc/unsigned output with
notarization disabled; Windows disables certificate auto-discovery; Linux builds on Ubuntu. MVP
desktop artifacts may therefore trigger Gatekeeper or SmartScreen warnings. Signing and
notarization can be added in a later release decision without changing the current package version
contract.

Every native MVP desktop build runs `write-build-identity.mjs` before packaging. The resulting
`resources/build-identity.json` contains the workflow commit. Desktop update checks always fetch the
fixed `v0.0.0-mvp-beta` `MVP-UPDATE.json` with cache busting and compare commits rather than
versions. A user check that finds a different commit immediately downloads the platform asset,
reports progress, verifies byte size and SHA-256, stops the bundled daemon, and enters the native
install strategy: NSIS on Windows, DMG on macOS, atomic AppImage replacement, or the system package
installer for DEB/RPM. New clients do not consume `latest*.yml`; those files remain Release assets
only for migration compatibility with older published clients.

Current verified local artifact:

- Path: `/mnt/cfs/5vr0p6/yzy/thoth/packages/desktop/release/Thoth-x86_64.AppImage`
- sha256: `3e31b309d1e8a1ecd61e1d7bda149f420446f256d8e086499050d217a6a789ad`
- Bytes: `137793946`
- Version: `0.0.0-mvp-beta`
- Packaged smoke: passed with an isolated desktop-managed daemon on a temporary port; the real window verified
  preload/renderer, read-only Files/Changes, Browser automation with typed wrong-`browserId` rejection, and a
  Schedule run with real Task/Execution IDs and canonical Timeline events

`packages/desktop/release/` is local artifact output and must not be committed.

## Runtime Isolation Packaging Rule

Packaged desktop smoke, Android debug builds and web preview must not stop or reuse the reserved local legacy daemon on `127.0.0.1:6767`. Thoth direct daemon defaults to `127.0.0.1:6688`; packaged smoke should use an isolated temporary home and port when it launches a managed daemon.

All MVP surfaces default to Relay v3 at `relay.test.thoth.seeles.ai:443` with TLS. Packaging must not
add a localhost, legacy daemon or inactive production-domain fallback.

## Voice/Audio Policy

Current MVP does not include voice, speech, dictation or audio. Packaging config must not request audio or microphone permissions.
