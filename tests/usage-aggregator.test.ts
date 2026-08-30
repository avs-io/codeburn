import { describe, expect, it, beforeAll, vi } from 'vitest'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildMenubarPayloadForRange } from '../src/usage-aggregator.js'
import { getDateRange } from '../src/cli-date.js'
import { loadPricing } from '../src/models.js'
import { createCodexProvider } from '../src/providers/codex.js'

describe('buildMenubarPayloadForRange', () => {
  beforeAll(async () => {
    await loadPricing()
  })

  it('returns a valid payload and skips optimize findings when optimize:false', async () => {
    const payload = await buildMenubarPayloadForRange(getDateRange('today'), { provider: 'all', optimize: false })
    expect(typeof payload.current.label).toBe('string')
    expect(payload.current.cost).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(payload.current.topProjects)).toBe(true)
    expect(Array.isArray(payload.current.topModels)).toBe(true)
    expect(Array.isArray(payload.history.daily)).toBe(true)
    expect(payload.history.timeline?.bucketMinutes).toBe(15)
    expect(Array.isArray(payload.history.timeline?.points)).toBe(true)
    expect(payload.current.retryTax.totalUSD).toBeGreaterThanOrEqual(0)
    // Codex credits are always present in the payload (display gates them); 0 with no data.
    expect(typeof payload.current.codexCredits).toBe('number')
    expect(payload.current.codexCredits).toBeGreaterThanOrEqual(0)
    // optimize:false => scanAndDetect skipped => empty optimize block regardless of data
    expect(payload.optimize).toEqual({ findingCount: 0, savingsUSD: 0, topFindings: [] })
    expect(payload.stale).toBeUndefined()
  })
})

describe('installed-but-zero provider tabs', () => {
  it('does not list Codex session files just to keep a $0 tab', async () => {
    const home = join(tmpdir(), `codeburn-zero-cost-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    const dayDir = join(home, 'sessions', '2026', '04', '14')
    await mkdir(dayDir, { recursive: true })
    await writeFile(join(dayDir, 'rollout-abc123.jsonl'), JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-04-14T10:00:00Z',
      payload: { cwd: '/tmp/proj', originator: 'codex-cli', session_id: 'sess-1', model: 'gpt-5.3-codex' },
    }) + '\n')
    const provider = createCodexProvider(home)
    const discover = vi.spyOn(provider, 'discoverSessions')
    await expect((await import('../src/providers/index.js')).hasDetectableSessions(provider)).resolves.toBe(true)
    expect(discover).not.toHaveBeenCalled()
  })
})
