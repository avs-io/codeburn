import { PassThrough } from 'node:stream'

import React from 'react'
import { render } from 'ink'
import stripAnsi from 'strip-ansi'
import { describe, expect, it, onTestFinished } from 'vitest'

import { InteractiveDashboard, selectDashboardHistoryIndex, type DashboardHistoryIndex } from '../src/dashboard.js'
import type { DailyCache } from '../src/daily-cache.js'
import type { ProjectSummary, SessionSummary } from '../src/types.js'

const EMPTY_BREAKDOWN = {
  coding: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  debugging: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  feature: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  refactoring: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  testing: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  exploration: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  planning: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  delegation: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  git: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  'build/deploy': { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  conversation: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  brainstorming: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
  general: { turns: 0, costUSD: 0, retries: 0, editTurns: 0, oneShotTurns: 0 },
} as const

function project(): ProjectSummary {
  const timestamp = new Date().toISOString()
  const session: SessionSummary = {
    sessionId: 'today', project: 'p', firstTimestamp: timestamp, lastTimestamp: timestamp,
    totalCostUSD: 1, totalSavingsUSD: 0, totalInputTokens: 0, totalOutputTokens: 0,
    totalCacheReadTokens: 0, totalCacheWriteTokens: 0, apiCalls: 1,
    turns: [], modelBreakdown: {}, toolBreakdown: {}, mcpBreakdown: {}, bashBreakdown: {},
    categoryBreakdown: { ...EMPTY_BREAKDOWN }, skillBreakdown: {}, subagentBreakdown: {},
  }
  return { project: 'p', projectPath: '/tmp/p', sessions: [session], totalCostUSD: 1, totalApiCalls: 1 }
}

function emptyDailyCache(): DailyCache {
  return { version: 29, savingsConfigHash: '', lastComputedDate: null, days: [], complete: true }
}

function historicalProviderProject(): ProjectSummary {
  const timestamp = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const call = {
    provider: 'claude', model: 'claude-sonnet-4-5', costUSD: 7, timestamp,
    usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, webSearchRequests: 0 },
    tools: [], mcpTools: [], skills: [], subagentTypes: [], hasAgentSpawn: false,
    hasPlanMode: false, speed: 'standard' as const, bashCommands: [], deduplicationKey: 'claude-historical',
  }
  return {
    project: 'p', projectPath: '/tmp/p', totalCostUSD: 7, totalApiCalls: 1,
    sessions: [{
      sessionId: 'claude-historical', project: 'p', firstTimestamp: timestamp, lastTimestamp: timestamp,
      totalCostUSD: 7, totalSavingsUSD: 0, totalInputTokens: 10, totalOutputTokens: 5,
      totalCacheReadTokens: 0, totalCacheWriteTokens: 0, apiCalls: 1,
      turns: [{ userMessage: 'hi', timestamp, sessionId: 'claude-historical', category: 'coding', retries: 0, hasEdits: false, assistantCalls: [call] }],
      modelBreakdown: {}, toolBreakdown: {}, mcpBreakdown: {}, bashBreakdown: {},
      categoryBreakdown: { ...EMPTY_BREAKDOWN }, skillBreakdown: {}, subagentBreakdown: {},
    }],
  } as ProjectSummary
}

