# Distributing CodeBurn Desktop

This document describes how to produce a distributable macOS build of the
Electron desktop app **without a paid Apple Developer account**. There is no
CI automation for this yet (unlike the CLI and menubar release processes in
`../RELEASING.md`) — packaging is run by hand on a maintainer's machine.

## Build

```sh
npm --prefix app install
npm --prefix app run package          # both arm64 and x64
npm --prefix app run package:arm64    # arm64 only (faster on Apple Silicon)
npm --prefix app run package:x64      # x64 only
```

`package` runs `npm run build` (compiles `electron/` with `tsc`, builds the
renderer with `vite`) and then `electron-builder --mac`.

### Artifacts

electron-builder writes to `app/release/` (gitignored, like `dist/`):

- `CodeBurn-<version>-arm64.dmg`, `CodeBurn-<version>.dmg` — installer images
- `CodeBurn-<version>-arm64-mac.zip`, `CodeBurn-<version>-mac.zip` — zipped `.app` bundles
- `release/mac-arm64/CodeBurn.app`, `release/mac/CodeBurn.app` — the raw unpacked bundles (arm64 and x64 respectively)
- `.blockmap` files alongside each zip/dmg (used by electron-builder's differential-update mechanism; unused since this app has no auto-updater yet)

Both `dmg` and `zip` targets are built for both `arm64` and `x64` — four
artifacts total, not a universal binary. This keeps each download roughly
half the size of a universal build. Pick the zip if you just want to unpack
and drag to `/Applications`; the dmg gives users the familiar drag-to-Applications
installer window.

### Build configuration

The `build` block lives in `app/package.json` (small enough not to warrant a
separate `electron-builder.yml`):

- `appId: "org.agentseal.codeburn-desktop"` — reuses the `org.agentseal.*`
  prefix from the menubar app's bundle id (`org.agentseal.codeburn-menubar`,
  see `mac/Scripts/package-app.sh`); there is no `com.codeburn.*` bundle id
  anywhere in the codebase, so `org.agentseal.*` is the actual house
  convention.
- `productName: "CodeBurn"`.
- `files`: only `dist/electron/**/*`, `dist/renderer/**/*`, and `package.json`.
  The Electron main process has no npm runtime dependencies (only Node/Electron
  builtins — see `app/electron/cli.ts` and `app/electron/quota/*.ts`), and the
  renderer is a single Vite bundle, so `node_modules` does not need to ship at
  all.
- `mac.identity: "-"` — forces ad-hoc signing. **`identity: null` does NOT
  ad-hoc sign — it skips signing entirely**, which produces a bundle with a
  broken/absent seal (`codesign --verify --deep --strict` fails with
  `code has no resources but signature indicates they must be present`, and
  Apple Silicon refuses to run it at all). `"-"` is the same ad-hoc identity
  `mac/Scripts/package-app.sh` uses for the menubar app's local/CI builds.
- `mac.hardenedRuntime: false` — hardened runtime is for notarized builds;
  leaving it on for an ad-hoc signature with no entitlements can prevent the
  app from launching.
- `mac.gatekeeperAssess: false` — skips electron-builder's post-sign
  `spctl` check, which would always fail for an unnotarized app.
- `icon: build/icon.png` — a pre-existing 1024x1024 PNG at
  `app/build/icon.png`. No `.icns` exists in the repo; electron-builder
  generates one from the PNG at build time. This is the same source PNG
  used for the app icon; the menubar app has its own separate icon
  (`assets/menubar-logo.png`, converted to `.icns` in `package-app.sh`).
- `directories.output: "release"` — electron-builder's default output dir is
  `dist`, which collides with this app's existing `tsc`/`vite` build output
  (`app/dist/electron`, `app/dist/renderer`) that `files` reads from. Using
  a separate `release/` directory keeps build inputs and packaging outputs apart.

## Verifying a build

