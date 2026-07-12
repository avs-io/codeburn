import os from 'node:os'
import path from 'node:path'

import { atomicWriteSecureFile, fraction, quotaRequestSignal, readSecureFile, sanitizeError } from './security'
import type { QuotaProvider, QuotaWindow } from './types'

const USAGE_ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage'
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const EIGHT_DAYS = 8 * 24 * 60 * 60_000

type AuthDoc = Record<string, any> & {
  auth_mode?: string
  tokens?: { access_token?: string; refresh_token?: string; id_token?: string; account_id?: string; [key: string]: unknown }
  last_refresh?: string
}

export type CodexDeps = {
  fetch: typeof fetch
  authPath: string
  readFile: typeof readSecureFile
  writeFile: typeof atomicWriteSecureFile
  now: () => number
}

const defaults: CodexDeps = {
  fetch: globalThis.fetch,
  authPath: path.join(os.homedir(), '.codex', 'auth.json'),
  readFile: readSecureFile,
  writeFile: atomicWriteSecureFile,
  now: Date.now,
}

function empty(connection: QuotaProvider['connection']): QuotaProvider {
  return { provider: 'codex', connection, primary: null, details: [], planLabel: null, footerLines: [] }
}

async function readAuth(deps: CodexDeps): Promise<AuthDoc | null> {
  const raw = await deps.readFile(deps.authPath, 64 * 1024)
  return raw ? JSON.parse(raw) as AuthDoc : null
}

function labelForSeconds(value: unknown): string {
  const seconds = typeof value === 'number' ? Math.max(0, Math.trunc(value)) : 0
  if (seconds < 3600) return 'Hourly'
  if (seconds < 7200) return 'Hour'
  if (seconds >= 18_000 && seconds < 19_000) return '5-hour'
  if (seconds >= 86_400 && seconds < 87_000) return 'Daily'
  if (seconds >= 604_800 && seconds < 605_000) return 'Weekly'
  const hours = Math.floor(seconds / 3600)
  return hours < 24 ? `${hours}-hour` : `${Math.floor(hours / 24)}-day`
}

function windowOf(value: unknown, override?: string): QuotaWindow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const percent = fraction(row.used_percent)
  if (percent === null) return null
  const reset = typeof row.reset_at === 'number' && Number.isFinite(row.reset_at)
    ? new Date(row.reset_at * 1000).toISOString() : null
  return { label: override ?? labelForSeconds(row.limit_window_seconds), percent, resetsAt: reset }
}

function planLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.trim()
  const lower = raw.toLowerCase()
  const known: Record<string, string> = {
    guest: 'Guest', free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro',
    prolite: 'Pro Lite', pro_lite: 'Pro Lite', 'pro-lite': 'Pro Lite',
    free_workspace: 'Free Workspace', team: 'Team', business: 'Business',
    education: 'Education', quorum: 'Quorum', k12: 'K-12', enterprise: 'Enterprise', edu: 'Edu',
  }
  return known[lower] ?? lower.replace(/(^|[_-])\w/g, match => match.replace(/[_-]/, ' ').toUpperCase())
}

export function decodeCodexUsage(body: unknown): QuotaProvider {
  const data = body && typeof body === 'object' ? body as Record<string, any> : {}
  const primaryRaw = windowOf(data.rate_limit?.primary_window)
  const secondaryRaw = windowOf(data.rate_limit?.secondary_window)
  const primary = primaryRaw ?? secondaryRaw
  const details: QuotaWindow[] = []
  if (primaryRaw) details.push(primaryRaw)
  if (secondaryRaw && secondaryRaw !== primary) details.push(secondaryRaw)
  else if (!primaryRaw && secondaryRaw) details.push(secondaryRaw)
  if (Array.isArray(data.additional_rate_limits)) {
    for (const additional of data.additional_rate_limits) {
      if (!additional || typeof additional !== 'object' || typeof additional.limit_name !== 'string') continue
      for (const key of ['primary_window', 'secondary_window'] as const) {
        const raw = additional.rate_limit?.[key]
        const base = windowOf(raw)
        if (base && base.percent > 0) details.push({ ...base, label: `${additional.limit_name} · ${base.label}` })
      }
    }
  }
  const rawBalance = data.credits?.balance
  const balance = typeof rawBalance === 'number' ? rawBalance : typeof rawBalance === 'string' ? Number(rawBalance) : NaN
  return {
    provider: 'codex', connection: 'connected', primary, details,
    planLabel: planLabel(data.plan_type),
    footerLines: Number.isFinite(balance) && balance > 0 ? [`Credits remaining · $${balance.toFixed(2)}`] : [],
  }
}

