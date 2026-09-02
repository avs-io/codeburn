/** Dollar formatting for Glance. Never invent a $0 when we do not have a payload. */

export type GlanceMoney = {
  /** Display string, or null when the number must not be shown. */
  display: string | null
  /** True when the period has no sessions/calls — show empty copy, not $0. */
  empty: boolean
}

const THOUSAND = 1_000

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatUsd(amount: number): string {
  const abs = Math.abs(amount)
  if (abs >= THOUSAND) {
    const rounded = Math.round(amount)
    const whole = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${rounded < 0 ? '-' : ''}$${whole}`
  }
  const parts = amount.toFixed(2).split('.')
  const whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `$${whole}.${parts[1]}`
}

/**
 * List-rate estimate for a period. Missing or non-finite cost is not rendered
 * as $0 — that is the "fake $0" the flyout must never show.
 */
export function glanceMoney(cost: unknown, sessions: unknown, calls: unknown): GlanceMoney {
  if (!isFiniteNumber(cost)) {
    return { display: null, empty: false }
  }
  const sessionCount = isFiniteNumber(sessions) ? sessions : 0
  const callCount = isFiniteNumber(calls) ? calls : 0
  if (cost === 0 && sessionCount === 0 && callCount === 0) {
    return { display: null, empty: true }
  }
  return { display: formatUsd(cost), empty: false }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseYmd(ymd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(year, month - 1, day)
}

function monthDay(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** "Aug 24-30" or "Jul 28-Aug 3" from inclusive local dates. */
export function formatWeekRange(startYmd: string, endYmd: string): string | null {
  const start = parseYmd(startYmd)
  const end = parseYmd(endYmd)
  if (!start || !end) return null
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${monthDay(start)}-${end.getDate()}`
  }
  return `${monthDay(start)}-${monthDay(end)}`
}

export function localYmd(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

export function weekWindow(now = new Date()): { start: string; end: string } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return { start: localYmd(start), end: localYmd(end) }
}

const BLOCKED_HOTKEYS = ['win+c', 'super+c', 'meta+c', 'ctrl+shift+p', 'control+shift+p']

export function normalizeHotkey(raw: string): string {
  return raw
    .trim()
    .split('+')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const lower = part.toLowerCase()
      if (lower === 'control' || lower === 'ctrl') return 'Ctrl'
      if (lower === 'alt' || lower === 'option') return 'Alt'
      if (lower === 'shift') return 'Shift'
      if (lower === 'win' || lower === 'super' || lower === 'meta' || lower === 'cmd') return 'Win'
      return part.length === 1 ? part.toUpperCase() : part
    })
    .join('+')
}

export function isBlockedHotkey(raw: string): boolean {
  const key = normalizeHotkey(raw).toLowerCase()
  return BLOCKED_HOTKEYS.includes(key)
}

export const DEFAULT_HOTKEY = 'Ctrl+Alt+B'
