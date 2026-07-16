# CodeBurn Desktop

Electron desktop shell for CodeBurn's local-first usage views. M1 runs as a developer app and reads data by spawning the installed `codeburn` CLI; it does not run a daemon or HTTP server.

## Development

```sh
npm --prefix app install
npm --prefix app run dev
```

Validation:

```sh
npm --prefix app run test
npm --prefix app run typecheck
```

## CLI Dependency

The app depends on a working `codeburn` CLI on the local machine. Electron resolves and spawns the CLI from the main process, then sends decoded JSON through the secure preload bridge into the renderer.

This follows the menubar pattern:

- `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Renderer code calls `window.codeburn` only through `app/renderer/lib/ipc.ts`.
- Main process handlers return JSON envelopes so structured CLI errors survive IPC.
- Missing CLI, bad JSON, timeout, and nonzero exits are surfaced as honest UI states.
- The renderer never imports CodeBurn engine code from `src/`; the data contract is spawn CLI, decode JSON, poll.

## Data Contract

Current bridge calls:

- Overview: `codeburn status --format menubar-json --period <period> [--provider <provider>]`
- Plans: `codeburn status --format json --period <period>`
- Models: `codeburn models --format json --period <period> [--provider <provider>] [--by-task]`
- Optimize: `codeburn yield --format json --period <period>`
- Spend flow: `codeburn spend --format flow-json --period <period> [--provider <provider>]`
- Devices: `codeburn devices --format json --period <period>`
- Device scan: `codeburn devices scan --format json`
- Share status: `codeburn share status --format json`
- Identity: `codeburn identity --format json`

Supported M1 periods are `today`, `week`, `30days`, `month`, and `all`. Provider filtering is passed through where the CLI command supports it.

## Sections

- Overview: daily spend, spend stats, waste summary, and expensive sessions from `menubar-json`.
- Spend: project/activity/tool/MCP/subagent lenses plus model-to-project flow.
- Optimize: waste findings from `menubar-json` and reverted/abandoned yield data.
- Models: model and task tables from `models --format json`.
- Plans: plan pacing from `status --format json`.
- Settings: device identity, nearby scan results, paired-device usage, and M2 visual affordances.

## Packaging

`npm run package` produces an ad-hoc-signed macOS `.dmg`/`.zip` (arm64 and x64) via `electron-builder`, no paid Apple Developer account required. See `DISTRIBUTION.md` for build instructions, artifact locations, and the Gatekeeper first-open story.

## M2 Backlog

- Deliver a self-contained app that bundles the CodeBurn engine and auto-updates itself with Electron `autoUpdater`.
- Ship end-user installs via `.dmg` and `install.sh`; end users should not need npm.
- Keep npm as a separate CLI-user channel at the same version as the desktop app.
- Add macOS code signing with a paid Developer ID and notarization (ad-hoc packaging exists today; see `DISTRIBUTION.md`).
- Add a `codeburn desktop` launcher subcommand.
- Implement in-app pairing, approve, pull, and visibility mutations currently shown as M2 affordances.
- Build the Models Compare sheet.
- Add light theme support.
- Expand `codeburn optimize --format json` with evidence and fix commands so Optimize can show richer actionable fixes.
