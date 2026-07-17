import { useEffect, useState } from 'react'

import { codeburn } from '../lib/ipc'
import type { UpdateStatus } from '../lib/types'

/**
 * Reads the main-process update-availability status once on mount and stays live
 * via the push event. Returns null until the first read resolves, or when the
 * bridge predates the feature (an older preload, or a test mock) — both degrade
 * to "no update", so callers can treat null as "nothing to show".
 */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    if (typeof codeburn.getUpdateStatus !== 'function') return
    let active = true
    codeburn.getUpdateStatus().then(next => { if (active) setStatus(next) }).catch(() => { /* offline — no nudge */ })
    const unsubscribe = typeof codeburn.onUpdateStatus === 'function'
      ? codeburn.onUpdateStatus(next => { if (active) setStatus(next) })
      : undefined
    return () => { active = false; unsubscribe?.() }
  }, [])
  return status
}

/** GitHub release page for a desktop tag — the Download target (no site #get
 *  anchor exists). https-only, so it passes the openExternal allowlist. */
export function releasePageUrl(tag: string): string {
  return `https://github.com/getagentseal/codeburn/releases/tag/${tag}`
}
