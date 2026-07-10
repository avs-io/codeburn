import type { CliError, CodeburnBridge } from './types'

// The preload script (app/electron/preload.ts) exposes `window.codeburn` as the
// typed CodeburnBridge (methods resolve to CLI JSON or reject with a plain
// CliError), and `window.codeburnEvents` for main→renderer push events.
declare global {
  interface Window {
    codeburn: CodeburnBridge
    codeburnEvents: {
      /** Subscribe to the main-process 30s refresh tick. Returns an unsubscribe fn. */
      onRefresh(cb: () => void): () => void
    }
  }
}

/** The typed bridge. Import this instead of touching `window` directly. */
export const codeburn: CodeburnBridge = window.codeburn

/** Subscribe to the main-process refresh tick. */
export function onRefresh(cb: () => void): () => void {
  return window.codeburnEvents.onRefresh(cb)
}

/** Coerce anything thrown across the IPC boundary into a CliError shape. */
export function normalizeCliError(err: unknown): CliError {
  if (err && typeof err === 'object' && 'kind' in err && typeof (err as CliError).kind === 'string') {
    const e = err as CliError
    return { kind: e.kind, message: e.message ?? 'codeburn CLI error' }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { kind: 'nonzero', message }
}
