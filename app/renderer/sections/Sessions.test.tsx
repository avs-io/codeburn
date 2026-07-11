// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionRow } from '../lib/types'
import { Sessions } from './Sessions'

const { getSessions } = vi.hoisted(() => ({
  getSessions: vi.fn<(period: string, provider: string) => Promise<SessionRow[]>>(),
}))
vi.mock('../lib/ipc', async orig => {
  const actual = await orig<typeof import('../lib/ipc')>()
  return { ...actual, codeburn: { getSessions } }
})

const rows: SessionRow[] = [
  {
    sessionId: 'claude-session-123456789',
    project: 'codeburn',
    provider: 'claude',
    models: ['Opus 4.8'],
    cost: 8.41,
    savingsUSD: 1.25,
    calls: 44,
    turns: 41,
    inputTokens: 1_420_000,
    outputTokens: 64_000,
    cacheReadTokens: 1_130_000,
    cacheWriteTokens: 12_000,
    startedAt: '2026-07-11T10:00:00.000Z',
    endedAt: '2026-07-11T11:35:00.000Z',
    durationMs: 5_700_000,
  },
  {
    sessionId: 'codex-session-987654321',
    project: 'client-api',
    provider: 'codex',
    models: ['GPT-5.5 Codex'],
    cost: 3.92,
    savingsUSD: 0,
    calls: 25,
    turns: 22,
    inputTokens: 120_000,
    outputTokens: 16_000,
    cacheReadTokens: 40_000,
    cacheWriteTokens: 4_000,
    startedAt: '2026-07-10T10:00:00.000Z',
    endedAt: '2026-07-10T10:30:00.000Z',
    durationMs: 1_800_000,
  },
]

describe('Sessions', () => {
  beforeEach(() => getSessions.mockReset())

  it('groups real rows by provider and opens the four-stat detail', async () => {
    getSessions.mockResolvedValue(rows)
    const { container } = render(<Sessions period="30days" provider="all" />)

    expect(await screen.findByText('Claude · 1 session · $8.41')).toBeInTheDocument()
    expect(screen.getByText('Codex · 1 session · $3.92')).toBeInTheDocument()
    expect(screen.getByText('codeburn')).toBeInTheDocument()
    expect(screen.getByText('client-api')).toBeInTheDocument()
    expect(screen.getByText('$8.41')).toBeInTheDocument()
    expect(screen.getByText('$3.92')).toBeInTheDocument()
    expect(screen.getByText('claude-session-123')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /codeburn/ }))

    expect(await screen.findByRole('button', { name: '← Back to sessions' })).toBeInTheDocument()
    expect(container.querySelectorAll('.stat')).toHaveLength(4)
    for (const label of ['Cost', 'Input', 'Output', 'Cache read']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('Saved $1.25 vs baseline')).toBeInTheDocument()
    expect(screen.getByText('Duration 1h 35m')).toBeInTheDocument()
    expect(screen.queryByText('Context window')).not.toBeInTheDocument()
  })

  it('renders the honest empty state', async () => {
    getSessions.mockResolvedValue([])
    render(<Sessions period="week" provider="all" />)
    expect(await screen.findByText('No sessions in this range yet.')).toBeInTheDocument()
  })
})
