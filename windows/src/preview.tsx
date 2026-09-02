import React from 'react'
import ReactDOM from 'react-dom/client'
import { GlanceFlyout } from './glance/GlanceFlyout'
import { buildGlanceView } from './glance/model'
import type { MenubarPayload } from './lib/payload'
import { applyTheme } from './lib/settings'
import './styles.css'

applyTheme('dark')

function payload(partial: {
  cost: number
  sessions: number
  calls: number
  project?: string
  model?: string
  daily?: Array<{ date: string; cost: number }>
}): MenubarPayload {
  return {
    generated: '2026-08-30T14:12:00',
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
  }
}

const now = new Date(2026, 7, 30)

const glance = buildGlanceView({
  cliFound: true,
  today: payload({
    cost: 42.1,
    sessions: 6,
    calls: 12,
    project: 'checkout-api',
    model: 'claude-sonnet',
  }),
  week: payload({
    cost: 1284,
    sessions: 20,
    calls: 80,
    daily: [
      { date: '2026-08-24', cost: 80 },
      { date: '2026-08-25', cost: 140 },
      { date: '2026-08-26', cost: 220 },
      { date: '2026-08-27', cost: 190 },
      { date: '2026-08-28', cost: 260 },
      { date: '2026-08-29', cost: 352 },
      { date: '2026-08-30', cost: 42.1 },
    ],
  }),
  error: null,
  refreshing: false,
  hasEverSucceeded: true,
  pinHint: false,
  now,
})

const missing = buildGlanceView({
  cliFound: false,
  today: null,
  week: null,
  error: 'CLI not found',
  refreshing: false,
  hasEverSucceeded: false,
  pinHint: false,
})

const overflow = buildGlanceView({
  cliFound: true,
  today: payload({ cost: 42.1, sessions: 6, calls: 12 }),
  week: payload({ cost: 1284, sessions: 20, calls: 80 }),
  error: null,
  refreshing: false,
  hasEverSucceeded: true,
  pinHint: true,
  now,
})

function Frame({ title, view }: { title: string; view: typeof glance }) {
  return (
    <section className="preview-frame">
      <h2>{title}</h2>
      <div className="popover glance-shell preview-card">
        <GlanceFlyout view={view} onPrimary={() => {}} onSecondary={() => {}} />
      </div>
    </section>
  )
}

function Preview() {
  return (
    <main className="preview-page">
      <Frame title="1 · Glance" view={glance} />
      <Frame title="2 · CLI not found" view={missing} />
      <Frame title="3 · Tray overflow pin hint" view={overflow} />
    </main>
  )
}

const style = document.createElement('style')
style.textContent = `
  .preview-page {
    min-height: 100vh;
    margin: 0;
    padding: 32px;
    display: flex;
    flex-wrap: wrap;
    gap: 28px;
    background: #111;
    align-items: flex-start;
  }
  .preview-frame h2 {
    margin: 0 0 12px;
    color: #bbb;
    font: 600 13px/1.2 system-ui;
  }
  .preview-card {
    width: 312px;
    min-height: 240px;
    border-radius: 10px;
    background: rgba(28, 24, 22, 0.96);
    box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  }
`
document.head.appendChild(style)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
)
