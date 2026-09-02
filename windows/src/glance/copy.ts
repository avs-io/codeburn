/** Exact Glance flyout copy. Do not paraphrase — the product spec pins these strings. */

export const COPY = {
  title: 'CodeBurn',
  reassurance: 'Local usage · nothing sent',
  today: 'Today',
  last7Days: 'Last 7 days',
  qualifier: 'Estimated · list API rates',
  empty: 'No sessions in this period.',
  loading: 'Refreshing…',
  error: 'Couldn’t read usage.',
  retry: 'Retry',
  cliMissingTitle: 'CLI not found',
  cliMissingBody:
    'The menu reads local usage from the codeburn CLI. Nothing has been sent anywhere.',
  openCodeBurn: 'Open CodeBurn',
  locateCli: 'Locate CLI',
  refresh: 'Refresh',
  quit: 'Quit',
  pinHint:
    'Pin CodeBurn in the notification area so the flame stays on the taskbar. The hotkey still works if Windows hides it.',
} as const

export const FORBIDDEN_COPY = ['Continue', 'Submit', 'Sync now'] as const
