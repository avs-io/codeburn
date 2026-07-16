// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Splash } from './Splash'
import { mockMatchMedia as mockReducedMotion } from '../lib/testMatchMedia'

function splashEl(): HTMLElement | null {
  return document.querySelector('.splash')
}


afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('Splash', () => {
  it('stays up while the first overview fetch has neither data nor error', () => {
    render(<Splash hasData={false} hasError={false} />)
    const el = splashEl()
    expect(el).toBeInTheDocument()
    // Static under vitest / the closed motion gate: no ignite/pulse class.
    expect(el).not.toHaveClass('splash-lit')
  })

  it('holds the min on-screen time, then crossfades away once data lands', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Splash hasData={false} hasError={false} />)
    expect(splashEl()).toBeInTheDocument()

    // First data lands immediately (warm cache): the floor must keep it up.
    rerender(<Splash hasData hasError={false} />)
    act(() => { vi.advanceTimersByTime(599) })
    expect(splashEl()).toBeInTheDocument()
    expect(splashEl()).not.toHaveClass('splash-out')

    // Floor reached: begin the crossfade (still on screen during it).
    act(() => { vi.advanceTimersByTime(1) })
    expect(splashEl()).toHaveClass('splash-out')

    // Crossfade complete: gone.
    act(() => { vi.advanceTimersByTime(250) })
    expect(splashEl()).not.toBeInTheDocument()
  })

  it('yields immediately when the first fetch errors, with no min-time', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Splash hasData={false} hasError={false} />)
    expect(splashEl()).toBeInTheDocument()

    rerender(<Splash hasData={false} hasError />)
    expect(splashEl()).not.toBeInTheDocument()
  })

  it('never reappears on a later loading state after it has dismissed', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Splash hasData={false} hasError={false} />)
    rerender(<Splash hasData hasError={false} />)
    act(() => { vi.advanceTimersByTime(600) })
    act(() => { vi.advanceTimersByTime(250) })
    expect(splashEl()).not.toBeInTheDocument()

    // A filter change re-enters loading and can clear last-good data; the splash
    // must not come back.
    rerender(<Splash hasData={false} hasError={false} />)
    expect(splashEl()).not.toBeInTheDocument()
    rerender(<Splash hasData hasError={false} />)
    expect(splashEl()).not.toBeInTheDocument()
  })

  it('swaps instantly under reduced motion (no fade, no min-time)', () => {
    mockReducedMotion(true)
    const { rerender } = render(<Splash hasData={false} hasError={false} />)
    const el = splashEl()
    expect(el).toBeInTheDocument()
    expect(el).not.toHaveClass('splash-lit')

    // No timers advanced: data lands and the overlay is gone at once.
    rerender(<Splash hasData hasError={false} />)
    expect(splashEl()).not.toBeInTheDocument()
  })
})
