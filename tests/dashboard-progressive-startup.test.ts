import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assembleDashboardFirstPaint, buildDashboardHistoryIndex, selectDashboardHistoryIndex } from '../src/dashboard.js'
import { getDateRange, type Period } from '../src/cli-date.js'
import { clearSessionCache, filesParsedFromSourceCount, parseAllSessions } from '../src/parser.js'
import { clearLoadCacheMemo, isColdCacheOnDisk } from '../src/session-cache.js'
import { buildDurablePeriod } from '../src/usage-aggregator.js'

const DAY_MS = 24 * 60 * 60 * 1000

let tmpDir: string
const originalHome = process.env['HOME']

beforeEach(async () => {
  clearSessionCache()
  clearLoadCacheMemo()
  tmpDir = await mkdtemp(join(tmpdir(), 'dashboard-progressive-'))
  process.env['HOME'] = tmpDir
  process.env['CLAUDE_CONFIG_DIR'] = tmpDir
  process.env['CODEBURN_CACHE_DIR'] = join(tmpDir, 'cache')
  process.env['CODEBURN_DESKTOP_SESSIONS_DIR'] = join(tmpDir, 'desktop-sessions')
})

afterEach(async () => {
  clearSessionCache()
  clearLoadCacheMemo()
  delete process.env['CLAUDE_CONFIG_DIR']
  delete process.env['CODEBURN_CACHE_DIR']
  delete process.env['CODEBURN_DESKTOP_SESSIONS_DIR']
  if (originalHome == null) delete process.env['HOME']
  else process.env['HOME'] = originalHome
  await rm(tmpDir, { recursive: true, force: true })
})

async function writeSession(name: string, ageDays: number): Promise<void> {
  const dir = join(tmpDir, 'projects', 'proj')
  await mkdir(dir, { recursive: true })
  const at = new Date(Date.now() - ageDays * DAY_MS)
  const path = join(dir, `${name}.jsonl`)
  await writeFile(path, `${JSON.stringify({
    type: 'assistant',
    sessionId: name,
    timestamp: at.toISOString(),
    cwd: '/tmp/proj',
    message: {
      id: `msg-${name}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  })}\n`)
  await utimes(path, at, at)
}

describe('interactive dashboard progressive startup', () => {
  it('paints Today first even when the normalized session cache is already complete', async () => {
    await writeSession('today', 0)
    await writeSession('old', 90)
    const configDir = join(tmpDir, '.config', 'codeburn')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'config.json'), JSON.stringify({
      plans: { claude: { id: 'claude-max', monthlyUsd: 200, resetDay: 1 } },
    }))

    await parseAllSessions(getDateRange('lifetime').range, 'all')
    await buildDurablePeriod(getDateRange('lifetime'), { provider: 'all' })
    expect(await isColdCacheOnDisk()).toBe(false)
    clearSessionCache()
    clearLoadCacheMemo()

    const parsedBefore = filesParsedFromSourceCount()
    const paint = await assembleDashboardFirstPaint(
      'today', 'all', undefined, undefined, null, null, false,
    )

    expect(paint.result.period).toBe('today')
    expect(paint.result.scannedProjects.flatMap(project => project.sessions).map(session => session.sessionId)).toEqual(['today'])
    expect(paint.result.planUsages).toEqual([])
    expect(paint.deferredFiles).toBe(1)
    expect(filesParsedFromSourceCount() - parsedBefore).toBe(0)
  })

  it('projects every period from one normalized lifetime index without returning to source files', async () => {
    const periods: Period[] = ['today', 'week', '30days', 'month', 'all', 'lifetime']
    await Promise.all([
      writeSession('today', 0),
      writeSession('week', 5),
      writeSession('month', 20),
      writeSession('older', 45),
      writeSession('six-months', 120),
      writeSession('lifetime', 500),
    ])

    const baseline = new Map<Period, Awaited<ReturnType<typeof buildDurablePeriod>>>()
    for (const period of periods) {
      baseline.set(period, await buildDurablePeriod(getDateRange(period), { provider: 'all' }))
    }

    const index = await buildDashboardHistoryIndex('all', undefined, undefined)
    const parsedAfterIndex = filesParsedFromSourceCount()
    await rm(join(tmpDir, 'projects'), { recursive: true, force: true })

    for (const period of periods) {
      const selected = selectDashboardHistoryIndex(index, period)
      const expected = baseline.get(period)!
      expect(selected.durable).toEqual({
        cost: expected.data.cost,
        savingsUSD: expected.data.savingsUSD,
        calls: expected.data.calls,
        sessions: expected.data.sessions,
        inputTokens: expected.data.inputTokens,
        outputTokens: expected.data.outputTokens,
        cacheReadTokens: expected.data.cacheReadTokens,
        cacheWriteTokens: expected.data.cacheWriteTokens,
        carriedCostUSD: expected.carriedCostUSD,
      })
      expect(selected.projects.flatMap(project => project.sessions).map(session => session.sessionId).sort())
        .toEqual(expected.liveProjects.flatMap(project => project.sessions).map(session => session.sessionId).sort())
    }
    expect(filesParsedFromSourceCount()).toBe(parsedAfterIndex)
  })
})
