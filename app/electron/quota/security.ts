import { constants, type Stats } from 'node:fs'
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

const NOFOLLOW = constants.O_NOFOLLOW ?? 0

export function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/\0/g, '')
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/sk-ant-[A-Za-z0-9_-]+/gi, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]+/gi, '[REDACTED]')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[REDACTED]')
    .slice(0, 240)
}

function assertSafeMode(stats: Stats, filePath: string): void {
  if (!stats.isFile()) throw new Error(`Credential path is not a regular file: ${filePath}`)
  if ((stats.mode & 0o077) !== 0) throw new Error(`Credential file permissions are too broad: ${filePath}`)
}

export async function readSecureFile(filePath: string, maxBytes = 64 * 1024): Promise<string | null> {
  let before: Stats
  try {
    before = await lstat(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (before.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${filePath}`)
  assertSafeMode(before, filePath)
  if (before.size > maxBytes) throw new Error(`Credential file exceeds ${maxBytes} bytes: ${filePath}`)

  const handle = await open(filePath, constants.O_RDONLY | NOFOLLOW)
  try {
    const after = await handle.stat()
    assertSafeMode(after, filePath)
    if (after.dev !== before.dev || after.ino !== before.ino) throw new Error(`Credential file changed while opening: ${filePath}`)
    if (after.size > maxBytes) throw new Error(`Credential file exceeds ${maxBytes} bytes: ${filePath}`)
    return await handle.readFile({ encoding: 'utf8' })
  } finally {
    await handle.close()
  }
}

export async function atomicWriteSecureFile(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
  const handle = await open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close()
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
  await handle.close()
  await chmod(tempPath, 0o600)
  try {
    await rename(tempPath, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

export function quotaRequestSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30_000)
  return parent ? AbortSignal.any([parent, timeout]) : timeout
}

export function fraction(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value / 100))
}
