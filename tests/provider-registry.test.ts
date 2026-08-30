import { describe, it, expect, vi } from 'vitest'
import { providers, getAllProviders, getProvider, safeDiscoverSessions, discoverAllSessions, hasDetectableSessions } from '../src/providers/index.js'
import type { Provider } from '../src/providers/types.js'

function fakeProvider(name: string, discover: Provider['discoverSessions']): Provider {
  return {
    name,
    displayName: name,
    modelDisplayName: (m: string) => m,
    toolDisplayName: (t: string) => t,
    discoverSessions: discover,
  } as unknown as Provider
}

describe('provider registry', () => {
  it('has core providers registered synchronously', () => {
    expect(providers.map(p => p.name)).toEqual(['claude', 'cline', 'cline-cli', 'codewhale', 'codebuff', 'codex', 'copilot', 'devin', 'droid', 'dsh', 'gemini', 'hermes', 'ibm-bob', 'kilo-code', 'kiro', 'kimi', 'kimicode', 'lingtai-tui', 'mistral-vibe', 'mux', 'openclaw', 'openclaude', 'open-design', 'pi', 'omp', 'qwen', 'quickdesk', 'roo-code', 'zerostack', 'grok'])
  })

  it('codebuff tool display names normalize codebuff-native names to canonical set', () => {
    const codebuff = providers.find(p => p.name === 'codebuff')!
    expect(codebuff.toolDisplayName('read_files')).toBe('Read')
    expect(codebuff.toolDisplayName('code_search')).toBe('Grep')
    expect(codebuff.toolDisplayName('str_replace')).toBe('Edit')
    expect(codebuff.toolDisplayName('run_terminal_command')).toBe('Bash')
    expect(codebuff.toolDisplayName('spawn_agents')).toBe('Agent')
    expect(codebuff.toolDisplayName('write_todos')).toBe('TodoWrite')
    expect(codebuff.toolDisplayName('unknown_tool')).toBe('unknown_tool')
  })

  it('codebuff model display names cover known agent tiers', () => {
    const codebuff = providers.find(p => p.name === 'codebuff')!
    expect(codebuff.modelDisplayName('codebuff')).toBe('Codebuff')
    expect(codebuff.modelDisplayName('codebuff-base2')).toBe('Codebuff Base 2')
    expect(codebuff.modelDisplayName('some-future-model')).toBe('some-future-model')
  })

  it('includes sqlite providers after async load', async () => {
    const all = await getAllProviders()
    const names = all.map(p => p.name)
    expect(names).toContain('claude')
    expect(names).toContain('codex')
    expect(names).toContain('forge')
    expect(names).toContain('warp')
    expect(names.length).toBeGreaterThanOrEqual(2)
  })

  it('forge is available through async provider loading', async () => {
    const forge = await getProvider('forge')
    expect(forge).toBeDefined()
    expect(forge!.name).toBe('forge')
  })

  it('warp model and tool display names are normalized', async () => {
    const warp = await getProvider('warp')
    expect(warp).toBeDefined()
    expect(warp!.modelDisplayName('warp-auto-efficient')).toBe('Warp Auto (efficient)')
    expect(warp!.modelDisplayName('gpt-5.3-codex')).toBe('GPT-5.3 Codex')
    expect(warp!.toolDisplayName('run_command')).toBe('Bash')
  })

  it('opencode model display names strip provider prefix', async () => {
    const all = await getAllProviders()
    const oc = all.find(p => p.name === 'opencode')
    if (!oc) return
    expect(oc.modelDisplayName('anthropic/claude-opus-4-6-20260205')).toBe('Opus 4.6')
    expect(oc.modelDisplayName('google/gemini-2.5-pro')).toBe('Gemini 2.5 Pro')
  })

  it('opencode tool display names normalize builtins', async () => {
    const all = await getAllProviders()
    const oc = all.find(p => p.name === 'opencode')
    if (!oc) return
    expect(oc.toolDisplayName('bash')).toBe('Bash')
    expect(oc.toolDisplayName('edit')).toBe('Edit')
    expect(oc.toolDisplayName('task')).toBe('Agent')
    expect(oc.toolDisplayName('unknown_tool')).toBe('unknown_tool')
  })

  it('claude tool display names are identity', () => {
    const claude = providers.find(p => p.name === 'claude')!
    expect(claude.toolDisplayName('Bash')).toBe('Bash')
    expect(claude.toolDisplayName('Read')).toBe('Read')
  })

  it('codex tool display names are normalized', () => {
    const codex = providers.find(p => p.name === 'codex')!
    expect(codex.toolDisplayName('exec_command')).toBe('Bash')
    expect(codex.toolDisplayName('read_file')).toBe('Read')
    expect(codex.toolDisplayName('write_file')).toBe('Edit')
    expect(codex.toolDisplayName('spawn_agent')).toBe('Agent')
  })

  it('codex model display names are human-readable', () => {
    const codex = providers.find(p => p.name === 'codex')!
    expect(codex.modelDisplayName('gpt-5.4')).toBe('GPT-5.4')
    expect(codex.modelDisplayName('gpt-5.4-mini')).toBe('GPT-5.4 Mini')
    expect(codex.modelDisplayName('gpt-5.3-codex')).toBe('GPT-5.3 Codex')
    expect(codex.modelDisplayName('gpt-5.5')).toBe('GPT-5.5')
  })

  it('claude model display names are human-readable', () => {
    const claude = providers.find(p => p.name === 'claude')!
    expect(claude.modelDisplayName('claude-opus-4-6-20260205')).toBe('Opus 4.6')
    expect(claude.modelDisplayName('claude-sonnet-4-6')).toBe('Sonnet 4.6')
  })

  it('kimi model and tool display names are normalized', () => {
    const kimi = providers.find(p => p.name === 'kimi')!
    expect(kimi.modelDisplayName('kimi-auto')).toBe('Kimi (auto)')
    expect(kimi.modelDisplayName('kimi-k2-thinking-turbo')).toBe('Kimi K2 Thinking Turbo')
    expect(kimi.toolDisplayName('Shell')).toBe('Bash')
    expect(kimi.toolDisplayName('WriteFile')).toBe('Write')
  })

  it('lingtai-tui model display names are normalized', () => {
    const lingtai = providers.find(p => p.name === 'lingtai-tui')!
    expect(lingtai.displayName).toBe('LingTai TUI')
    expect(lingtai.modelDisplayName('claude-sonnet-4-6')).toBe('Sonnet 4.6')
    expect(lingtai.toolDisplayName('custom_tool')).toBe('custom_tool')
  })

  it('cursor model display names handle auto mode', async () => {
    const all = await getAllProviders()
    const cursor = all.find(p => p.name === 'cursor')!
    expect(cursor.modelDisplayName('cursor-auto')).toBe('Cursor (auto)')
    expect(cursor.modelDisplayName('claude-4.5-opus-high-thinking')).toBe('Opus 4.5 (Thinking)')
    expect(cursor.modelDisplayName('grok-code-fast-1')).toBe('Grok Code Fast')
    expect(cursor.modelDisplayName('unknown-model')).toBe('unknown-model')
  })

  describe('provider-discovery isolation', () => {
    it('safeDiscoverSessions returns [] and warns once instead of propagating', async () => {
      const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const boom = fakeProvider('boom-helper', async () => { throw new Error('crafted file blew up') })
      try {
        await expect(safeDiscoverSessions(boom)).resolves.toEqual([])
        expect(warn.mock.calls.length).toBeGreaterThanOrEqual(1)
        expect(String(warn.mock.calls[0]![0])).toContain('boom-helper')
        // Deduped on repeat within the same run: no additional warning.
        const afterFirst = warn.mock.calls.length
        await safeDiscoverSessions(boom)
        expect(warn.mock.calls.length).toBe(afterFirst)
      } finally {
        warn.mockRestore()
      }
    })

    it('discoverAllSessions drops a throwing provider but keeps the healthy ones', async () => {
      const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      const boom = fakeProvider('boom-loop', async () => { throw new Error('kaboom') })
      const ok1 = fakeProvider('ok1', async () => [{ path: '/a.jsonl', project: 'p1', provider: 'ok1' }])
      const ok2 = fakeProvider('ok2', async () => [{ path: '/b.jsonl', project: 'p2', provider: 'ok2' }])
      try {
        // A throwing provider in the middle must not abort the loop.
        const sources = await discoverAllSessions('all', [ok1, boom, ok2])
        expect(sources.map(s => s.path)).toEqual(['/a.jsonl', '/b.jsonl'])
        expect(warn.mock.calls.some(c => String(c[0]).includes('boom-loop'))).toBe(true)
      } finally {
        warn.mockRestore()
      }
    })

    it('discoverAllSessions honors the provider filter', async () => {
      const ok1 = fakeProvider('keep', async () => [{ path: '/keep.jsonl', project: 'k', provider: 'keep' }])
      const ok2 = fakeProvider('drop', async () => [{ path: '/drop.jsonl', project: 'd', provider: 'drop' }])
      const sources = await discoverAllSessions('keep', [ok1, ok2])
      expect(sources.map(s => s.path)).toEqual(['/keep.jsonl'])
    })
  })
})