async function refresh(auth: AuthDoc, deps: CodexDeps, signal?: AbortSignal): Promise<AuthDoc | null> {
  const refreshToken = auth.tokens?.refresh_token
  if (!refreshToken) return null
  const response = await deps.fetch(TOKEN_ENDPOINT, {
    method: 'POST', signal: quotaRequestSignal(signal),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken, scope: 'openid profile email' }),
  })
  if (!response.ok) return null
  const next = await response.json() as Record<string, unknown>
  if (typeof next.access_token !== 'string' || !next.access_token) return null
  const latest = await readAuth(deps)
  if (!latest || latest.auth_mode !== 'chatgpt') return null
  latest.tokens = {
    ...latest.tokens,
    access_token: next.access_token,
    ...(typeof next.refresh_token === 'string' ? { refresh_token: next.refresh_token } : {}),
    ...(typeof next.id_token === 'string' ? { id_token: next.id_token } : {}),
  }
  latest.last_refresh = new Date(deps.now()).toISOString()
  await deps.writeFile(deps.authPath, `${JSON.stringify(latest, null, 2)}\n`)
  return latest
}

async function usage(auth: AuthDoc, deps: CodexDeps, signal?: AbortSignal): Promise<Response | null> {
  const token = auth.tokens?.access_token
  if (!token) return null
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'CodeBurn' }
  if (auth.tokens?.account_id) headers['ChatGPT-Account-Id'] = auth.tokens.account_id
  return deps.fetch(USAGE_ENDPOINT, { method: 'GET', headers, signal: quotaRequestSignal(signal) })
}

export type CodexResult = { quota: QuotaProvider; retryAfterSeconds?: number }

export async function fetchCodexQuota(options: Partial<CodexDeps> & { signal?: AbortSignal } = {}): Promise<CodexResult> {
  const deps = { ...defaults, ...options }
  try {
    let auth = await readAuth(deps)
    if (!auth) return { quota: empty('disconnected') }
    if (auth.auth_mode !== 'chatgpt') return { quota: empty('terminalFailure') }
    if (!auth.tokens?.access_token) return { quota: empty('disconnected') }

    const refreshedAt = typeof auth.last_refresh === 'string' ? Date.parse(auth.last_refresh) : NaN
    if (!Number.isFinite(refreshedAt) || deps.now() - refreshedAt > EIGHT_DAYS) {
      const next = await refresh(auth, deps, options.signal)
      if (next) auth = next
    }
    let response = await usage(auth, deps, options.signal)
    if (!response) return { quota: empty('disconnected') }
    if (response.status === 401) {
      const reread = await readAuth(deps)
      if (reread?.tokens?.access_token && reread.tokens.access_token !== auth.tokens?.access_token) auth = reread
      else {
        const next = await refresh(reread ?? auth, deps, options.signal)
        if (!next) return { quota: empty('transientFailure') }
        auth = next
      }
      response = await usage(auth, deps, options.signal)
      if (!response) return { quota: empty('transientFailure') }
    }
    if (response.status === 429) {
      const raw = response.headers.get('Retry-After')
      let seconds = raw === null ? NaN : Number(raw)
      if (!Number.isFinite(seconds) && raw) seconds = (Date.parse(raw) - deps.now()) / 1000
      return { quota: empty('transientFailure'), retryAfterSeconds: Math.max(Number.isFinite(seconds) ? Math.ceil(seconds) : 300, 60) }
    }
    if (!response.ok) return { quota: empty(response.status >= 400 && response.status < 500 ? 'terminalFailure' : 'transientFailure') }
    return { quota: decodeCodexUsage(await response.json()) }
  } catch (error) {
    console.warn(`Codex quota unavailable: ${sanitizeError(error)}`)
    return { quota: empty('transientFailure') }
  }
}
