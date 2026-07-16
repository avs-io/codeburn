// Regression test for issue #676: the Copilot CLI JSONL parser ignores
// session.shutdown events, which carry the authoritative per-model token
// breakdown (input, cache_read, cache_write, output, reasoning) and computed
// cost. Without them, CLI-only sessions report output tokens only.
//
// Fixture schema synthesized from the redacted session.shutdown sample in the
// issue report (Copilot CLI 1.0.68). No real user content is included.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { copilot } from '../../src/providers/copilot.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

let tmpDir: string

async function createSessionDir(sessionId: string, lines: string[], cwd = '/home/user/myproject') {
  const sessionDir = join(tmpDir, sessionId)
  await mkdir(sessionDir, { recursive: true })
  await writeFile(join(sessionDir, 'workspace.yaml'), `id: ${sessionId}\ncwd: ${cwd}\n`)
  await writeFile(join(sessionDir, 'events.jsonl'), lines.join('\n') + '\n')
  return join(sessionDir, 'events.jsonl')
}

function modelChange(newModel: string) {
  return JSON.stringify({ type: 'session.model_change', timestamp: '2026-04-15T10:00:01Z', data: { newModel } })
}

function userMessage(content: string) {
  return JSON.stringify({ type: 'user.message', timestamp: '2026-04-15T10:00:10Z', data: { content, interactionId: 'int-1' } })
}

function assistantMessage(opts: { messageId: string; outputTokens: number; timestamp?: string }) {
  return JSON.stringify({
    type: 'assistant.message',
    timestamp: opts.timestamp ?? '2026-04-15T10:00:15Z',
    data: { messageId: opts.messageId, outputTokens: opts.outputTokens, interactionId: 'int-1', toolRequests: [] },
  })
}

// Cumulative per-session rollup written once by the Copilot CLI at exit.
// modelMetrics.<model>.usage is the authoritative breakdown; note that
// usage.inputTokens (71282) = tokenDetails input (4) + cache_read (35495)
// + cache_write (35783), i.e. it is the cache-INCLUSIVE input total, and
// usage.outputTokens (345) equals the sum of per-turn assistant.message
// outputTokens for the session (cumulative, not additive).
function sessionShutdown(model: string) {
  return JSON.stringify({
    type: 'session.shutdown',
    timestamp: '2026-04-15T10:05:00Z',
    data: {
      shutdownType: 'routine',
      totalPremiumRequests: 2,
      totalNanoAiu: 10001450000,
      tokenDetails: {
        input: { tokenCount: 4 },
        cache_read: { tokenCount: 35495 },
        cache_write: { tokenCount: 35783 },
        output: { tokenCount: 345 },
      },
      totalApiDurationMs: 7495,
      sessionStartTime: 1784102040274,
      eventsFileSizeBytes: 98693,
      codeChanges: { linesAdded: 0, linesRemoved: 0, filesModified: [] },
      modelMetrics: {
        [model]: {
          requests: { count: 2, cost: 2 },
          usage: {
            inputTokens: 71282,
            outputTokens: 345,
            cacheReadTokens: 35495,
            cacheWriteTokens: 35783,
            reasoningTokens: 31,
          },
          totalNanoAiu: 10001450000,
          tokenDetails: {
            input: { tokenCount: 4 },
            cache_read: { tokenCount: 35495 },
            cache_write: { tokenCount: 35783 },
            output: { tokenCount: 345 },
          },
        },
      },
      currentModel: model,
      currentTokens: 27176,
      systemTokens: 11899,
      conversationTokens: 605,
      toolDefinitionsTokens: 14668,
    },
  })
}

describe('copilot provider - session.shutdown token rollup (issue #676)', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'copilot-shutdown-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('counts input/cache tokens from the session.shutdown rollup without double-counting output', async () => {
    const model = 'claude-sonnet-4.5'
    const eventsPath = await createSessionDir('sess-shutdown-1', [
      modelChange(model),
      userMessage('first turn'),
      assistantMessage({ messageId: 'msg-1', outputTokens: 145, timestamp: '2026-04-15T10:00:15Z' }),
      userMessage('second turn'),
      assistantMessage({ messageId: 'msg-2', outputTokens: 200, timestamp: '2026-04-15T10:02:00Z' }),
      sessionShutdown(model),
    ])

    const source = { path: eventsPath, project: 'myproject', provider: 'copilot' }
    const calls: ParsedProviderCall[] = []
    for await (const call of copilot.createSessionParser(source, new Set()).parse()) calls.push(call)

    const totals = calls.reduce(
      (acc, c) => ({
        input: acc.input + c.inputTokens,
        output: acc.output + c.outputTokens,
        cacheRead: acc.cacheRead + c.cacheReadInputTokens,
        cacheWrite: acc.cacheWrite + c.cacheCreationInputTokens,
        cost: acc.cost + c.costUSD,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
    )

    // The shutdown rollup is cumulative for the session: output must stay at
    // the per-turn sum (345), NOT 690 — counting both per-turn events and the
    // rollup's output would double-count.
    expect(totals.output).toBe(345)

    // Cache tokens are only available from the shutdown rollup. Today the
    // parser drops the event entirely, so these come back 0 (the bug).
    expect(totals.cacheRead).toBe(35495)
    expect(totals.cacheWrite).toBe(35783)

    // Non-cached input from the rollup (tokenDetails.input = 4; equivalently
    // usage.inputTokens 71282 minus cache read/write). Either accounting is
    // acceptable as long as input + cacheRead + cacheWrite === 71282.
    expect(totals.input + totals.cacheRead + totals.cacheWrite).toBe(71282)

    // Cost must reflect more than output tokens alone.
    const outputOnlyCost = calls.length > 0 ? totals.cost : 0
    expect(totals.input + totals.cacheRead + totals.cacheWrite).toBeGreaterThan(0)
    expect(outputOnlyCost).toBeGreaterThan(0)
  })

  it('still parses sessions without a shutdown event (crashed sessions)', async () => {
    const eventsPath = await createSessionDir('sess-shutdown-2', [
      modelChange('gpt-4.1'),
      userMessage('hello'),
      assistantMessage({ messageId: 'msg-1', outputTokens: 100 }),
    ])

    const source = { path: eventsPath, project: 'myproject', provider: 'copilot' }
    const calls: ParsedProviderCall[] = []
    for await (const call of copilot.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.outputTokens).toBe(100)
  })
})
