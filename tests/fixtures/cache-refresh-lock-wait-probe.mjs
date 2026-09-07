import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { basename } from 'node:path'

// Test-only --import: the real CLI has no "I am parked in lock wait" seam.
// createExclusive uses the named ESM export `open` from 'fs/promises'.
// Patching fs.promises.open alone does not update that live binding (tsx
// already imported the builtin before this probe runs), so the child never
// writes readyPath. syncBuiltinESMExports() republishes the CJS patch to
// the ESM named export the lock code actually calls.
const readyPath = process.env.CODEBURN_LOCK_WAIT_READY
if (readyPath) {
  const origOpen = fs.promises.open.bind(fs.promises)
  fs.promises.open = async function open(path, flags, mode) {
    try {
      return await origOpen(path, flags, mode)
    } catch (err) {
      if (
        err &&
        /** @type {NodeJS.ErrnoException} */ (err).code === 'EEXIST' &&
        flags === 'wx' &&
        typeof path === 'string' &&
        basename(path) === 'session-refresh.lock'
      ) {
        try { fs.writeFileSync(readyPath, '') } catch { /* already written */ }
      }
      throw err
    }
  }
  syncBuiltinESMExports()
}
