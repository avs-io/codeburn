import { afterEach, describe, expect, it, vi } from 'vitest'

import { decodeCodexUsage, fetchCodexQuota } from './codex'

const now = Date.parse('2026-07-12T00:00:00Z')
const auth = {
  auth_mode: 'chatgpt', OPENAI_API_KEY: 'preserve-me', last_refresh: '2026-07-11T00:00:00Z',
  tokens: { access_token: 'eyJaccess.token.sig', refresh_token: 'refresh-secret', id_token: 'old-id', account_id: 'acct_1' },
}

afterEach(() => vi.restoreAllMocks())

describe('Codex quota', () => {
  it('decodes primary/secondary/additional windows, plan and numeric-string credits', () => {
    const quota = decodeCodexUsage({
      plan_type: 'pLuS',
      rate_limit: {
        primary_window: { used_percent: 20, reset_at: 1_800_000_000, limit_window_seconds: 18_000 },
        secondary_window: { used_percent: 80, reset_at: 1_800_100_000, limit_window_seconds: 604_800 },
      },
      additional_rate_limits: [{
        limit_name: 'GPT-5', rate_limit: {
          primary_window: { used_percent: 12, reset_at: 1_800_000_000, limit_window_seconds: 3600 },
          secondary_window: { used_percent: 0, reset_at: 1_800_000_000, limit_window_seconds: 86_400 },
        },
      }],
      credits: { balance: '3.5' },
    })
    expect(quota.planLabel).toBe('Plus')
    expect(quota.primary?.label).toBe('5-hour')
    expect(quota.details.map(row => row.label)).toEqual(['5-hour', 'Weekly', 'GPT-5 · Hour'])
    expect(quota.footerLines).toEqual(['Credits remaining · $3.50'])
  })

  it('promotes secondary when primary is absent', () => {
    const quota = decodeCodexUsage({ rate_limit: { secondary_window: { used_percent: 9, reset_at: 1_800_000_000, limit_window_seconds: 604_800 } } })
    expect(quota.primary?.label).toBe('Weekly')
    expect(quota.details).toHaveLength(1)
  })

  it('returns disconnected without credentials', async () => {
    const fetchMock = vi.fn()
    const result = await fetchCodexQuota({ fetch: fetchMock, readFile: vi.fn(async () => null) })
    expect(result.quota.connection).toBe('disconnected')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends account id and uses Retry-After header for 429', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
    const result = await fetchCodexQuota({ fetch: fetchMock, readFile: vi.fn(async () => JSON.stringify(auth)), now: () => now })
    expect(result.retryAfterSeconds).toBe(120)
    const usageInit = (fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1]
    expect(usageInit.headers).toMatchObject({ 'ChatGPT-Account-Id': 'acct_1', 'User-Agent': 'CodeBurn' })
  })

  it('refreshes after eight days and preserves unrelated auth keys on write-back', async () => {
    const stale = { ...auth, last_refresh: '2026-07-01T00:00:00Z' }
    const fetchMock = vi.fn(async (url: string) => url.includes('/oauth/token')
      ? new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', id_token: 'new-id' }), { status: 200 })
      : new Response(JSON.stringify({ plan_type: 'pro', rate_limit: {} }), { status: 200 }))
    const writeFile = vi.fn(async () => undefined)
    await fetchCodexQuota({ fetch: fetchMock as typeof fetch, readFile: vi.fn(async () => JSON.stringify(stale)), writeFile, now: () => now })
    const saved = JSON.parse((writeFile.mock.calls[0]! as unknown as [string, string])[1])
    expect(saved.OPENAI_API_KEY).toBe('preserve-me')
    expect(saved.tokens).toMatchObject({ access_token: 'new-access', refresh_token: 'new-refresh', id_token: 'new-id', account_id: 'acct_1' })
    expect((fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1].method).toBe('POST')
  })
})
