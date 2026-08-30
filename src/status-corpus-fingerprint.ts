import { readdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { getAllProviders, getProvider, safeDiscoverSessions } from './providers/index.js'
import { collectJsonlFiles } from './parser.js'
import { computeEnvFingerprint, fingerprintFile } from './session-cache.js'
import type { CorpusFingerprint } from './parser.js'
import type { Provider, SessionSource } from './providers/types.js'

async function collectFilesRecursive(dirPath: string, visitedDirs: Set<string> = new Set()): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const p = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFilesRecursive(p, visitedDirs))
      continue
    }
    if (entry.isSymbolicLink()) {
      const target = await stat(p).catch(() => null)
      if (target?.isDirectory()) {
        const key = `${target.dev}:${target.ino}`
        if (visitedDirs.has(key)) continue
        visitedDirs.add(key)
        files.push(...await collectFilesRecursive(p, visitedDirs))
        continue
      }
    }
    files.push(p)
  }
  return files
}

export async function collectCodexRollouts(root: string): Promise<string[]> {
  const files: string[] = []
  const sessionsDir = join(root, 'sessions')
  const years = (await readdir(sessionsDir).catch(() => [] as string[])).filter(y => /^[0-9]{4}$/.test(y))
  for (const year of years) {
    const months = (await readdir(join(sessionsDir, year)).catch(() => [] as string[])).filter(m => /^[0-9]{2}$/.test(m))
    for (const month of months) {
      const days = (await readdir(join(sessionsDir, year, month)).catch(() => [] as string[])).filter(d => /^[0-9]{2}$/.test(d))
      for (const day of days) {
        const dayDir = join(sessionsDir, year, month, day)
        const names = await readdir(dayDir).catch(() => [] as string[])
        for (const name of names) {
          if (name.startsWith('rollout-') && name.endsWith('.jsonl')) files.push(join(dayDir, name))
        }
      }
    }
  }
  const archivedDir = join(root, 'archived_sessions')
  const archived = await readdir(archivedDir).catch(() => [] as string[])
  for (const name of archived) {
    if (name.startsWith('rollout-') && name.endsWith('.jsonl')) files.push(join(archivedDir, name))
  }
  return files
}

async function recordFile(
  path: string,
  entries: string[],
  newest: { mtimeMs: number },
): Promise<void> {
  const fp = await fingerprintFile(path)
  if (!fp) return
  entries.push(`${path}|${fp.dev}|${fp.ino}|${fp.mtimeMs}|${fp.sizeBytes}`)
  if (fp.mtimeMs > newest.mtimeMs) newest.mtimeMs = fp.mtimeMs
}

async function recordSource(
  source: SessionSource,
  entries: string[],
  newest: { mtimeMs: number },
  resolveProvider: (name: string) => Promise<Provider | undefined>,
  envFingerprinted: Set<string>,
): Promise<void> {
  entries.push(`source:${JSON.stringify([
    source.provider,
    source.path,
    source.project,
    source.sourceKind ?? null,
    source.sourceId ?? null,
    source.sourceLabel ?? null,
    source.sourcePath ?? null,
    source.retainWhilePresent ?? false,
  ])}`)
  if (!envFingerprinted.has(source.provider)) {
    envFingerprinted.add(source.provider)
    entries.push(`env:${source.provider}|${computeEnvFingerprint(source.provider)}`)
  }
  if (source.provider === 'claude') {
    for (const filePath of await collectJsonlFiles(source.path)) await recordFile(filePath, entries, newest)
    return
  }
  const provider = await resolveProvider(source.provider)
  if (provider?.network) {
    const now = Date.now()
    entries.push(`${source.path}|network|${now}`)
    if (now > newest.mtimeMs) newest.mtimeMs = now
    return
  }
  const info = await stat(source.path).catch(() => null)
  if (info?.isDirectory()) {
    for (const filePath of await collectFilesRecursive(source.path)) await recordFile(filePath, entries, newest)
    return
  }
  await recordFile(source.path, entries, newest)
}

/// Status-snapshot fingerprint. Same envelope as parser.computeCorpusFingerprint
/// for every provider except Codex: Codex is hashed from rollout path/mtime/size
/// without opening each file to extract cwd. That is the leftover 861 ms on a
/// live 7D snapshot hit. A new/deleted/rewritten rollout still moves the hash.
export async function computeStatusCorpusFingerprint(providerFilter?: string): Promise<CorpusFingerprint> {
  const observedAtMs = performance.timeOrigin + performance.now()
  const entries: string[] = []
  const newest = { mtimeMs: 0 }
  const envFingerprinted = new Set<string>()
  const providerByName = new Map<string, Provider | undefined>()
  const resolveProvider = async (name: string): Promise<Provider | undefined> => {
    if (!providerByName.has(name)) providerByName.set(name, await getProvider(name))
    return providerByName.get(name)
  }

  const all = await getAllProviders()
  const scoped = providerFilter && providerFilter !== 'all'
    ? all.filter(p => p.name === providerFilter)
    : all
  const includeCodex = scoped.some(p => p.name === 'codex')
  const others = includeCodex ? scoped.filter(p => p.name !== 'codex') : scoped

  if (others.length > 0) {
    const sources = (await Promise.all(others.map(p => safeDiscoverSessions(p)))).flat()
    for (const source of sources) await recordSource(source, entries, newest, resolveProvider, envFingerprinted)
  }

  if (includeCodex) {
    const codex = scoped.find(p => p.name === 'codex')
    if (codex) {
      if (!envFingerprinted.has('codex')) {
        envFingerprinted.add('codex')
        entries.push(`env:codex|${computeEnvFingerprint('codex')}`)
      }
      const roots = codex.probeRoots ? await codex.probeRoots() : []
      const sessionRoots = roots.filter(r => r.label === 'sessions')
      const homes = sessionRoots.length > 0
        ? [...new Set(sessionRoots.map(r => dirname(r.path)))]
        : []
      const seen = new Set<string>()
      for (const home of homes) {
        for (const filePath of await collectCodexRollouts(home)) {
          if (seen.has(filePath)) continue
          seen.add(filePath)
          entries.push(`source:${JSON.stringify(['codex', filePath, 'codex', null, null, null, null, false])}`)
          await recordFile(filePath, entries, newest)
        }
      }
    }
  }

  entries.sort()
  const hash = createHash('sha256').update(entries.join('\n')).digest('hex')
  return { hash, newestMtimeMs: newest.mtimeMs, observedAtMs }
}
