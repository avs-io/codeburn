import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'

import { CliError, resolveCodeburnPath, spawnCli } from './cli'

// Result envelope: handlers never throw across IPC so the structured error
// `kind` survives contextBridge serialization. preload.ts unwraps it.
export type Envelope<T = unknown> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } }

const REFRESH_CHANNEL = 'codeburn:refresh'
const REFRESH_INTERVAL_MS = 30_000

function providerArgs(provider: string | undefined): string[] {
  return provider && provider !== 'all' ? ['--provider', provider] : []
}

function toEnvelopeError(err: unknown): { kind: string; message: string } {
  if (err instanceof CliError) return { kind: err.kind, message: err.message }
  return { kind: 'nonzero', message: err instanceof Error ? err.message : String(err) }
}

type Deps = {
  spawnCli: (args: string[], opts?: { timeoutMs?: number }) => Promise<unknown>
  resolveCodeburnPath: () => string | null
}

type Handler = (...args: any[]) => Promise<Envelope>

/**
 * Maps every CodeburnBridge channel to its `codeburn` argv (plain args, no
 * shell) and returns a result envelope. Pure + injectable so the wiring is
 * unit-testable without launching Electron.
 */
export function createBridgeHandlers(deps: Deps = { spawnCli, resolveCodeburnPath }): Record<string, Handler> {
  const run = (build: (...args: any[]) => string[]): Handler => async (...args: any[]) => {
    try {
      return { ok: true, value: await deps.spawnCli(build(...args)) }
    } catch (err) {
      return { ok: false, error: toEnvelopeError(err) }
    }
  }

  return {
    'codeburn:getOverview': run((period: string, provider: string) => [
      'status', '--format', 'menubar-json', '--period', period, ...providerArgs(provider),
    ]),
    'codeburn:getPlans': run((period: string) => ['status', '--format', 'json', '--period', period]),
    'codeburn:getModels': run((period: string, provider: string, byTask: boolean) => [
      'models', '--format', 'json', '--period', period, ...providerArgs(provider), ...(byTask ? ['--by-task'] : []),
    ]),
    'codeburn:getYield': run((period: string) => ['yield', '--format', 'json', '--period', period]),
    'codeburn:getSpendFlow': run((period: string, provider: string) => [
      'spend', '--format', 'flow-json', '--period', period, ...providerArgs(provider),
    ]),
    'codeburn:getDevices': run((period: string) => ['devices', '--format', 'json', '--period', period]),
    'codeburn:getShareStatus': run(() => ['share', 'status', '--format', 'json']),
    'codeburn:getIdentity': run(() => ['identity', '--format', 'json']),
    'codeburn:cliStatus': async () => {
      const p = deps.resolveCodeburnPath()
      return { ok: true, value: { found: p !== null, path: p } }
    },
  }
}

function registerHandlers(): void {
  const handlers = createBridgeHandlers()
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args) => handler(...args))
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0B0D13',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }

  // 30s refresh tick — the renderer's usePolled hooks revalidate on it.
  const timer = setInterval(() => {
    if (!win.isDestroyed()) win.webContents.send(REFRESH_CHANNEL)
  }, REFRESH_INTERVAL_MS)
  win.on('closed', () => clearInterval(timer))

  return win
}

function bootstrap(): void {
  void app.whenReady().then(() => {
    registerHandlers()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

if (!process.env.VITEST) bootstrap()
