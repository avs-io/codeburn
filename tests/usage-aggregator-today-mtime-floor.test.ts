import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, rm, utimes, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { getDateRange } from '../src/cli-date.js'
import { loadPricing } from '../src/models.js'
import { buildDurablePeriod } from '../src/usage-aggregator.js'
import { clearSessionCache, filesParsedFromSourceCount } from '../src/parser.js'

const ROOT = join(tmpdir(), `codeburn-today-mtime-floor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const ENV_KEYS = ['HOME', 'CODEBURN_CACHE_DIR', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIRS', 'CODEX_HOME', 'USERPROFILE', 'KIMI_CODE_HOME', 'CODEBURN_DESKTOP_SESSIONS_DIR'] as const
let savedEnv: Record<string, string | undefined>

async function writeSession(name: string, ageDays: number): Promise<void> {
  const dir = join(ROOT, 'home', '.claude', 'projects', 'proj')
  await mkdir(dir, { recursive: true })
  const at = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000)
  const path = join(dir, `${name}.jsonl`)
  await writeFile(path, JSON.stringify({
    type: 'assistant',
    sessionId: name,
    timestamp: at.toISOString(),
    cwd: '/tmp/proj',
    message: {
      id: `msg-${name}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  }) + '\n')
  await utimes(path, at, at)
}

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  await mkdir(join(ROOT, 'home', '.claude'), { recursive: true })
  await mkdir(join(ROOT, 'cache'), { recursive: true })
  await mkdir(join(ROOT, 'no-desktop-sessions'), { recursive: true })
  await mkdir(join(ROOT, 'no-kimi-home'), { recursive: true })
  process.env['HOME'] = join(ROOT, 'home')
  process.env['CODEBURN_CACHE_DIR'] = join(ROOT, 'cache')
  process.env['CLAUDE_CONFIG_DIR'] = join(ROOT, 'home', '.claude')
  delete process.env['CLAUDE_CONFIG_DIRS']
  delete process.env['CODEX_HOME']
  process.env['USERPROFILE'] = join(ROOT, 'home')
  process.env['KIMI_CODE_HOME'] = join(ROOT, 'no-kimi-home')
  process.env['CODEBURN_DESKTOP_SESSIONS_DIR'] = join(ROOT, 'no-desktop-sessions')
  clearSessionCache()
  await loadPricing()
})

afterEach(async () => {
  clearSessionCache()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  if (existsSync(ROOT)) await rm(ROOT, { recursive: true, force: true })
})

describe('today-only first-paint mtime floor', () => {
  it('does not parse a 30-day-old transcript for --period today', async () => {
    await writeSession('today', 0)
    await writeSession('old', 30)
    const before = filesParsedFromSourceCount()
    const durable = await buildDurablePeriod(getDateRange('today'), { provider: 'all' })
    expect(durable.data.sessions).toBe(1)
    expect(filesParsedFromSourceCount() - before).toBe(1)
  })
})
