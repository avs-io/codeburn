import { CliErrorPanel } from '../components/CliErrorPanel'
import { Panel } from '../components/Panel'
import { type Polled, usePolled } from '../hooks/usePolled'
import { formatUsd } from '../lib/format'
import { codeburn } from '../lib/ipc'
import type { DateRange, MenubarPayload, Period, SessionYieldJson, YieldJsonReport } from '../lib/types'

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p style={{ color: 'var(--t3)', margin: 0, fontSize: 12 }}>{children}</p>
}

export function Optimize({ period, provider, range = null }: { period: Period; provider: string; range?: DateRange | null }) {
  const overview = usePolled<MenubarPayload>(
    () => range ? codeburn.getOverview(period, provider, range) : codeburn.getOverview(period, provider),
    [period, provider, range?.from, range?.to],
  )
  return <OptimizeContent period={period} range={range} overview={overview} />
}

export function OptimizeContent({
  period,
  range = null,
  overview,
  refreshToken = 0,
}: {
  period: Period
  range?: DateRange | null
  overview: Polled<MenubarPayload>
  refreshToken?: number
}) {
  const yieldReport = usePolled<YieldJsonReport>(
    () => range ? codeburn.getYield(period, range) : codeburn.getYield(period),
    [period, range?.from, range?.to, refreshToken],
  )

  if (!overview.data) {
    if (overview.error) return <CliErrorPanel error={overview.error} subject="optimize findings" />
    return (
      <Panel title="Optimize">
        <EmptyNote>Scanning optimize findings…</EmptyNote>
      </Panel>
    )
  }

  const yieldData = yieldReport.error ? null : yieldReport.data
  const revertedTotal = yieldData ? formatUsd(yieldData.summary.reverted.costUSD) : '—'
  const abandonedTotal = yieldData ? formatUsd(yieldData.summary.abandoned.costUSD) : '—'
  const revertedRows = !yieldData || yieldData.details.some(row => row.category === 'reverted')
  const abandonedRows = !yieldData || yieldData.details.some(row => row.category === 'abandoned')
  const hasFindings = overview.data.optimize.topFindings.length > 0
  const isEmpty = !hasFindings && !revertedRows && !abandonedRows

  return (
    <>
      {hasFindings && (
        <Panel title={`Optimization findings · ${overview.data.optimize.findingCount.toLocaleString('en-US')} findings · ${formatUsd(overview.data.optimize.savingsUSD)} potential`}>
          <WasteRows data={overview.data} />
        </Panel>
      )}
      {revertedRows && (
        <Panel title={`Reverted sessions · ${revertedTotal}`}>
          <YieldRows report={yieldReport} category="reverted" empty="No reverted sessions in this range yet." />
        </Panel>
      )}
      {abandonedRows && (
        <Panel title={`Abandoned sessions · ${abandonedTotal}`}>
          <YieldRows report={yieldReport} category="abandoned" empty="No abandoned sessions in this range yet." />
        </Panel>
      )}
      {isEmpty && <EmptyNote>No waste findings in this range yet.</EmptyNote>}
    </>
  )
}

function WasteRows({ data }: { data: MenubarPayload }) {
  return <FindingRows findings={data.optimize.topFindings} empty="No waste findings in this range yet." />
}

type Finding = MenubarPayload['optimize']['topFindings'][number]

const IMPACT_ICON: Record<Finding['impact'], string> = {
  high: '↑',
  medium: '→',
  low: '↓',
}

function FindingRows({ findings, empty }: { findings: Finding[]; empty: string }) {
  if (!findings.length) return <EmptyNote>{empty}</EmptyNote>

  return (
    <div className="opt-findings">
      {findings.map((finding, i) => (
        <div className="opt-finding" key={`${finding.title}-${i}`}>
          <span className="opt-finding-rank">{String(i + 1).padStart(2, '0')}</span>
          <b className="opt-finding-title">{finding.title}</b>
          <span className={`opt-impact opt-impact-${finding.impact}`}>
            <span aria-hidden="true">{IMPACT_ICON[finding.impact]}</span>
            {finding.impact.charAt(0).toUpperCase() + finding.impact.slice(1)}
          </span>
          <span className="opt-finding-savings">{formatUsd(finding.savingsUSD)}</span>
        </div>
      ))}
    </div>
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
  if (report.error || !report.data) return <EmptyNote>—</EmptyNote>

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
          <span className="val">{formatUsd(row.costUSD)}</span>
        </div>
      ))}
    </>
  )
}