```sh
codesign -dv --verbose=2 app/release/mac-arm64/CodeBurn.app
codesign --verify --deep --strict app/release/mac-arm64/CodeBurn.app
```

Expect `Signature=adhoc`, a real `Identifier=org.agentseal.codeburn-desktop`,
and `Sealed Resources` present. The deep-verify command should exit 0.

To smoke-test that the packaged renderer actually loads (the classic failure
is a white screen from a wrong `loadFile` path once assets are behind
`app.asar`), launch the built binary directly and confirm the process tree
stays up and the main process logs no `did-fail-load` errors:

```sh
"app/release/mac-arm64/CodeBurn.app/Contents/MacOS/CodeBurn" --user-data-dir=/tmp/codeburn-smoke
```

A healthy launch spawns `CodeBurn`, `CodeBurn Helper` (gpu-process),
`CodeBurn Helper` (utility/network), and `CodeBurn Helper (Renderer)`
processes and keeps running with no stderr output. `main.ts`'s
`did-fail-load` handler (`console.error('Renderer failed to load ...')`)
prints to that same stderr if the packaged `loadFile(path.join(__dirname,
'..', 'renderer', 'index.html'))` path is ever wrong.

## The Gatekeeper story (no paid Apple Developer account)

Ad-hoc signing satisfies the *kernel's* code-signing requirement (Apple
Silicon refuses to execute anything with no signature at all), but it is not
a Developer ID signature and the app is not notarized. Concretely:

- `spctl --assess --type execute` on the built app returns **`rejected`**,
  ad-hoc-signed or not, quarantined or not. `spctl`'s static assessment
  checks for a Developer ID + notarization ticket, which this build does
  not have and cannot have without a paid account.
- Any file downloaded through a browser (or unzipped by Finder's Archive
  Utility from a browser download) gets a `com.apple.quarantine` extended
  attribute. The first time a quarantined, non-notarized app is opened,
  Gatekeeper blocks a plain double-click with "Apple could not verify that
  \[CodeBurn] is free of malware."
- **This is expected and correct for an unpaid, unnotarized build.** Being
  a known GitHub author, signing the repo's commits, or ad-hoc signing the
  binary does **not** change this — none of that is a substitute for an
  Apple-issued Developer ID certificate plus notarization.

### First-open instructions for users

Pick one:

1. **Right-click (or Control-click) the app in Finder → Open → Open** in the
   confirmation dialog. This is required only once; subsequent launches work
   with a normal double-click.
2. On macOS Ventura and later, if step 1's dialog does not offer an Open
   button: **System Settings → Privacy & Security → scroll to Security →
   "\[CodeBurn] was blocked..." → Open Anyway**, then confirm in the dialog
   that appears on the next open attempt.
3. From the command line, strip the quarantine attribute before first launch
   (equivalent effect, no dialog at all):
   ```sh
   xattr -cr /Applications/CodeBurn.app
   ```

None of these steps are needed for a `dmg`/`zip` built and opened locally on
the same machine (no quarantine attribute is applied to files that were never
downloaded) — they only apply to a build distributed to someone else, e.g.
via a GitHub Release.

## Upgrade path: paid account + notarization

When a paid Apple Developer Program membership is available, the same
`electron-builder` config takes the upgrade with a few changes, no new
tooling:

- Set `mac.identity` to the real `"Developer ID Application: <Name> (<TEAMID>)"`
  certificate name (or let electron-builder auto-discover it from the
  keychain by removing `identity` entirely), and set `mac.hardenedRuntime:
  true` with an entitlements file.
- Add a `notarize` block (or the `afterSign` hook electron-builder's
  `@electron/notarize` integration expects) with an app-specific password or
  API key, and remove `gatekeeperAssess: false` so electron-builder verifies
  the notarized result itself.
- Everything else — `appId`, `files`, `mac.target` (dmg/zip, arm64+x64),
  `icon`, `directories.output` — stays as-is.
