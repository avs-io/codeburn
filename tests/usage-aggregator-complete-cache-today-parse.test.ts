import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { DAILY_CACHE_VERSION, currentTzKey, type DailyCache, type DailyEntry } from '../src/daily-cache.js'
import { getDateRange } from '../src/cli-date.js'
import { loadPricing } from '../src/models.js'
import { buildDurablePeriod, getDailyCacheConfigHash } from '../src/usage-aggregator.js'
import { clearSessionCache } from '../src/parser.js'

const ROOT = join(tmpdir(), `codeburn-complete-cache-today-1788028573537-ly27m7`)
const ENV_KEYS = ['HOME', 'CODEBURN_CACHE_DIR', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIRS', 'CODEX_HOME', 'USERPROFILE', 'KIMI_CODE_HOME', 'CODEBURN_DESKTOP_SESSIONS_DIR'] as const
let savedEnv: Record<string, string | undefined>

const parseRanges: Array<{ start: string; end: string }> = []
const paintFloors: Array<{ includeCachedFiles: boolean; preferCompleteSnapshot: boolean }> = []

vi.mock('../src/parser.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/parser.js')>()
  return {
    ...mod,
    parseAllSessions: vi.fn(async (range?: { start: Date; end: Date }, provider?: string) => {
      if (range) {
        parseRanges.push({ start: range.start.toISOString(), end: range.end.toISOString() })
      } else {
        parseRanges.push({ start: 'none', end: 'none' })
      }
      return []
    }),
    withColdFirstPaintFloor: vi.fn(async (
      rangeStart: Date,
      fn: () => Promise<unknown>,
      includeCachedFiles = false,
      preferCompleteSnapshot = false,
    ) => {
      paintFloors.push({
        includeCachedFiles: includeCachedFiles === true,
        preferCompleteSnapshot: preferCompleteSnapshot === true,
      })
      return mod.withColdFirstPaintFloor(rangeStart, fn, includeCachedFiles, preferCompleteSnapshot)
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

function daysAgoStr(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function cachedDay(date: string, cost: number): DailyEntry {
  return {
    date,
    cost,
    savingsUSD: 0,
    calls: 10,
    sessions: 1,
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    editTurns: 1,
    oneShotTurns: 1,
    models: { 'Sonnet 4.5': { calls: 10, cost, savingsUSD: 0, inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    categories: { coding: { turns: 1, cost, savingsUSD: 0, editTurns: 1, oneShotTurns: 1 } },
    providers: {
      claude: {
        calls: 10, cost, savingsUSD: 0, sessions: 1,
        inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0,
        projects: { 'proj-x': { cost, calls: 10, savingsUSD: 0, sessions: 1, path: '/work/proj-x' } },
      },
    },
    projects: { 'proj-x': { cost, calls: 10, savingsUSD: 0, sessions: 1, path: '/work/proj-x' } },
  }
}

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  parseRanges.length = 0
  paintFloors.length = 0
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
  delete process.env['CODEBURN_SERVE_HYDRATION']
  delete process.env['CODEBURN_SERVE_FILL']
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  if (existsSync(ROOT)) await rm(ROOT, { recursive: true, force: true })
})

describe('buildDurablePeriod complete-cache today-only live parse', () => {
  it('does not parse historical days for 7D when the daily cache is complete', async () => {
    const days = [6, 5, 4, 3, 2, 1].map(n => cachedDay(daysAgoStr(n), 10))
    const cache: DailyCache = {
      version: DAILY_CACHE_VERSION,
      savingsConfigHash: getDailyCacheConfigHash(),
      tzKey: currentTzKey(),
      lastComputedDate: daysAgoStr(1),
      days,
      complete: true,
      watermarkTrusted: true,
    }
    await writeFile(join(ROOT, 'cache', `daily-cache.v${DAILY_CACHE_VERSION}.json`), JSON.stringify(cache), 'utf-8')

    const durable = await buildDurablePeriod(getDateRange('week'), { provider: 'all' })
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    expect(parseRanges.length).toBeGreaterThan(0)
    for (const range of parseRanges) {
      expect(new Date(range.start).getTime()).toBeGreaterThanOrEqual(todayStart.getTime())
    }
    expect(durable.data.cost).toBeCloseTo(60, 8)
    expect(durable.data.calls).toBe(60)
    expect(durable.scanRange.start.getTime()).toBe(todayStart.getTime())
  })

  it('floors the complete-cache 7D today parse including cached historical files', async () => {
    const days = [6, 5, 4, 3, 2, 1].map(n => cachedDay(daysAgoStr(n), 10))
    const cache: DailyCache = {
      version: DAILY_CACHE_VERSION,
      savingsConfigHash: getDailyCacheConfigHash(),
      tzKey: currentTzKey(),
      lastComputedDate: daysAgoStr(1),
      days,
      complete: true,
      watermarkTrusted: true,
    }
    await writeFile(join(ROOT, 'cache', `daily-cache.v${DAILY_CACHE_VERSION}.json`), JSON.stringify(cache), 'utf-8')
    paintFloors.length = 0
    await buildDurablePeriod(getDateRange('week'), { provider: 'all' })
    expect(paintFloors.some(floor => floor.includeCachedFiles)).toBe(true)
    expect(paintFloors.some(floor => floor.preferCompleteSnapshot)).toBe(true)
  })

  it('still parses the full range under --project even when the daily cache is complete', async () => {
    const days = [6, 5, 4, 3, 2, 1].map(n => cachedDay(daysAgoStr(n), 10))
    const cache: DailyCache = {
      version: DAILY_CACHE_VERSION,
      savingsConfigHash: getDailyCacheConfigHash(),
      tzKey: currentTzKey(),
      lastComputedDate: daysAgoStr(1),
      days,
      complete: true,
      watermarkTrusted: true,
    }
    await writeFile(join(ROOT, 'cache', `daily-cache.v${DAILY_CACHE_VERSION}.json`), JSON.stringify(cache), 'utf-8')
    parseRanges.length = 0
    await buildDurablePeriod(getDateRange('week'), { provider: 'all', project: ['proj-x'] })
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    expect(parseRanges.some(range => new Date(range.start).getTime() < todayStart.getTime())).toBe(true)
  })

  it('still parses the full range when the daily cache is incomplete', async () => {
    const cache: DailyCache = {
      version: DAILY_CACHE_VERSION,
      savingsConfigHash: getDailyCacheConfigHash(),
      tzKey: currentTzKey(),
      lastComputedDate: null,
      days: [],
      complete: false,
    }
    await writeFile(join(ROOT, 'cache', `daily-cache.v${DAILY_CACHE_VERSION}.json`), JSON.stringify(cache), 'utf-8')

    await buildDurablePeriod(getDateRange('week'), { provider: 'all' })
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    expect(parseRanges.some(range => new Date(range.start).getTime() < todayStart.getTime())).toBe(true)
  })

  it('still parses a historical --day range even when the daily cache is complete', async () => {
    const days = [6, 5, 4, 3, 2, 1].map(n => cachedDay(daysAgoStr(n), 10))
    const cache: DailyCache = {
      version: DAILY_CACHE_VERSION,
      savingsConfigHash: getDailyCacheConfigHash(),
      tzKey: currentTzKey(),
      lastComputedDate: daysAgoStr(1),
      days,
      complete: true,
      watermarkTrusted: true,
    }
    await writeFile(join(ROOT, 'cache', `daily-cache.v${DAILY_CACHE_VERSION}.json`), JSON.stringify(cache), 'utf-8')

    const dayStart = new Date(2026, 3, 10)
    const dayEnd = new Date(2026, 3, 10, 23, 59, 59, 999)
    parseRanges.length = 0
    const durable = await buildDurablePeriod(
      { range: { start: dayStart, end: dayEnd }, label: 'Day (2026-04-10)' },
      { provider: 'all' },
    )
    expect(parseRanges.some(range => new Date(range.start).getTime() === dayStart.getTime())).toBe(true)
    expect(durable.scanRange.start.getTime()).toBe(dayStart.getTime())
    expect(durable.scanRange.end.getTime()).toBe(dayEnd.getTime())
  })

  it('skips the live today parse on a serve first-paint when the daily cache is complete', async () => {
    const days = [6, 5, 4, 3, 2, 1].map(n => cachedDay(daysAgoStr(n), 10))
    const cache: DailyCache = {
      version: DAILY_CACHE_VERSION,
      savingsConfigHash: getDailyCacheConfigHash(),
      tzKey: currentTzKey(),
      lastComputedDate: daysAgoStr(1),
      days,
      complete: true,
      watermarkTrusted: true,
    }
    await writeFile(join(ROOT, 'cache', `daily-cache.v${DAILY_CACHE_VERSION}.json`), JSON.stringify(cache), 'utf-8')
    process.env['CODEBURN_SERVE_HYDRATION'] = '1'
    delete process.env['CODEBURN_SERVE_FILL']
    parseRanges.length = 0
    const durable = await buildDurablePeriod(getDateRange('week'), { provider: 'all' })
    expect(parseRanges).toEqual([])
    expect(durable.liveProjects).toEqual([])
    expect(durable.todayAllDays).toEqual([])
    expect(durable.data.cost).toBeCloseTo(60, 8)
    delete process.env['CODEBURN_SERVE_HYDRATION']
  })

  it('parses today on a serve fill pass even when the daily cache is complete', async () => {
    const days = [6, 5, 4, 3, 2, 1].map(n => cachedDay(daysAgoStr(n), 10))
    const cache: DailyCache = {
      version: DAILY_CACHE_VERSION,
      savingsConfigHash: getDailyCacheConfigHash(),
      tzKey: currentTzKey(),
      lastComputedDate: daysAgoStr(1),
      days,
      complete: true,
      watermarkTrusted: true,
    }
    await writeFile(join(ROOT, 'cache', `daily-cache.v${DAILY_CACHE_VERSION}.json`), JSON.stringify(cache), 'utf-8')
    process.env['CODEBURN_SERVE_HYDRATION'] = '1'
    process.env['CODEBURN_SERVE_FILL'] = '1'
    parseRanges.length = 0
    await buildDurablePeriod(getDateRange('week'), { provider: 'all' })
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    expect(parseRanges.length).toBeGreaterThan(0)
    for (const range of parseRanges) {
      expect(new Date(range.start).getTime()).toBeGreaterThanOrEqual(todayStart.getTime())
    }
  })
})