describe('interactive period truth', () => {
  it('keeps provider-filtered historical money when the durable day cache is empty', () => {
    const history: DashboardHistoryIndex = {
      provider: 'claude', normalizedProjects: [historicalProviderProject()], cache: emptyDailyCache(), planUsages: [], readyThrough: 'lifetime',
    }

    expect(selectDashboardHistoryIndex(history, 'lifetime').durable).toMatchObject({
      cost: 7,
      calls: 1,
      sessions: 1,
    })
  })

  it('warns honestly before a large first history index', async () => {
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream
    stdin.isTTY = true
    stdin.setRawMode = () => stdin
    stdin.ref = () => stdin
    stdin.unref = () => stdin
    stdout.isTTY = true
    stdout.columns = 140
    stdout.rows = 50
    const frames: string[] = []
    stdout.on('data', chunk => frames.push(stripAnsi(String(chunk))))

    const app = render(React.createElement(InteractiveDashboard, {
      initialProjects: [project()], initialPeriod: 'today', initialProvider: 'all',
      refreshSeconds: 0, windowColumns: 140, initialIndexPendingFiles: 1000, initialCacheWasCold: true,
    }), { stdin, stdout, debug: true, interactive: true, patchConsole: false })
    onTestFinished(() => app.unmount())
    await app.waitUntilRenderFlush()

    const frame = frames.filter(value => value.trim()).at(-1) ?? ''
    expect(frame).toContain('indexing Today ready; loading 7 Days · 0 source files parsed · 1000 deferred at first paint')
    expect(frame).toContain('large first index · may take a few minutes')
  })

  it('never labels Today totals as Lifetime while the history index is unavailable', async () => {
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream
    stdin.isTTY = true
    stdin.setRawMode = () => stdin
    stdin.ref = () => stdin
    stdin.unref = () => stdin
    stdout.isTTY = true
    stdout.columns = 120
    stdout.rows = 50
    const frames: string[] = []
    stdout.on('data', chunk => frames.push(stripAnsi(String(chunk))))

    const app = render(React.createElement(InteractiveDashboard, {
      initialProjects: [project()], initialPeriod: 'today', initialProvider: 'all',
      initialDurable: { cost: 1, savingsUSD: 0, calls: 1, sessions: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, carriedCostUSD: 0 },
      refreshSeconds: 0, windowColumns: 120, initialIndexPendingFiles: 1,
    }), { stdin, stdout, debug: true, interactive: true, patchConsole: false })
    onTestFinished(() => app.unmount())
    await app.waitUntilRenderFlush()

    frames.length = 0
    stdin.write('6')
    await app.waitUntilRenderFlush()
    const frame = frames.filter(value => value.trim()).at(-1) ?? ''

    expect(frame).toContain('Loading Lifetime')
    expect(frame).not.toContain('$1.00 cost')
  })

  it('switches periods synchronously from the completed normalized index', async () => {
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream
    stdin.isTTY = true
    stdin.setRawMode = () => stdin
    stdin.ref = () => stdin
    stdin.unref = () => stdin
    stdout.isTTY = true
    stdout.columns = 120
    stdout.rows = 50
    const frames: string[] = []
    stdout.on('data', chunk => frames.push(stripAnsi(String(chunk))))
    const history: DashboardHistoryIndex = { provider: 'all', normalizedProjects: [project()], cache: emptyDailyCache(), planUsages: [] }

    const app = render(React.createElement(InteractiveDashboard, {
      initialProjects: [project()], initialPeriod: 'today', initialProvider: 'all',
      initialDurable: { cost: 1, savingsUSD: 0, calls: 1, sessions: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, carriedCostUSD: 0 },
      refreshSeconds: 0, windowColumns: 120, initialHistoryIndex: history,
    }), { stdin, stdout, debug: true, interactive: true, patchConsole: false })
    onTestFinished(() => app.unmount())
    await app.waitUntilRenderFlush()

    frames.length = 0
    stdin.write('6')
    await app.waitUntilRenderFlush()
    const frame = frames.filter(value => value.trim()).at(-1) ?? ''

    expect(frame).toContain('[ Lifetime ]')
    expect(frame).toContain('$0.00 cost')
    expect(frame).not.toContain('$1.00 cost')
    expect(frame).not.toContain('Loading Lifetime')
  })

  it('makes 7 Days usable before Lifetime on a widening cold index', async () => {
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream
    stdin.isTTY = true
    stdin.setRawMode = () => stdin
    stdin.ref = () => stdin
    stdin.unref = () => stdin
    stdout.isTTY = true
    stdout.columns = 120
    stdout.rows = 50
    const frames: string[] = []
    stdout.on('data', chunk => frames.push(stripAnsi(String(chunk))))
    const history: DashboardHistoryIndex = {
      provider: 'all', normalizedProjects: [project()], cache: emptyDailyCache(), planUsages: [], readyThrough: 'week',
    }

    const app = render(React.createElement(InteractiveDashboard, {
      initialProjects: [project()], initialPeriod: 'today', initialProvider: 'all',
      refreshSeconds: 0, windowColumns: 120, initialHistoryIndex: history, initialHistoryIndexing: true,
    }), { stdin, stdout, debug: true, interactive: true, patchConsole: false })
    onTestFinished(() => app.unmount())
    await app.waitUntilRenderFlush()

    frames.length = 0
    stdin.write('2')
    await app.waitUntilRenderFlush()
    let frame = frames.filter(value => value.trim()).at(-1) ?? ''
    expect(frame).toContain('[ 7 Days ]')
    expect(frame).not.toContain('Loading 7 Days')

    frames.length = 0
    stdin.write('6')
    await app.waitUntilRenderFlush()
    frame = frames.filter(value => value.trim()).at(-1) ?? ''
    expect(frame).toContain('Loading Lifetime')
    expect(frame).not.toContain('$1.00 cost')
  })

  it('labels a warm first frame as cached without a fake source-file fraction', async () => {
    const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream
    const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream
    stdin.isTTY = true
    stdin.setRawMode = () => stdin
    stdin.ref = () => stdin
    stdin.unref = () => stdin
    stdout.isTTY = true
    stdout.columns = 140
    stdout.rows = 50
    const frames: string[] = []
    stdout.on('data', chunk => frames.push(stripAnsi(String(chunk))))

    const app = render(React.createElement(InteractiveDashboard, {
      initialProjects: [project()], initialPeriod: 'today', initialProvider: 'all',
      refreshSeconds: 0, windowColumns: 140, initialIndexPendingFiles: 1, initialCacheWasCold: false,
    }), { stdin, stdout, debug: true, interactive: true, patchConsole: false })
    onTestFinished(() => app.unmount())
    await app.waitUntilRenderFlush()

    const frame = frames.filter(value => value.trim()).at(-1) ?? ''
    expect(frame).toContain('cached loading normalized cache · cached Today ready; source refresh pending')
    expect(frame).not.toContain('0/1 source files')
  })
})