describe('hasDetectableSessions', () => {
  it('skips discovery when every probe root is missing', async () => {
    const discover = vi.fn(async () => [{ path: '/sessions/a.jsonl', project: 'p', provider: 'probe-missing' }])
    const provider: Provider = {
      ...fakeProvider('probe-missing', discover),
      async probeRoots() {
        return [{ path: '/definitely-not-installed-codeburn-probe-root', label: 'home' }]
      },
    }
    await expect(hasDetectableSessions(provider)).resolves.toBe(false)
    expect(discover).not.toHaveBeenCalled()
  })

  it('does not treat an empty Codex year dir as a session source', async () => {
    const { mkdtempSync, mkdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createCodexProvider } = await import('../src/providers/codex.js')
    const home = mkdtempSync(join(tmpdir(), 'codeburn-empty-year-'))
    mkdirSync(join(home, 'sessions', '2026'), { recursive: true })
    const provider = createCodexProvider(home)
    const discover = vi.spyOn(provider, 'discoverSessions')
    await expect(hasDetectableSessions(provider)).resolves.toBe(false)
    expect(discover).not.toHaveBeenCalled()
  })

  it('ignores a malformed archived Codex rollout name', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createCodexProvider } = await import('../src/providers/codex.js')
    const home = mkdtempSync(join(tmpdir(), 'codeburn-bad-archive-'))
    mkdirSync(join(home, 'archived_sessions'), { recursive: true })
    writeFileSync(join(home, 'archived_sessions', 'rollout-not-a-session.jsonl'), '{"type":"not-session-meta"}\n')
    const provider = createCodexProvider(home)
    const discover = vi.spyOn(provider, 'discoverSessions')
    await expect(hasDetectableSessions(provider)).resolves.toBe(false)
    expect(discover).not.toHaveBeenCalled()
  })

  it('short-circuits Codex after the first valid rollout without listing the corpus', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createCodexProvider } = await import('../src/providers/codex.js')
    const home = mkdtempSync(join(tmpdir(), 'codeburn-valid-codex-'))
    const dayDir = join(home, 'sessions', '2026', '04', '14')
    mkdirSync(dayDir, { recursive: true })
    writeFileSync(join(dayDir, 'rollout-abc123.jsonl'), JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-04-14T10:00:00Z',
      payload: { cwd: '/tmp/proj', originator: 'codex-cli', session_id: 'sess-1', model: 'gpt-5.3-codex' },
    }) + '\n')
    const provider = createCodexProvider(home)
    const discover = vi.spyOn(provider, 'discoverSessions')
    await expect(hasDetectableSessions(provider)).resolves.toBe(true)
    expect(discover).not.toHaveBeenCalled()
  })

  it('still discovers non-Codex providers after a cheap existing-root check', async () => {
    const discover = vi.fn(async () => [])
    const provider: Provider = {
      ...fakeProvider('copilot', discover),
      name: 'copilot',
      async probeRoots() {
        return [{ path: '/tmp', label: 'store' }]
      },
    }
    await expect(hasDetectableSessions(provider)).resolves.toBe(false)
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it('falls back to discovery when probeRoots is absent', async () => {
    const present = fakeProvider('no-probe-present', async () => [{ path: '/a.jsonl', project: 'p', provider: 'no-probe-present' }])
    const absent = fakeProvider('no-probe-absent', async () => [])
    await expect(hasDetectableSessions(present)).resolves.toBe(true)
    await expect(hasDetectableSessions(absent)).resolves.toBe(false)
  })

  it('returns false and warns once when probeRoots throws', async () => {
    const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const discover = vi.fn(async () => [{ path: '/a.jsonl', project: 'p', provider: 'boom-probe' }])
    const provider: Provider = {
      ...fakeProvider('boom-probe', discover),
      async probeRoots() {
        throw new Error('probe blew up')
      },
    }
    try {
      await expect(hasDetectableSessions(provider)).resolves.toBe(false)
      expect(discover).not.toHaveBeenCalled()
      expect(String(warn.mock.calls[0]![0])).toContain('boom-probe')
      const afterFirst = warn.mock.calls.length
      await hasDetectableSessions(provider)
      expect(warn.mock.calls.length).toBe(afterFirst)
    } finally {
      warn.mockRestore()
    }
  })
})
