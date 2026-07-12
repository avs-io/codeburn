// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenubarPayload, YieldJsonReport } from '../lib/types'
import { Optimize, OptimizeContent } from './Optimize'

const { getOverview, getYield } = vi.hoisted(() => ({
  getOverview: vi.fn<(period: string, provider: string) => Promise<MenubarPayload>>(),
  getYield: vi.fn<(period: string) => Promise<YieldJsonReport>>(),
}))
vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, codeburn: { getOverview, getYield } }
})

function makePayload(): MenubarPayload {
  return {
    generated: '2026-07-10T19:00:00.000Z',
    current: {
      label: 'Last 30 days',
      cost: 612.48,
      calls: 1220,
      sessions: 88,
      oneShotRate: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheHitPercent: 0,
      codexCredits: 0,
      topActivities: [],
      topModels: [],
      localModelSavings: { totalUSD: 0, calls: 0, byModel: [], byProvider: [] },
      providers: {},
      topProjects: [],
      modelEfficiency: [],
      topSessions: [],
      retryTax: { totalUSD: 0, retries: 0, editTurns: 0, byModel: [] },
      routingWaste: { totalSavingsUSD: 0, baselineModel: '', baselineCostPerEdit: 0, byModel: [] },
      tools: [],
      skills: [],
      subagents: [],
      mcpServers: [],
    },
    optimize: {
      findingCount: 3,
      savingsUSD: 94.4,
      topFindings: [
        { title: 'Opus is doing your small talk', impact: 'high', savingsUSD: 9.1 },
        { title: 'Cache hit is low in agentseal-dash', impact: 'medium', savingsUSD: 8.7 },
        { title: 'Batch tiny requests', impact: 'low', savingsUSD: 2.4 },
      ],
    },
    history: { daily: [] },
  }
}

function makeYield(): YieldJsonReport {
  return {
    period: { label: 'Last 30 days', start: '2026-06-11', end: '2026-07-10' },
    summary: {
      productive: { costUSD: 440, sessions: 19, costPercent: 72, sessionPercent: 70 },
      reverted: { costUSD: 107, sessions: 4, costPercent: 17, sessionPercent: 15 },
      abandoned: { costUSD: 65.4, sessions: 3, costPercent: 11, sessionPercent: 15 },
      total: { costUSD: 612.4, sessions: 26 },
      productiveToRevertedCostRatio: 4.1,
    },
    details: [
      { sessionId: 'rev-1', project: 'codeburn', category: 'reverted', commitCount: 2, costUSD: 55 },
      { sessionId: 'rev-2', project: 'agentseal-dash', category: 'reverted', commitCount: 1, costUSD: 52 },
      { sessionId: 'abn-1', project: 'sandbox-spike', category: 'abandoned', commitCount: 0, costUSD: 65.4 },
      { sessionId: 'prod-1', project: 'desktop-app', category: 'productive', commitCount: 5, costUSD: 440 },
    ],
  }
}

function emptyPayload(): MenubarPayload {
  const payload = makePayload()
  payload.optimize = { findingCount: 0, savingsUSD: 0, topFindings: [] }
  return payload
}

function emptyYield(): YieldJsonReport {
  const report = makeYield()
  report.summary.reverted = { costUSD: 0, sessions: 0, costPercent: 0, sessionPercent: 0 }
  report.summary.abandoned = { costUSD: 0, sessions: 0, costPercent: 0, sessionPercent: 0 }
  report.details = []
  return report
}

