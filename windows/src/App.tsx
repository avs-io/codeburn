import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import type { MenubarPayload } from './lib/payload'
import { formatCurrency, USD } from './lib/currency'
import { applyTheme, currentTheme, readSetting, writeSetting } from './lib/settings'
import { GlanceFlyout } from './glance/GlanceFlyout'
import { buildGlanceView } from './glance/model'
import type { CliStatus } from './components/SetupState'

const POLL_MS = 30_000

type GlanceConfig = {
  hotkey: string
  pinHintShown: boolean
}

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args)
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(err)
}

function isCliMissingMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('cli not found') || lower.includes('is not on path')
}

export function App() {
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null)
  const [today, setToday] = useState<MenubarPayload | null>(null)
  const [week, setWeek] = useState<MenubarPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [hasEverSucceeded, setHasEverSucceeded] = useState(false)
  const [pinHint, setPinHint] = useState(false)
  const [busy, setBusy] = useState(false)
  const inflight = useRef(false)

  const applyPinHintOnce = useCallback(async () => {
    try {
      const config = await safeInvoke<GlanceConfig>('glance_config')
      setPinHint(!config.pinHintShown)
    } catch {
      setPinHint(readSetting('starBannerDismissed') !== 'glance-pin')
    }
  }, [])

  const fetchBoth = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    setRefreshing(true)
    try {
      const [todayJson, weekJson] = await Promise.all([
        safeInvoke<MenubarPayload>('fetch_payload', {
          period: 'today',
          provider: 'all',
          includeOptimize: false,
        }),
        safeInvoke<MenubarPayload>('fetch_payload', {
          period: 'week',
          provider: 'all',
          includeOptimize: false,
        }),
      ])
      setToday(todayJson)
      setWeek(weekJson)
      setError(null)
      setHasEverSucceeded(true)
    } catch (err) {
      const message = errorMessage(err)
      if (isCliMissingMessage(message)) {
        const status = await safeInvoke<CliStatus>('cli_status').catch(() => null)
        if (status) setCliStatus(status)
        else setCliStatus({ found: false, program: 'codeburn', version: null, min_version: '0.9.9', compatible: false, error: message })
      } else {
        setError(message)
      }
    } finally {
      setRefreshing(false)
      inflight.current = false
    }
  }, [])

  const checkCli = useCallback(async () => {
    try {
      const status = await safeInvoke<CliStatus>('cli_status')
      setCliStatus(status)
      if (status.found) {
        await fetchBoth()
      }
    } catch (err) {
      const message = errorMessage(err)
      setCliStatus({
        found: false,
        program: 'codeburn',
        version: null,
        min_version: '0.9.9',
        compatible: false,
        error: message,
      })
    }
  }, [fetchBoth])

  useEffect(() => {
    applyTheme(currentTheme() === 'dark' ? 'dark' : null)
    checkCli()
    applyPinHintOnce()
  }, [applyPinHintOnce, checkCli])

  useEffect(() => {
    if (!pinHint || !hasEverSucceeded) return
    safeInvoke('mark_pin_hint_shown').catch(() => {
      writeSetting('starBannerDismissed', 'glance-pin')
    })
  }, [pinHint, hasEverSucceeded])

  useEffect(() => {
    if (!cliStatus?.found) return
    const id = setInterval(() => {
      fetchBoth()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [cliStatus?.found, fetchBoth])

  useEffect(() => {
    const unlistenRefresh = listen('codeburn://refresh', () => {
      fetchBoth()
    })
    const unlistenShown = listen('codeburn://shown', () => {
      if (cliStatus?.found) fetchBoth()
    })
    return () => {
      unlistenRefresh.then(fn => fn())
      unlistenShown.then(fn => fn())
    }
  }, [cliStatus?.found, fetchBoth])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') safeInvoke('hide_popover').catch(() => {})
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!today || typeof today.current?.cost !== 'number') return
    const text = `CodeBurn · ${formatCurrency(today.current.cost, USD)} today`
    safeInvoke('set_tray_tooltip', { text }).catch(() => {})
  }, [today])

  const cliFound = cliStatus?.found === true
  const view = buildGlanceView({
    cliFound: cliStatus === null ? true : cliFound,
    today,
    week,
    error,
    refreshing,
    hasEverSucceeded,
    pinHint: pinHint && hasEverSucceeded,
  })

  // First probe still running: show loading, never a fabricated $0.
  const firstPaint = cliStatus === null && !hasEverSucceeded
  const rendered = firstPaint
    ? buildGlanceView({
        cliFound: true,
        today: null,
        week: null,
        error: null,
        refreshing: true,
        hasEverSucceeded: false,
        pinHint: false,
      })
    : view

  const onPrimary = async () => {
    if (rendered.kind === 'cli-missing') {
      setBusy(true)
      try {
        const status = await safeInvoke<CliStatus | null>('pick_cli_path')
        if (status?.found) {
          setCliStatus(status)
          await fetchBoth()
        }
      } catch {
        setCliStatus(current => current ?? {
          found: false,
          program: 'codeburn',
          version: null,
          min_version: '0.9.9',
          compatible: false,
          error: null,
        })
      } finally {
        setBusy(false)
      }
      return
    }
    if (rendered.kind === 'error' && !hasEverSucceeded) {
      await fetchBoth()
      return
    }
    try {
      await safeInvoke('open_desktop')
    } catch {
      // Desktop may not be installed; keep the flyout so Refresh still works.
    }
  }

  const onSecondary = async () => {
    if (rendered.kind === 'cli-missing' || (rendered.kind === 'error' && !hasEverSucceeded)) {
      await safeInvoke('quit_app').catch(() => {})
      return
    }
    await fetchBoth()
  }

  return (
    <div className="popover glance-shell">
      <GlanceFlyout view={rendered} busy={busy} onPrimary={onPrimary} onSecondary={onSecondary} />
    </div>
  )
}
