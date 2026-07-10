// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// Stub electron so importing main.ts does not require an Electron runtime.
vi.mock('electron', () => ({
  app: { whenReady: () => Promise.resolve(), on: () => {}, quit: () => {} },
  BrowserWindow: class {},
  ipcMain: { handle: () => {} },
}))

import { createBridgeHandlers } from './main'
import { CliError } from './cli'

function fakeSpawn(result: unknown = { current: { cost: 12.34 } }) {
  const calls: string[][] = []
  const spawnCli = vi.fn(async (args: string[]) => {
    calls.push(args)
    return result
  })
  return { spawnCli, calls }
}

describe('createBridgeHandlers (IPC wiring)', () => {
  it('getOverview spawns menubar-json for the period, omitting --provider for "all"', async () => {
    const { spawnCli, calls } = fakeSpawn()
    const handlers = createBridgeHandlers({ spawnCli, resolveCodeburnPath: () => '/bin/codeburn' })
    const res = await handlers['codeburn:getOverview']!('30days', 'all')
    expect(calls[0]).toEqual(['status', '--format', 'menubar-json', '--period', '30days'])
    expect(res).toEqual({ ok: true, value: { current: { cost: 12.34 } } })
  })

  it('adds --provider and --by-task when requested', async () => {
    const { spawnCli, calls } = fakeSpawn([])
    const handlers = createBridgeHandlers({ spawnCli, resolveCodeburnPath: () => null })
    await handlers['codeburn:getModels']!('week', 'claude', true)
    expect(calls[0]).toEqual(['models', '--format', 'json', '--period', 'week', '--provider', 'claude', '--by-task'])
  })

  it('returns an error envelope carrying the CliError kind', async () => {
    const spawnCli = vi.fn(async () => {
      throw new CliError('nonzero', 'boom')
    })
    const handlers = createBridgeHandlers({ spawnCli, resolveCodeburnPath: () => '/bin/codeburn' })
    const res = await handlers['codeburn:getYield']!('today')
    expect(res).toEqual({ ok: false, error: { kind: 'nonzero', message: 'boom' } })
  })

  it('cliStatus reports the resolved binary path', async () => {
    const handlers = createBridgeHandlers({
      spawnCli: vi.fn(),
      resolveCodeburnPath: () => '/opt/homebrew/bin/codeburn',
    })
    const res = await handlers['codeburn:cliStatus']!()
    expect(res).toEqual({ ok: true, value: { found: true, path: '/opt/homebrew/bin/codeburn' } })
  })
})
