import { describe, expect, it } from 'vitest'
import { COPY } from './copy'
import { buildGlanceView, sparklineFrom, statusLineFrom } from './model'
import type { MenubarPayload } from '../lib/payload'

function payload(partial: {
  cost: number
  sessions: number
  calls: number
  project?: string
  model?: string
  daily?: Array<{ date: string; cost: number }>
}): MenubarPayload {
  return {
    generated: '2026-08-30T12:00:00',
    current: {
      label: 'today',
      cost: partial.cost,
      calls: partial.calls,
      sessions: partial.sessions,
      oneShotRate: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheHitPercent: 0,
      topActivities: [],
      topModels: partial.model ? [{ name: partial.model, cost: partial.cost, calls: partial.calls }] : [],
      providers: {},
      topProjects: partial.project
        ? [{ name: partial.project, sessions: partial.sessions, cost: partial.cost }]
        : undefined,
    },
    optimize: { findingCount: 0, savingsUSD: 0, topFindings: [] },
    history: {
      daily: (partial.daily ?? []).map(row => ({
        date: row.date,
        cost: row.cost,
        calls: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })),
    },
  } as MenubarPayload
}

const now = new Date(2026, 7, 30)

describe('buildGlanceView', () => {
  it('shows Locate CLI and never a fake $0 when the CLI is missing', () => {
    const view = buildGlanceView({
      cliFound: false,
      today: null,
      week: null,
      error: 'CLI not found',
      refreshing: false,
      hasEverSucceeded: false,
      pinHint: false,
    })
    expect(view.kind).toBe('cli-missing')
    expect(view.subtitle).toBe(COPY.cliMissingTitle)
    expect(view.body).toBe(COPY.cliMissingBody)
    expect(view.primaryLabel).toBe(COPY.locateCli)
    expect(view.secondaryLabel).toBe(COPY.quit)
    expect(view.today.display).toBeNull()
    expect(view.week.display).toBeNull()
  })

  it('keeps last-good numbers dimmed while refreshing', () => {
    const today = payload({ cost: 42.1, sessions: 6, calls: 12, project: 'checkout-api', model: 'claude-sonnet' })
    const week = payload({
      cost: 1284,
      sessions: 20,
      calls: 80,
      daily: [
        { date: '2026-08-24', cost: 100 },
        { date: '2026-08-30', cost: 42.1 },
      ],
    })
    const view = buildGlanceView({
      cliFound: true,
      today,
      week,
      error: null,
      refreshing: true,
      hasEverSucceeded: true,
      pinHint: true,
      now,
    })
    expect(view.kind).toBe('loading')
    expect(view.body).toBe(COPY.loading)
    expect(view.dimmed).toBe(true)
    expect(view.today.display).toBe('$42.10')
    expect(view.week.display).toBe('$1,284')
    expect(view.primaryLabel).toBe(COPY.openCodeBurn)
  })

  it('keeps last-good numbers and Retry after a later failed read', () => {
    const today = payload({ cost: 42.1, sessions: 6, calls: 12 })
    const week = payload({ cost: 1284, sessions: 20, calls: 80 })
    const view = buildGlanceView({
      cliFound: true,
      today,
      week,
      error: 'spawn failed',
      refreshing: false,
      hasEverSucceeded: true,
      pinHint: false,
      now,
    })
    expect(view.kind).toBe('error')
    expect(view.body).toBe(COPY.error)
    expect(view.today.display).toBe('$42.10')
    expect(view.dimmed).toBe(true)
    expect(view.primaryLabel).toBe(COPY.openCodeBurn)
    expect(view.secondaryLabel).toBe(COPY.retry)
  })

  it('surfaces an honest error instead of $0 on a failed first read', () => {
    const view = buildGlanceView({
      cliFound: true,
      today: null,
      week: null,
      error: 'spawn failed',
      refreshing: false,
      hasEverSucceeded: false,
      pinHint: false,
    })
    expect(view.kind).toBe('error')
    expect(view.body).toBe(COPY.error)
    expect(view.primaryLabel).toBe(COPY.retry)
    expect(view.today.display).toBeNull()
  })

  it('uses empty copy when both periods have no sessions', () => {
    const empty = payload({ cost: 0, sessions: 0, calls: 0 })
    const view = buildGlanceView({
      cliFound: true,
      today: empty,
      week: empty,
      error: null,
      refreshing: false,
      hasEverSucceeded: true,
      pinHint: true,
      now,
    })
    expect(view.kind).toBe('empty')
    expect(view.body).toBe(COPY.empty)
    expect(view.today.display).toBeNull()
  })

  it('builds the glance row, slate sparkline, and status line', () => {
    const today = payload({ cost: 42.1, sessions: 6, calls: 12, project: 'checkout-api', model: 'claude-sonnet' })
    const week = payload({
      cost: 1284,
      sessions: 20,
      calls: 80,
      daily: [
        { date: '2026-08-24', cost: 10 },
        { date: '2026-08-25', cost: 20 },
        { date: '2026-08-30', cost: 42.1 },
      ],
    })
    const view = buildGlanceView({
      cliFound: true,
      today,
      week,
      error: null,
      refreshing: false,
      hasEverSucceeded: true,
      pinHint: false,
      now,
    })
    expect(view.kind).toBe('glance')
    expect(view.subtitle).toBe(COPY.reassurance)
    expect(view.today.display).toBe('$42.10')
    expect(view.week.display).toBe('$1,284')
    expect(view.weekRange).toBe('Aug 24-30')
    expect(view.sparkline).toHaveLength(7)
    expect(view.statusLine).toBe('checkout-api · 6 sessions · Claude Sonnet')
    expect(view.primaryLabel).toBe(COPY.openCodeBurn)
    expect(view.secondaryLabel).toBe(COPY.refresh)
  })
})

describe('statusLineFrom / sparklineFrom', () => {
  it('omits a status line when there is nothing to say', () => {
    expect(statusLineFrom(payload({ cost: 0, sessions: 0, calls: 0 }))).toBeNull()
  })

  it('hides an all-zero sparkline instead of painting fake bars', () => {
    const week = payload({
      cost: 0,
      sessions: 1,
      calls: 1,
      daily: [{ date: '2026-08-24', cost: 0 }, { date: '2026-08-30', cost: 0 }],
    })
    expect(sparklineFrom(week, now)).toEqual([])
  })
})
