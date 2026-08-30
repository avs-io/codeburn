import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectCodexRollouts } from '../src/status-corpus-fingerprint.js'

const ENV_KEYS = ['HOME', 'CODEBURN_CACHE_DIR', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'CODEBURN_DESKTOP_SESSIONS_DIR'] as const
let saved: Record<string, string | undefined>
let root: string

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  root = await mkdtemp(join(tmpdir(), 'codeburn-status-fp-'))
  process.env.HOME = root
  process.env.CODEBURN_CACHE_DIR = join(root, 'cache')
  process.env.CLAUDE_CONFIG_DIR = join(root, 'empty-claude')
  process.env.CODEX_HOME = join(root, 'codex')
  process.env.CODEBURN_DESKTOP_SESSIONS_DIR = join(root, 'empty-desktop')
  await mkdir(join(root, 'empty-claude'), { recursive: true })
  await mkdir(join(root, 'empty-desktop'), { recursive: true })
  await mkdir(join(root, 'cache'), { recursive: true })
})

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  await rm(root, { recursive: true, force: true })
})

describe('computeStatusCorpusFingerprint', () => {
  it('lists dated and archived Codex rollouts by path', async () => {
    const dayDir = join(root, 'codex', 'sessions', '2026', '04', '14')
    await mkdir(dayDir, { recursive: true })
    const rollout = join(dayDir, 'rollout-abc.jsonl')
    await writeFile(rollout, 'x\n')
    const archivedDir = join(root, 'codex', 'archived_sessions')
    await mkdir(archivedDir, { recursive: true })
    const archived = join(archivedDir, 'rollout-old.jsonl')
    await writeFile(archived, 'y\n')
    const files = await collectCodexRollouts(join(root, 'codex'))
    expect(files.sort()).toEqual([archived, rollout].sort())
  })
})
