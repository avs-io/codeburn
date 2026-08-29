import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { getDateRange } from '../src/cli-date.js'
import { loadPricing } from '../src/models.js'
import { buildDurablePeriod } from '../src/usage-aggregator.js'
import { clearSessionCache } from '../src/parser.js'

const ROOT = join(tmpdir(), `codeburn-today-skip-backfill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const ENV_KEYS = ['HOME', 'CODEBURN_CACHE_DIR', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIRS', 'CODEX_HOME', 'USERPROFILE', 'KIMI_CODE_HOME', 'CODEBURN_DESKTOP_SESSIONS_DIR'] as const
let savedEnv: Record<string, string | undefined>

const parseRanges: Array<{ start: string; end: string }> = []

vi.mock('../src/parser.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/parser.js')>()
  return {
    ...mod,
    parseAllSessions: vi.fn(async (range?: { start: Date; end: Date }) => {
      if (range) parseRanges.push({ start: range.start.toISOString(), end: range.end.toISOString() })
      else parseRanges.push({ start: 'none', end: 'none' })
      return []
    }),
    isSessionHydrationComplete: vi.fn(() => true),
    sessionHydrationSnapshot: vi.fn(() => ({
      complete: true,
      deferredForFirstPaint: false,
      indexedFiles: 0,
      pendingFiles: 0,
    })),
  }
})

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  parseRanges.length = 0
  await mkdir(join(ROOT, 'home', '.claude'), { recursive: true })
  await mkdir(join(ROOT, 'cache'), { recursive: true })
  await mkdir(join(ROOT, 'no-desktop-sessions'), { recursive: true })
  await mkdir(join(ROOT, 'no-kimi-home'), { recursive: true })
  process.env['HOME'] = join(ROOT, 'home')
  process.env['CODEBURN_CACHE_DIR'] = join(ROOT, 'cache')
  process.env['CLAUDE_CONFIG_DIR'] = join(ROOT, 'home', '.claude')
  delete process.env['CLAUDE_CONFIG_DIRS']
  delete process.env['CODEX_HOME']
  process.env['USERPROFILE'] = join(ROOT, 'home')
  process.env['KIMI_CODE_HOME'] = join(ROOT, 'no-kimi-home')
  process.env['CODEBURN_DESKTOP_SESSIONS_DIR'] = join(ROOT, 'no-desktop-sessions')
  clearSessionCache()
  await loadPricing()
})

afterEach(async () => {
  clearSessionCache()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  if (existsSync(ROOT)) await rm(ROOT, { recursive: true, force: true })
})

describe('buildDurablePeriod today-only skips history backfill', () => {
  it('parses only today on a cold empty daily cache', async () => {
    await buildDurablePeriod(getDateRange('today'), { provider: 'all' })
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    expect(parseRanges.length).toBeGreaterThan(0)
    for (const range of parseRanges) {
      expect(new Date(range.start).getTime()).toBeGreaterThanOrEqual(todayStart.getTime())
    }
  })

  it('still backfills history for a 7D query on an empty cache', async () => {
    await buildDurablePeriod(getDateRange('week'), { provider: 'all' })
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    expect(parseRanges.some(range => new Date(range.start).getTime() < todayStart.getTime())).toBe(true)
  })
})
