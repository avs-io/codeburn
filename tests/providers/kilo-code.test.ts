import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { kiloCode, createKiloCodeProvider } from '../../src/providers/kilo-code.js'
import type { ParsedProviderCall } from '../../src/providers/types.js'

let tmpDir: string

describe('kilo-code provider - discovery path differentiation', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'kilo-code-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('discovers tasks using kilo-code extension path', async () => {
    const task = join(tmpDir, 'tasks', 'task-kilo-1')
    await mkdir(task, { recursive: true })
    await writeFile(join(task, 'ui_messages.json'), JSON.stringify([
      { type: 'say', say: 'api_req_started', text: JSON.stringify({ tokensIn: 100, tokensOut: 50 }), ts: 1700000000000 },
    ]))

    const provider = createKiloCodeProvider(tmpDir)
    const sessions = await provider.discoverSessions()
    const fromOverride = sessions.filter(s => s.path.startsWith(tmpDir))

    expect(fromOverride).toHaveLength(1)
    expect(fromOverride[0]!.provider).toBe('kilo-code')
  })

  it('parses with kilo-code provider name in dedup key', async () => {
    const task = join(tmpDir, 'tasks', 'task-kilo-2')
    await mkdir(task, { recursive: true })
    await writeFile(join(task, 'ui_messages.json'), JSON.stringify([
      { type: 'say', say: 'api_req_started', text: JSON.stringify({ tokensIn: 200, tokensOut: 100 }), ts: 1700000000000 },
    ]))

    const source = { path: task, project: 'task-kilo-2', provider: 'kilo-code' }
    const calls: ParsedProviderCall[] = []
    for await (const call of kiloCode.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.provider).toBe('kilo-code')
    expect(calls[0]!.deduplicationKey).toMatch(/^kilo-code:/)
  })
})

describe('kilo-code provider - sqlite session-level fallback', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'kilo-code-sqlite-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // KiloCode's sqlite session table is not confirmed to share OpenCode's
  // `model` column naming (issue #769 only confirms OpenCode's real schema).
  // The shared parser's fallback query must keep working here even though
  // this fixture uses the older/alternate `model_id` name.
  it('falls back to session-level tokens using a model_id column schema', async () => {
    const kiloDir = join(tmpDir, 'kilo')
    await mkdir(kiloDir, { recursive: true })
    const dbPath = join(kiloDir, 'kilo.db')

    const { DatabaseSync: Database } = require('node:sqlite')
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT,
        slug TEXT NOT NULL, directory TEXT NOT NULL, title TEXT NOT NULL,
        version TEXT NOT NULL, time_created INTEGER, time_updated INTEGER,
        time_archived INTEGER
      )
    `)
    db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
      time_created INTEGER, time_updated INTEGER, data TEXT NOT NULL)`)
    db.exec(`CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
      session_id TEXT NOT NULL, time_created INTEGER, time_updated INTEGER, data TEXT NOT NULL)`)
    db.exec(`ALTER TABLE session ADD COLUMN cost REAL`)
    db.exec(`ALTER TABLE session ADD COLUMN tokens_input INTEGER`)
    db.exec(`ALTER TABLE session ADD COLUMN tokens_output INTEGER`)
    db.exec(`ALTER TABLE session ADD COLUMN tokens_reasoning INTEGER`)
    db.exec(`ALTER TABLE session ADD COLUMN tokens_cache_read INTEGER`)
    db.exec(`ALTER TABLE session ADD COLUMN tokens_cache_write INTEGER`)
    db.exec(`ALTER TABLE session ADD COLUMN model_id TEXT`)

    db.prepare(`INSERT INTO session (id, project_id, slug, directory, title, version, time_created)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run('sess-1', 'proj-1', 'slug-1', '/home/user/project', 'Project', '1.0', 1700000000000)
    db.prepare(`UPDATE session SET cost = 0.09, tokens_input = 900, tokens_output = 400, tokens_reasoning = 0, tokens_cache_read = 100, tokens_cache_write = 50, model_id = 'gpt-5' WHERE id = 'sess-1'`).run()
    db.prepare(`INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)`)
      .run('msg-1', 'sess-1', 1700000001000, JSON.stringify({ role: 'assistant' }))
    db.close()

    const provider = createKiloCodeProvider()
    const source = { path: `${dbPath}:sess-1`, project: 'project', provider: 'kilo-code' }
    const calls: ParsedProviderCall[] = []
    for await (const call of provider.createSessionParser(source, new Set()).parse()) calls.push(call)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.model).toBe('gpt-5')
    expect(calls[0]!.inputTokens).toBe(900)
    expect(calls[0]!.outputTokens).toBe(400)
    expect(calls[0]!.deduplicationKey).toBe('kilo-code:sess-1:session-level')
  })
})

describe('kilo-code provider - metadata', () => {
  it('has correct name and displayName', () => {
    expect(kiloCode.name).toBe('kilo-code')
    expect(kiloCode.displayName).toBe('KiloCode')
  })

  it('uses different extension ID than roo-code', () => {
    expect(kiloCode.name).toBe('kilo-code')
    expect(kiloCode.name).not.toBe('roo-code')
  })
})
