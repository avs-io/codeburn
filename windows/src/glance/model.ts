import type { MenubarPayload } from '../lib/payload'
import { COPY } from './copy'
import { formatWeekRange, glanceMoney, weekWindow, type GlanceMoney } from './format'

export type GlanceKind = 'glance' | 'cli-missing' | 'error' | 'empty' | 'loading'

export type GlanceView = {
  kind: GlanceKind
  title: string
  subtitle: string
  body?: string
  today: GlanceMoney
  week: GlanceMoney
  weekRange: string | null
  sparkline: number[]
  statusLine: string | null
  /** Last-good numbers are on screen while a refresh is in flight. */
  dimmed: boolean
  pinHint: boolean
  primaryLabel: string
  secondaryLabel: string
}

type Project = { name: string; sessions?: number; cost?: number }

function asPayload(value: unknown): MenubarPayload | null {
  if (!value || typeof value !== 'object') return null
  const current = (value as MenubarPayload).current
  if (!current || typeof current !== 'object') return null
  return value as MenubarPayload
}

function topProject(payload: MenubarPayload): Project | null {
  const projects = payload.current.topProjects
  if (!Array.isArray(projects) || projects.length === 0) return null
  return projects[0] ?? null
}

function topModelName(payload: MenubarPayload): string | null {
  const models = payload.current.topModels
  if (!Array.isArray(models) || models.length === 0) return null
  const name = models[0]?.name?.trim()
  return name || null
}

function prettyModel(name: string): string {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
}

export function statusLineFrom(payload: MenubarPayload | null): string | null {
  if (!payload) return null
  const parts: string[] = []
  const project = topProject(payload)
  if (project?.name) parts.push(project.name)
  const sessions = payload.current.sessions
  if (typeof sessions === 'number' && sessions > 0) {
    parts.push(`${sessions} session${sessions === 1 ? '' : 's'}`)
  }
  const model = topModelName(payload)
  if (model) parts.push(prettyModel(model))
  return parts.length > 0 ? parts.join(' · ') : null
}

export function sparklineFrom(week: MenubarPayload | null, now = new Date()): number[] {
  const daily = week?.history?.daily
  if (!Array.isArray(daily) || daily.length === 0) return []
  const { start, end } = weekWindow(now)
  const byDate = new Map<string, number>()
  for (const row of daily) {
    if (!row?.date || typeof row.cost !== 'number' || !Number.isFinite(row.cost)) continue
    if (row.date < start || row.date > end) continue
    byDate.set(row.date, row.cost)
  }
  if (byDate.size === 0) return []
  const values: number[] = []
  const cursor = new Date(`${start}T00:00:00`)
  const last = new Date(`${end}T00:00:00`)
  while (cursor <= last) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    values.push(byDate.get(key) ?? 0)
    cursor.setDate(cursor.getDate() + 1)
  }
  if (values.every(v => v === 0)) return []
  return values
}

export function weekRangeFrom(week: MenubarPayload | null, now = new Date()): string | null {
  const window = weekWindow(now)
  const daily = week?.history?.daily?.filter(row => row?.date && row.date >= window.start && row.date <= window.end)
  if (daily && daily.length > 0) {
    const dates = daily.map(row => row.date).sort()
    return formatWeekRange(dates[0], dates[dates.length - 1])
  }
  return formatWeekRange(window.start, window.end)
}

type BuildArgs = {
  cliFound: boolean
  today: unknown
  week: unknown
  error: string | null
  refreshing: boolean
  hasEverSucceeded: boolean
  pinHint: boolean
  now?: Date
}

export function buildGlanceView(args: BuildArgs): GlanceView {
  const todayPayload = asPayload(args.today)
  const weekPayload = asPayload(args.week)
  const today = glanceMoney(
    todayPayload?.current.cost,
    todayPayload?.current.sessions,
    todayPayload?.current.calls,
  )
  const week = glanceMoney(
    weekPayload?.current.cost,
    weekPayload?.current.sessions,
    weekPayload?.current.calls,
  )

  const base = {
    today,
    week,
    weekRange: weekRangeFrom(weekPayload, args.now),
    sparkline: sparklineFrom(weekPayload, args.now),
    statusLine: statusLineFrom(todayPayload),
    dimmed: false,
    pinHint: false,
    title: COPY.title,
    subtitle: COPY.reassurance,
    primaryLabel: COPY.openCodeBurn,
    secondaryLabel: COPY.refresh,
  }

  if (!args.cliFound) {
    return {
      ...base,
      kind: 'cli-missing',
      subtitle: COPY.cliMissingTitle,
      body: COPY.cliMissingBody,
      primaryLabel: COPY.locateCli,
      secondaryLabel: COPY.quit,
      today: { display: null, empty: false },
      week: { display: null, empty: false },
      weekRange: null,
      sparkline: [],
      statusLine: null,
    }
  }

  if (args.error && !args.hasEverSucceeded) {
    return {
      ...base,
      kind: 'error',
      body: COPY.error,
      primaryLabel: COPY.retry,
      secondaryLabel: COPY.quit,
      today: { display: null, empty: false },
      week: { display: null, empty: false },
      weekRange: null,
      sparkline: [],
      statusLine: null,
    }
  }

  if (!args.hasEverSucceeded) {
    return {
      ...base,
      kind: 'loading',
      body: COPY.loading,
      today: { display: null, empty: false },
      week: { display: null, empty: false },
      weekRange: null,
      sparkline: [],
      statusLine: null,
    }
  }

  if (today.empty && week.empty) {
    return {
      ...base,
      kind: args.refreshing ? 'loading' : 'empty',
      body: args.refreshing ? COPY.loading : COPY.empty,
      dimmed: args.refreshing,
      pinHint: args.pinHint,
    }
  }

  if (args.error) {
    return {
      ...base,
      kind: 'error',
      body: COPY.error,
      primaryLabel: COPY.openCodeBurn,
      secondaryLabel: COPY.retry,
      dimmed: true,
      pinHint: args.pinHint,
    }
  }

  return {
    ...base,
    kind: args.refreshing ? 'loading' : 'glance',
    body: args.refreshing ? COPY.loading : undefined,
    dimmed: args.refreshing,
    pinHint: args.pinHint,
  }
}
