import { describe, expect, it } from 'vitest'
import { COPY, FORBIDDEN_COPY } from './copy'

describe('glance copy', () => {
  it('pins the product strings exactly', () => {
    expect(COPY.title).toBe('CodeBurn')
    expect(COPY.reassurance).toBe('Local usage · nothing sent')
    expect(COPY.today).toBe('Today')
    expect(COPY.last7Days).toBe('Last 7 days')
    expect(COPY.qualifier).toBe('Estimated · list API rates')
    expect(COPY.empty).toBe('No sessions in this period.')
    expect(COPY.loading).toBe('Refreshing…')
    expect(COPY.error).toBe('Couldn’t read usage.')
    expect(COPY.retry).toBe('Retry')
    expect(COPY.cliMissingTitle).toBe('CLI not found')
    expect(COPY.cliMissingBody).toBe(
      'The menu reads local usage from the codeburn CLI. Nothing has been sent anywhere.',
    )
    expect(COPY.openCodeBurn).toBe('Open CodeBurn')
    expect(COPY.locateCli).toBe('Locate CLI')
    expect(COPY.refresh).toBe('Refresh')
    expect(COPY.quit).toBe('Quit')
    expect(COPY.pinHint).toBe(
      'Pin CodeBurn in the notification area so the flame stays on the taskbar. The hotkey still works if Windows hides it.',
    )
  })

  it('never ships the forbidden buttons', () => {
    const values = Object.values(COPY)
    for (const forbidden of FORBIDDEN_COPY) {
      expect(values).not.toContain(forbidden)
    }
  })
})
