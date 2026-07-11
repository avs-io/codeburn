import { useState } from 'react'

import { Panel } from '../components/Panel'
import { SegTabs } from '../components/SegTabs'
import { type Polled, usePolled } from '../hooks/usePolled'
import { codeburn } from '../lib/ipc'
import type { MenubarPayload, Period, SessionYieldJson, YieldJsonReport } from '../lib/types'

type OptimizeTab = 'waste' | 'reverts' | 'abandoned' | 'fixes'

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>{children}</p>
}

export function Optimize({ period, provider }: { period: Period; provider: string }) {
  const overview = usePolled<MenubarPayload>(() => codeburn.getOverview(period, provider), [period, provider])
  const yieldReport = usePolled<YieldJsonReport>(() => codeburn.getYield(period), [period])
  const [tab, setTab] = useState<OptimizeTab>('waste')

  if (!overview.data) {
    if (overview.error?.kind === 'not-found') {
      return (
        <Panel title="Locate the codeburn CLI">
          <p style={{ color: 'var(--t2)', margin: '0 0 6px', fontSize: 12.5 }}>
            CodeBurn Desktop reads your usage by running the{' '}
            <code style={{ fontFamily: 'var(--mono)', color: 'var(--lav)' }}>codeburn</code> command, but it isn&apos;t
            on your PATH yet.
          </p>
          <p style={{ color: 'var(--t3)', margin: 0, fontSize: 11.5 }}>
            Install it with <code style={{ fontFamily: 'var(--mono)', color: 'var(--lav)' }}>npm i -g codeburn</code>,
            then reopen this window.
          </p>
        </Panel>
      )
    }
    if (overview.error) {
      return (
        <Panel title="Couldn't read optimize">
          <p style={{ color: 'var(--red)', margin: 0, fontSize: 12 }}>{overview.error.message}</p>
        </Panel>
      )
    }
    return (
      <Panel title="Optimize">
        <EmptyNote>Scanning optimize findings…</EmptyNote>
      </Panel>
    )
  }

  const yieldData = !yieldReport.loading && !yieldReport.error ? yieldReport.data : null
  const revertedTotal = yieldData ? fmtUsd(yieldData.summary.reverted.costUSD) : '—'
  const abandonedTotal = yieldData ? fmtUsd(yieldData.summary.abandoned.costUSD) : '—'
  const options = [
    { value: 'waste', label: `Waste ${fmtUsd(overview.data.optimize.savingsUSD)}` },
    { value: 'reverts', label: `Reverts ${revertedTotal}` },
    { value: 'abandoned', label: `Abandoned ${abandonedTotal}` },
    { value: 'fixes', label: `Fixes ${overview.data.optimize.findingCount.toLocaleString('en-US')}` },
  ]

  return (
    <>
      <SegTabs
        options={options}
        value={tab}
        onChange={value => setTab(value as OptimizeTab)}
        style={{ alignSelf: 'flex-start' }}
      />
      <Panel>
        {tab === 'waste' ? (
          <WasteRows data={overview.data} />
        ) : tab === 'reverts' ? (
          <YieldRows report={yieldReport} category="reverted" empty="No reverted sessions in this range yet." />
        ) : tab === 'abandoned' ? (
          <YieldRows report={yieldReport} category="abandoned" empty="No abandoned sessions in this range yet." />
        ) : (
          <FixesRows data={overview.data} />
        )}
      </Panel>
    </>
  )
}

function WasteRows({ data }: { data: MenubarPayload }) {
  const findings = data.optimize.topFindings

  if (!findings.length) return <EmptyNote>No waste findings in this range yet.</EmptyNote>

  return (
    <>
      {findings.map((finding, i) => (
        <div className="li" style={{ alignItems: 'flex-start' }} key={`${finding.title}-${i}`}>
          <span className="no">{String(i + 1).padStart(2, '0')}</span>
          <div className="lx">
            <b>{finding.title}</b>
            <span>{finding.impact} impact</span>
          </div>
          <span className="val ok">{fmtUsd(finding.savingsUSD)}</span>
        </div>
      ))}
    </>
  )
}

function YieldRows({
  report,
  category,
  empty,
}: {
  report: Polled<YieldJsonReport>
  category: SessionYieldJson['category']
  empty: string
}) {
  if (report.loading || report.error) return <EmptyNote>—</EmptyNote>
  if (!report.data) return <EmptyNote>{empty}</EmptyNote>

  const rows = report.data.details.filter(row => row.category === category)
  if (!rows.length) return <EmptyNote>{empty}</EmptyNote>

  return (
    <>
      {rows.map((row, i) => (
        <div className="li" style={{ alignItems: 'flex-start' }} key={row.sessionId}>
          <span className="no">{String(i + 1).padStart(2, '0')}</span>
          <div className="lx">
            <b>{row.project}</b>
            <span>
              {row.commitCount.toLocaleString('en-US')} {row.commitCount === 1 ? 'commit' : 'commits'} · {row.sessionId}
            </span>
          </div>
          <span className="val">{fmtUsd(row.costUSD)}</span>
        </div>
      ))}
    </>
  )
}

function FixesRows({ data }: { data: MenubarPayload }) {
  const count = data.optimize.findingCount
  if (!count) return <EmptyNote>No fixes in this range yet.</EmptyNote>

  return (
    <div className="li" style={{ alignItems: 'flex-start' }}>
      <span className="no">{String(count).padStart(2, '0')}</span>
      <div className="lx">
        <b>
          {count.toLocaleString('en-US')} findings · {fmtUsd(data.optimize.savingsUSD)} potential
        </b>
      </div>
    </div>
  )
}
