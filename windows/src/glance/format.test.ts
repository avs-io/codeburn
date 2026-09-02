import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOTKEY,
  formatWeekRange,
  glanceMoney,
  isBlockedHotkey,
  normalizeHotkey,
  weekWindow,
} from './format'

describe('glanceMoney', () => {
  it('does not invent $0 when cost is missing', () => {
    expect(glanceMoney(undefined, 0, 0)).toEqual({ display: null, empty: false })
    expect(glanceMoney(Number.NaN, 2, 2)).toEqual({ display: null, empty: false })
  })

  it('treats a real empty period as empty, not $0', () => {
    expect(glanceMoney(0, 0, 0)).toEqual({ display: null, empty: true })
  })

  it('shows a real zero when there were sessions', () => {
    expect(glanceMoney(0, 2, 0).display).toBe('$0.00')
    expect(glanceMoney(0, 2, 0).empty).toBe(false)
  })

  it('formats today-scale and week-scale amounts like the frames', () => {
    expect(glanceMoney(42.1, 6, 12).display).toBe('$42.10')
    expect(glanceMoney(1284, 20, 80).display).toBe('$1,284')
  })
})

describe('week range', () => {
  it('collapses same-month ranges to Aug 24-30', () => {
    expect(formatWeekRange('2026-08-24', '2026-08-30')).toBe('Aug 24-30')
  })

  it('keeps both months when the window crosses', () => {
    expect(formatWeekRange('2026-07-28', '2026-08-03')).toBe('Jul 28-Aug 3')
  })

  it('computes a 7-day local window ending today', () => {
    const now = new Date(2026, 7, 30)
    expect(weekWindow(now)).toEqual({ start: '2026-08-24', end: '2026-08-30' })
  })
})

describe('hotkey', () => {
  it('defaults to Ctrl+Alt+B and blocks Win+C / Ctrl+Shift+P', () => {
    expect(DEFAULT_HOTKEY).toBe('Ctrl+Alt+B')
    expect(isBlockedHotkey('Win+C')).toBe(true)
    expect(isBlockedHotkey('super+c')).toBe(true)
    expect(isBlockedHotkey('Ctrl+Shift+P')).toBe(true)
    expect(isBlockedHotkey('Ctrl+Alt+B')).toBe(false)
    expect(normalizeHotkey('ctrl + alt + b')).toBe('Ctrl+Alt+B')
  })
})
