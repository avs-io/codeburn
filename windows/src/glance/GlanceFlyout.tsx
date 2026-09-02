import { FlameIcon } from '../components/Icons'
import { COPY } from './copy'
import type { GlanceView } from './model'
import { Sparkline } from './Sparkline'
import './glance.css'

type Props = {
  view: GlanceView
  busy?: boolean
  onPrimary: () => void
  onSecondary: () => void
}

function MoneyRow(props: {
  label: string
  display: string | null
  empty: boolean
  qualifier: string | null
}) {
  return (
    <div className="glance-row">
      <span className="glance-label">{props.label}</span>
      <div className="glance-value-col">
        {props.empty ? (
          <span className="glance-empty">{COPY.empty}</span>
        ) : props.display ? (
          <>
            <span className="glance-value">{props.display}</span>
            {props.qualifier ? <span className="glance-qual">{props.qualifier}</span> : null}
          </>
        ) : null}
      </div>
    </div>
  )
}

export function GlanceFlyout({ view, busy, onPrimary, onSecondary }: Props) {
  const cliMissing = view.kind === 'cli-missing'
  const showGlanceRows = !cliMissing && (view.today.display || view.today.empty || view.week.display || view.week.empty)

  return (
    <div className={`glance${view.dimmed ? ' glance-dimmed' : ''}`} data-kind={view.kind}>
      <header className="glance-header">
        <FlameIcon filled className="glance-flame" size={18} />
        <div className="glance-titles">
          <h1 className="glance-title">{view.title}</h1>
          <p className="glance-sub">{view.subtitle}</p>
        </div>
      </header>

      {view.kind === 'loading' && view.body ? (
        <p className="glance-loading-line" role="status">{view.body}</p>
      ) : null}

      {cliMissing && view.body ? <p className="glance-body">{view.body}</p> : null}

      {view.kind === 'error' && view.body ? <p className="glance-body">{view.body}</p> : null}

      {view.kind === 'empty' && view.body && !view.today.empty && !view.week.empty ? (
        <p className="glance-body">{view.body}</p>
      ) : null}

      {showGlanceRows && (view.today.display || view.today.empty || view.week.display || view.week.empty) ? (
        <div className="glance-rows">
          <MoneyRow
            label={COPY.today}
            display={view.today.display}
            empty={view.today.empty}
            qualifier={view.today.display ? COPY.qualifier : null}
          />
          {(view.week.display || view.week.empty) && (
            <MoneyRow
              label={COPY.last7Days}
              display={view.week.display}
              empty={view.week.empty}
              qualifier={view.week.display ? view.weekRange : null}
            />
          )}
        </div>
      ) : null}

      {view.sparkline.length > 0 ? <Sparkline values={view.sparkline} /> : null}
      {view.statusLine ? <p className="glance-status">{view.statusLine}</p> : null}

      <div className="glance-actions">
        <button
          type="button"
          className={`glance-btn glance-btn-primary${cliMissing ? ' glance-btn-ink' : ''}`}
          onClick={onPrimary}
          disabled={busy}
        >
          {view.primaryLabel}
        </button>
        <button
          type="button"
          className="glance-btn glance-btn-secondary"
          onClick={onSecondary}
          disabled={busy && view.kind !== 'cli-missing'}
        >
          {view.secondaryLabel}
        </button>
      </div>

      {view.pinHint ? <p className="glance-pin">{COPY.pinHint}</p> : null}
    </div>
  )
}
