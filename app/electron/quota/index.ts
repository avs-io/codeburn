import os from 'node:os'
import path from 'node:path'

import { fetchClaudeQuota } from './claude'
import { fetchCodexQuota } from './codex'
import { atomicWriteSecureFile, readSecureFile, sanitizeError } from './security'
import type { ProviderName, QuotaProvider } from './types'

export type { QuotaProvider, QuotaWindow } from './types'
export { sanitizeError } from './security'

type Blocked = Partial<Record<ProviderName, string>>
type FetchResult = { quota: QuotaProvider; retryAfterSeconds?: number }
type QuotaDeps = {
  claude: (options: { signal: AbortSignal; allowKeychain: boolean }) => Promise<FetchResult>
  codex: (options: { signal: AbortSignal }) => Promise<FetchResult>
  statePath: string
  readFile: typeof readSecureFile
  writeFile: typeof atomicWriteSecureFile
  now: () => number
  refreshMs: number
}

const defaultDeps: QuotaDeps = {
  claude: fetchClaudeQuota,
  codex: fetchCodexQuota,
  statePath: path.join(os.homedir(), '.codeburn', 'quota-backoff.json'),
  readFile: readSecureFile,
  writeFile: atomicWriteSecureFile,
  now: Date.now,
  refreshMs: 2 * 60_000,
}

function unavailable(provider: ProviderName, connection: QuotaProvider['connection']): QuotaProvider {
  return { provider, connection, primary: null, details: [], planLabel: null, footerLines: [] }
}

export class QuotaService {
  private readonly deps: QuotaDeps
  private cache: { at: number; value: QuotaProvider[] } | null = null
  private flight: Promise<QuotaProvider[]> | null = null
  private generations: Record<ProviderName, number> = { claude: 0, codex: 0 }
  private controllers: Partial<Record<ProviderName, AbortController>> = {}

  constructor(deps: Partial<QuotaDeps> = {}) { this.deps = { ...defaultDeps, ...deps } }

  invalidate(provider: ProviderName): void {
    this.generations[provider] += 1
    this.controllers[provider]?.abort()
    this.controllers[provider] = undefined
    this.cache = null
  }

  async getQuota(options: { force?: boolean; allowClaudeKeychain?: boolean } = {}): Promise<QuotaProvider[]> {
    if (!options.force && this.cache && this.deps.now() - this.cache.at < this.deps.refreshMs) return this.cache.value
    if (this.flight) return this.flight
    this.flight = this.fetchAll(Boolean(options.allowClaudeKeychain)).finally(() => { this.flight = null })
    return this.flight
  }

  private async readBlocked(): Promise<Blocked> {
    try {
      const raw = await this.deps.readFile(this.deps.statePath, 16 * 1024)
      return raw ? JSON.parse(raw) as Blocked : {}
    } catch (error) {
      console.warn(`Quota backoff state unavailable: ${sanitizeError(error)}`)
      return {}
    }
  }

  private async writeBlocked(blocked: Blocked): Promise<void> {
    try { await this.deps.writeFile(this.deps.statePath, `${JSON.stringify(blocked, null, 2)}\n`) }
    catch (error) { console.warn(`Quota backoff state not saved: ${sanitizeError(error)}`) }
  }

  private async fetchAll(allowClaudeKeychain: boolean): Promise<QuotaProvider[]> {
    const startingGenerations = { ...this.generations }
    const prior = this.cache?.value ?? []
    const blocked = await this.readBlocked()
    const run = async (provider: ProviderName): Promise<QuotaProvider> => {
      const retainOnFailure = (next: QuotaProvider): QuotaProvider => {
        if (next.connection !== 'transientFailure') return next
        const previous = prior.find(item => item.provider === provider)
        return previous?.connection === 'connected' ? { ...previous, connection: 'transientFailure' } : next
      }
      const until = blocked[provider] ? Date.parse(blocked[provider]!) : NaN
      if (Number.isFinite(until) && until > this.deps.now()) return retainOnFailure(unavailable(provider, 'transientFailure'))
      const generation = this.generations[provider]
      const controller = new AbortController()
      this.controllers[provider] = controller
      const result = provider === 'claude'
        ? await this.deps.claude({ signal: controller.signal, allowKeychain: allowClaudeKeychain })
        : await this.deps.codex({ signal: controller.signal })
      if (generation !== this.generations[provider] || controller.signal.aborted) return unavailable(provider, 'disconnected')
      if (result.retryAfterSeconds !== undefined) {
        blocked[provider] = new Date(this.deps.now() + result.retryAfterSeconds * 1000).toISOString()
        await this.writeBlocked(blocked)
      } else if (blocked[provider]) {
        delete blocked[provider]
        await this.writeBlocked(blocked)
      }
      if (this.controllers[provider] === controller) this.controllers[provider] = undefined
      return retainOnFailure(result.quota)
    }
    const value = await Promise.all([run('claude'), run('codex')])
    if (startingGenerations.claude === this.generations.claude && startingGenerations.codex === this.generations.codex) {
      this.cache = { at: this.deps.now(), value }
    }
    return value
  }
}

export const quotaService = new QuotaService()
export const getQuota = (): Promise<QuotaProvider[]> => quotaService.getQuota()
