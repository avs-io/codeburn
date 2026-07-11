import { useState } from 'react'

import { CliErrorPanel } from '../components/CliErrorPanel'
import { Panel } from '../components/Panel'
import { Stat } from '../components/Stat'
import { usePolled } from '../hooks/usePolled'
import { formatUsd } from '../lib/format'
import { codeburn } from '../lib/ipc'
import type { DateRange, Period, SessionRow } from '../lib/types'

function fmtCompact(n: number): string {
  if (n === 0) return '0'
  if (n < 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: n >= 10_000_000 ? 1 : 2,
  }).format(n)
}

function providerName(provider: string): string {
  return provider
    .split(/[-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function durationLabel(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>{children}</p>
}

export function Sessions({
  period,
  provider,
  range = null,
  refreshToken = 0,
}: {
  period: Period
  provider: string
  range?: DateRange | null
  refreshToken?: number
}) {
  const [selected, setSelected] = useState<SessionRow | null>(null)
  const report = usePolled<SessionRow[]>(
    () => range ? codeburn.getSessions(period, provider, range) : codeburn.getSessions(period, provider),
    [period, provider, range?.from, range?.to, refreshToken],
  )

  if (!report.data) {
    if (report.error) return <CliErrorPanel error={report.error} subject="sessions" />
    return (
      <Panel title="Sessions">
        <EmptyNote>Scanning sessions…</EmptyNote>
      </Panel>
    )
  }

  if (selected) return <SessionDetail session={selected} onBack={() => setSelected(null)} />

  if (!report.data.length) {
    return (
      <Panel title="Sessions">
        <EmptyNote>No sessions in this range yet.</EmptyNote>
      </Panel>
    )
  }

  const grouped = report.data.reduce((map, row) => {
    const rows = map.get(row.provider) ?? []
    rows.push(row)
    map.set(row.provider, rows)
    return map
  }, new Map<string, SessionRow[]>())
  const groups = [...grouped.entries()]
    .map(([name, rows]) => ({
      name,
      rows: [...rows].sort((a, b) => b.cost - a.cost),
      cost: rows.reduce((sum, row) => sum + row.cost, 0),
    }))
    .sort((a, b) => b.cost - a.cost)

  return (
    <div className="sessions-list-view">
      <div className="session-list">
        {groups.map(group => (
          <div className="session-provider" key={group.name}>
            <div className="provider-h">
              {providerName(group.name)} · {group.rows.length.toLocaleString('en-US')} {group.rows.length === 1 ? 'session' : 'sessions'} · {formatUsd(group.cost)}
            </div>
            {group.rows.map(row => (
              <button className="session-row" key={row.sessionId} type="button" onClick={() => setSelected(row)}>
                <span className="session-primary">
                  <span className="session-title">{row.project}</span>
                  <span className="session-project">{String(row.sessionId).slice(0, 18)}</span>
                </span>
                <span className="session-meta">
                  <span>{row.models.join(', ')}</span>
                  <span>{row.turns} turns</span>
                  <span>{formatUsd(row.cost)}</span>
                  <span>{fmtCompact(row.inputTokens + row.outputTokens)} tok</span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionDetail({ session, onBack }: { session: SessionRow; onBack: () => void }) {
  const cacheTotal = session.inputTokens + session.cacheReadTokens
  const cacheHit = cacheTotal > 0 ? `${Math.round(session.cacheReadTokens / cacheTotal * 100)}% hit` : '—'

  return (
    <div className="session-detail">
      <button className="back-link" type="button" onClick={onBack}>← Back to sessions</button>
      <div className="panel detail-head">
        <h3 className="detail-title">{session.project}</h3>
        <div className="detail-line">
          {session.provider} · {session.models.join(', ')} · {new Date(session.startedAt).toLocaleDateString()} · {formatUsd(session.cost)} · {session.turns} turns
        </div>
      </div>
      <div className="stats">
        <Stat label="Cost" value={formatUsd(session.cost)} delta="this session" />
        <Stat label="Input" value={fmtCompact(session.inputTokens)} delta="tokens sent" />
        <Stat label="Output" value={fmtCompact(session.outputTokens)} delta="tokens generated" />
        <Stat label="Cache read" value={fmtCompact(session.cacheReadTokens)} delta={cacheHit} />
      </div>
      {(session.savingsUSD > 0 || session.durationMs > 0) && (
        <div className="session-detail-notes">
          {session.savingsUSD > 0 && <span>Saved {formatUsd(session.savingsUSD)} vs baseline</span>}
          {session.durationMs > 0 && <span>Duration {durationLabel(session.durationMs)}</span>}
        </div>
      )}
    </div>
  )
}