describe('Optimize', () => {
  beforeEach(() => {
    getOverview.mockReset()
    getYield.mockReset()
  })

  it('renders findings, reverted sessions, and abandoned sessions together with section totals', async () => {
    getOverview.mockResolvedValue(makePayload())
    getYield.mockResolvedValue(makeYield())

    render(<Optimize period="30days" provider="all" />)

    expect(await screen.findByText('Opus is doing your small talk')).toBeInTheDocument()
    expect(screen.getByText('High')).toHaveClass('opt-impact-high')
    expect(screen.getByText('Medium')).toHaveClass('opt-impact-medium')
    expect(screen.getByText('Low')).toHaveClass('opt-impact-low')
    expect(screen.getByText('$9.10')).toBeInTheDocument()
    expect(screen.getByText('Cache hit is low in agentseal-dash')).toBeInTheDocument()
    expect(screen.getByText('Optimization findings · 3 findings · $94.40 potential')).toBeInTheDocument()
    expect(screen.getByText('Reverted sessions · $107.00')).toBeInTheDocument()
    expect(screen.getByText('Abandoned sessions · $65.40')).toBeInTheDocument()
    expect(screen.getByText('codeburn')).toBeInTheDocument()
    expect(screen.getByText('2 commits · rev-1')).toBeInTheDocument()
    expect(screen.getByText('$55.00')).toBeInTheDocument()
    expect(screen.getByText('agentseal-dash')).toBeInTheDocument()
    expect(screen.getByText('sandbox-spike')).toBeInTheDocument()
    expect(screen.getByText('0 commits · abn-1')).toBeInTheDocument()
    expect(screen.getByText('$65.40')).toHaveClass('val')
    expect(screen.getByText('$65.40')).not.toHaveClass('ok')
    expect(screen.queryByText('desktop-app')).not.toBeInTheDocument()
  })

  it('renders an honest placeholder for unavailable yield totals and list bodies', async () => {
    getOverview.mockResolvedValue(makePayload())
    getYield.mockRejectedValue(new Error('yield failed'))

    render(<Optimize period="30days" provider="all" />)

    expect(await screen.findByText('Reverted sessions · —')).toBeInTheDocument()
    expect(screen.getByText('Abandoned sessions · —')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('shows one compact empty note and hides all empty sections', async () => {
    getOverview.mockResolvedValue(emptyPayload())
    getYield.mockResolvedValue(emptyYield())

    render(<Optimize period="30days" provider="all" />)

    expect(await screen.findByText('No waste findings in this range yet.')).toBeInTheDocument()
    expect(screen.queryByText(/Optimization findings ·/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Reverted sessions ·/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Abandoned sessions ·/)).not.toBeInTheDocument()
  })

  it('hides only yield sections whose category has no rows', async () => {
    const report = makeYield()
    report.summary.abandoned = { costUSD: 0, sessions: 0, costPercent: 0, sessionPercent: 0 }
    report.details = report.details.filter(row => row.category !== 'abandoned')
    getOverview.mockResolvedValue(makePayload())
    getYield.mockResolvedValue(report)

    render(<Optimize period="30days" provider="all" />)

    expect(await screen.findByText('Reverted sessions · $107.00')).toBeInTheDocument()
    expect(screen.queryByText(/Abandoned sessions ·/)).not.toBeInTheDocument()
    expect(screen.getByText('Optimization findings · 3 findings · $94.40 potential')).toBeInTheDocument()
  })

  it('keeps last-good yield totals and rows visible during revalidation', async () => {
    getYield.mockResolvedValueOnce(makeYield()).mockImplementation(() => new Promise<YieldJsonReport>(() => {}))
    const overview = {
      data: makePayload(),
      error: null,
      loading: false,
      lastSuccessAt: Date.now(),
      refresh: vi.fn(),
    }

    const { rerender } = render(<OptimizeContent period="30days" overview={overview} refreshToken={0} />)

    expect(await screen.findByText('Reverted sessions · $107.00')).toBeInTheDocument()
    expect(screen.getByText('codeburn')).toBeInTheDocument()

    rerender(<OptimizeContent period="30days" overview={overview} refreshToken={1} />)
    await waitFor(() => expect(getYield).toHaveBeenCalledTimes(2))

    expect(screen.getByText('Reverted sessions · $107.00')).toBeInTheDocument()
    expect(screen.getByText('codeburn')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })
})
