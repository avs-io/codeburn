import { afterEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import { pathToFileURL } from 'url'

import { acquireCacheRefreshLock } from '../src/cache-refresh-lock.js'
import { saveStatusSnapshot } from '../src/session-cache.js'

const LOCK_WAIT_PROBE = pathToFileURL(join(process.cwd(), 'tests/fixtures/cache-refresh-lock-wait-probe.mjs')).href

const roots: string[] = []
const asyncCli: { child: ChildProcess, promise: Promise<unknown> }[] = []

function forgetAsyncCli(child: ChildProcess): void {
  const i = asyncCli.findIndex(entry => entry.child === child)
  if (i >= 0) asyncCli.splice(i, 1)
}

async function waitFor(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`)
    await new Promise(resolve => { setTimeout(resolve, 5) })
  }
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return child.exitCode === 0 ? Promise.resolve() : Promise.reject(new Error(`worker exited ${child.exitCode}`))
  }
  return new Promise((resolve, reject) => {
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`worker exited ${code}: ${stderr}`)))
  })
}

function worker(cacheDir: string, barriers: string, role: 'fresh' | 'stale', rounds: number): ChildProcess {
  return spawn(process.execPath, [
    '--import',
    'tsx',
    join(process.cwd(), 'tests/fixtures/status-snapshot-writer.ts'),
    cacheDir,
    barriers,
    role,
    String(rounds),
  ], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] })
}

function recordPath(cacheDir: string, queryKey: string): string {
  const hash = createHash('sha256').update(queryKey).digest('hex').slice(0, 16)
  return join(cacheDir, `status-snapshot.${hash}.json`)
}

afterEach(async () => {
  delete process.env['CODEBURN_CACHE_DIR']
  const owned = asyncCli.splice(0)
  try {
    await Promise.all(owned.map(async ({ child, promise }) => {
      try { await stopCliChild(child) } catch { /* still remove roots */ }
      try { await promise } catch { /* spawn error or already rejected */ }
    }))
  } finally {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  }
})

describe('status snapshot child-process write lock', () => {
  it('never lets the older observation win a same-query publication race', async () => {
    const rounds = 20
    const root = await mkdtemp(join(tmpdir(), 'cb-status-snapshot-lock-'))
    roots.push(root)
    const cacheDir = join(root, 'cache')
    const barriers = join(root, 'barriers')
    await mkdir(cacheDir, { recursive: true })
    await mkdir(barriers, { recursive: true })
    process.env['CODEBURN_CACHE_DIR'] = cacheDir

    for (let round = 0; round < rounds; round++) {
      await saveStatusSnapshot(
        `baseline-${round}`,
        1_000,
        1_000,
        `child-query-${round}`,
        'child-process-render-v1',
        { role: 'baseline', round },
      )
    }

    const fresh = worker(cacheDir, barriers, 'fresh', rounds)
    const stale = worker(cacheDir, barriers, 'stale', rounds)
    for (let round = 0; round < rounds; round++) {
      await Promise.all([
        waitFor(join(barriers, `fresh.${round}.ready`)),
        waitFor(join(barriers, `stale.${round}.ready`)),
      ])
      await writeFile(join(barriers, `${round}.go`), '')
      await Promise.all([
        waitFor(join(barriers, `fresh.${round}.done`)),
        waitFor(join(barriers, `stale.${round}.done`)),
      ])
    }
    await Promise.all([waitForExit(fresh), waitForExit(stale)])

    for (let round = 0; round < rounds; round++) {
      const record = JSON.parse(await readFile(recordPath(cacheDir, `child-query-${round}`), 'utf-8')) as {
        corpusFingerprint: string
        payload: { role: string; round: number }
      }
      expect(record).toMatchObject({
        corpusFingerprint: `fresh-${round}`,
        payload: { role: 'fresh', round },
      })
    }
    expect((await readdir(cacheDir)).filter(name => name.endsWith('.tmp') || name.endsWith('.lock'))).toEqual([])
  })
})

// Post-merge review of PR #999: a `status --format menubar-json --no-optimize`
// poll that runs while ANOTHER process holds `session-refresh.lock` parses
// read-only and serves a degraded corpus (payload.stale === true), and a later
// in-process parse — the payload builder's own history re-parse, running after
// the holder releases — flips the module-level hydration global back to
// complete before the save point. A save gate consulting only that global
// persists the under-reported payload under the CURRENT corpus fingerprint,
// poisoning every future poll. This case spawns the real CLI against a live
// cross-process refresh lock, so it lives in the serial `test:locks` suite
// rather than the full parallel `npm test` pool.
const SNAPSHOT_FILE_RE = /^status-snapshot\.[0-9a-f]+\.json$/
async function snapshotFileNames(cacheDir: string): Promise<string[]> {
  if (!existsSync(cacheDir)) return []
  return (await readdir(cacheDir)).filter(f => SNAPSHOT_FILE_RE.test(f))
}

function cliEnv(home: string, extraEnv: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CODEBURN_CACHE_DIR: join(home, '.cache', 'codeburn'),
    HOME: home, USERPROFILE: home,
    TZ: 'UTC',
    ...extraEnv,
  }
}

type CliResult = { status: number | null, stdout: string, stderr: string, signal: NodeJS.Signals | null }

// Same wall bound as runCli's spawnSync timeout — not a longer wait. SIGTERM
// grace is only the hang-escalation path, not the happy path.
const CLI_CHILD_MS = 60_000
const TERM_GRACE_MS = 1_000

function stillRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

function runCli(args: string[], home: string, extraEnv: Record<string, string> = {}): CliResult {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    env: cliEnv(home, extraEnv),
    encoding: 'utf-8',
    timeout: CLI_CHILD_MS,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', signal: result.signal }
}

async function stopCliChild(child: ChildProcess): Promise<void> {
  if (!stillRunning(child)) return
  await new Promise<void>(resolve => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      clearTimeout(grace)
      resolve()
    }
    const grace = setTimeout(() => {
      if (stillRunning(child)) child.kill('SIGKILL')
    }, TERM_GRACE_MS)
    child.once('exit', done)
    child.kill('SIGTERM')
    if (!stillRunning(child)) done()
  })
}

function runCliAsync(
  args: string[],
  home: string,
  extraEnv: Record<string, string> = {},
  opts: { lockWaitReady?: string } = {},
): { child: ChildProcess, promise: Promise<CliResult> } {
  const nodeArgs = ['--import', 'tsx']
  if (opts.lockWaitReady) nodeArgs.push('--import', LOCK_WAIT_PROBE)
  const child = spawn(process.execPath, [...nodeArgs, 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    env: cliEnv(home, opts.lockWaitReady
      ? { ...extraEnv, CODEBURN_LOCK_WAIT_READY: opts.lockWaitReady }
      : extraEnv),
  })
  const promise = new Promise<CliResult>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let termTimer: ReturnType<typeof setTimeout> | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const clearTimers = (): void => {
      if (termTimer !== undefined) clearTimeout(termTimer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      termTimer = undefined
      killTimer = undefined
    }
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimers()
      forgetAsyncCli(child)
      fn()
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8') })
    child.once('error', err => { settle(() => reject(err)) })
    child.once('close', (status, signal) => { settle(() => resolve({ status, stdout, stderr, signal })) })
    termTimer = setTimeout(() => {
      if (!stillRunning(child)) return
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (stillRunning(child)) child.kill('SIGKILL')
      }, TERM_GRACE_MS)
    }, CLI_CHILD_MS)
  })
  asyncCli.push({ child, promise })
  return { child, promise }
}

function userLine(sessionId: string, timestamp: string): string {
  return JSON.stringify({
    type: 'user',
    sessionId,
    timestamp,
    message: { role: 'user', content: 'do the thing' },
  })
}

function assistantLine(sessionId: string, timestamp: string, messageId: string): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId,
    timestamp,
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'done' }],
      usage: { input_tokens: 500, output_tokens: 50 },
    },
  })
}

describe('degraded read-only parse is never persisted as a status snapshot', () => {
  it('writes no snapshot for a lock-degraded poll, then resumes persisting on the clean pass', { timeout: 120_000 }, async () => {
    const home = await mkdtemp(join(tmpdir(), 'codeburn-snapshot-degraded-'))
    roots.push(home)
    const cacheDir = join(home, '.cache', 'codeburn')
    // Two Claude config roots: the query below is scoped to one of them via
    // --claude-config-source. The scoped path is what makes the PR #999
    // sequence reachable in a one-shot process: the payload builder captures
    // the hydration verdict right after the (degraded) primary parse, then
    // runs its OWN history re-parse over a wider range — a second, real
    // parse that re-acquires the lock once the holder releases and flips the
    // module-level hydration global back to complete before the save point.
    const work = join(home, 'claude-work')
    const personal = join(home, 'claude-personal')
    await mkdir(join(work, 'projects', 'app'), { recursive: true })
    await mkdir(join(personal, 'projects', 'app'), { recursive: true })

    // Two hours back, clamped inside the current UTC day (cliEnv pins
    // TZ=UTC), so every session falls inside the 'today' query.
    const now = new Date()
    const todayUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const base = new Date(Math.max(todayUtcMidnight, now.getTime() - 2 * 3600_000))
    const ts = (offset: number) => new Date(base.getTime() + offset).toISOString().replace(/\.\d+Z$/, 'Z')

    await writeFile(
      join(work, 'projects', 'app', 'w1.jsonl'),
      [userLine('w1', ts(0)), assistantLine('w1', ts(60_000), 'msg-w1')].join('\n') + '\n',
    )
    await writeFile(
      join(personal, 'projects', 'app', 'p1.jsonl'),
      [userLine('p1', ts(30_000)), assistantLine('p1', ts(90_000), 'msg-p1')].join('\n') + '\n',
    )
    const env = { CLAUDE_CONFIG_DIRS: [work, personal].join(delimiter) }

    // Warm the session cache through the DEFAULT optimize path: it parses
    // and persists the corpus but never reads or writes the status snapshot
    // (main.ts: useSnapshot = !optimize). Also discovers the config-source
    // id the scoped queries below select.
    const warm = runCli(['status', '--format', 'menubar-json', '--period', 'today', '--provider', 'all'], home, env)
    expect(warm.status, `stderr: ${warm.stderr}`).toBe(0)
    const warmPayload = JSON.parse(warm.stdout) as {
      current: { calls: number }
      claudeConfigs: { options: Array<{ id: string, label: string }> }
    }
    expect(warmPayload.current.calls).toBe(2)
    const workSourceId = warmPayload.claudeConfigs.options.find(o => o.label === 'claude-work')?.id
    expect(workSourceId).toBeTruthy()
    expect(await snapshotFileNames(cacheDir)).toEqual([])

    // New activity in the SELECTED root that the warm cache has never seen.
    // A read-only parse has no cache entry for it and must skip it,
    // under-reporting the totals.
    await writeFile(
      join(work, 'projects', 'app', 'w2.jsonl'),
      [userLine('w2', ts(120_000)), assistantLine('w2', ts(180_000), 'msg-w2')].join('\n') + '\n',
    )

    const args = [
      'status', '--format', 'menubar-json', '--period', 'today', '--provider', 'all',
      '--claude-config-source', workSourceId!,
      '--no-optimize',
    ]

    // A live, heartbeating owner holding the refresh lock, exactly as in
    // cache-refresh-lock.test.ts: the pid answers signal 0 and the mtime
    // stays fresh, so the child's primary parse can neither acquire nor
    // take over — it parks in the wait loop.
    const held = await acquireCacheRefreshLock({ cacheDir })
    expect(held.outcome).toBe('acquired')
    if (held.outcome !== 'acquired') return

    let degraded
    const readyPath = join(home, 'lock-wait.ready')
    const running = runCliAsync(args, home, env, { lockWaitReady: readyPath })
    try {
      // Release only once the child has failed its first exclusive create on
      // session-refresh.lock. The wait-probe writes readyPath on that EEXIST,
      // which is the observable that the first acquire did not succeed.
      // Releasing earlier would let that FIRST acquire succeed and turn this
      // into a clean run; releasing is what reports 'completed-by-other' and
      // sends the primary parse down the read-only path while leaving the
      // lock free for the payload builder's later history re-parse — the
      // exact PR #999 sequence.
      const parked = waitFor(readyPath, 60_000).then(() => 'parked' as const)
      const first = await Promise.race([parked, running.promise.then(result => ({ result }))])
      if (first !== 'parked') {
        throw new Error(
          `CLI exited before lock wait: status=${first.result.status} stderr=${first.result.stderr}`,
        )
      }
      await held.handle.release()
      degraded = await running.promise
    } finally {
      await stopCliChild(running.child)
      await running.promise.catch(() => undefined)
      await held.handle.release()
    }

    if (degraded.status !== 0) {
      throw new Error(
        `CLI stuck after lock-wait ready: status=${degraded.status} signal=${degraded.signal} stderr=${degraded.stderr}`,
      )
    }
    expect(degraded.status, `stderr: ${degraded.stderr}`).toBe(0)
    const degradedPayload = JSON.parse(degraded.stdout) as { stale?: boolean, current: { calls: number } }
    // The primary parse went read-only behind the held lock and served the
    // warm cache: w2 is missing from the totals and the payload says so.
    expect(degradedPayload.stale).toBe(true)
    expect(degradedPayload.current.calls).toBe(1)
    // The gate: no snapshot may be persisted from this degraded payload,
    // even though the history re-parse after the release flipped the
    // hydration global back to complete before the save point.
    expect(await snapshotFileNames(cacheDir)).toEqual([])

    // The gate reopens: the identical query on a clean pass recomputes and
    // persists a complete snapshot.
    const clean = runCli(args, home, env)
    expect(clean.status, `stderr: ${clean.stderr}`).toBe(0)
    const cleanPayload = JSON.parse(clean.stdout) as { stale?: boolean, current: { calls: number } }
    expect(cleanPayload.stale).toBeUndefined()
    expect(cleanPayload.current.calls).toBe(2)

    const snapshots = await snapshotFileNames(cacheDir)
    expect(snapshots).toHaveLength(1)
    const record = JSON.parse(await readFile(join(cacheDir, snapshots[0]!), 'utf-8')) as {
      payload: { stale?: boolean, current: { calls: number } }
    }
    expect(record.payload.stale).toBeUndefined()
    expect(record.payload.current.calls).toBe(2)
  })
})
