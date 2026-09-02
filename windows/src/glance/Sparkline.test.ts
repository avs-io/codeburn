import { describe, expect, it } from 'vitest'
import { SPARKLINE_COLOR, sparklineIsSlate } from './Sparkline'

describe('sparkline color', () => {
  it('is slate, not the FlameMark orange', () => {
    expect(SPARKLINE_COLOR.toLowerCase()).toBe('#64748b')
    expect(sparklineIsSlate(SPARKLINE_COLOR)).toBe(true)
    expect(sparklineIsSlate('#ff7a2a')).toBe(false)
    expect(sparklineIsSlate('#c9521d')).toBe(false)
  })
})
