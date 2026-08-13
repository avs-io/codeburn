import { PassThrough } from 'node:stream'

import React, { useEffect } from 'react'
import { render, Text, useWindowSize } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RESIZE_DEBOUNCE_MS, createDebouncedResizeStream, renderDebouncedInteractive } from '../src/dashboard.js'
import { BSU, ESU, stripSyncUpdateEscapes } from '../src/ink-win.js'

function makeTerminal(): PassThrough & NodeJS.WriteStream {
  const terminal = new PassThrough() as PassThrough & NodeJS.WriteStream
  terminal.isTTY = true
  terminal.columns = 100
  terminal.rows = 24
  return terminal
}

function ResizeProbe({ windowColumns, onRender }: {
  windowColumns: number
  onRender: (size: { columns: number; rows: number }) => void
}) {
  const size = useWindowSize()
  useEffect(() => {
    onRender(size)
  }, [size, onRender])
  return React.createElement(Text, null, `size:${windowColumns}x${size.rows}`)
}

function LifecycleProbe({ onMount, onCleanup }: { onMount: () => void; onCleanup: () => void }) {
  useWindowSize()
  useEffect(() => {
    onMount()
    return onCleanup
  }, [onMount, onCleanup])
  return React.createElement(Text, null, 'mounted')
}

function synchronizedFrames(writes: string[]): string[] {
  const frames: string[] = []
  let current: string | undefined
  for (const write of writes) {
    let rest = write
    while (rest.length > 0) {
      if (current === undefined) {
        const start = rest.indexOf(BSU)
        if (start === -1) break
        current = ''
        rest = rest.slice(start + BSU.length)
      }
      const end = rest.indexOf(ESU)
      if (end === -1) {
        current += rest
        break
      }
      current += rest.slice(0, end)
      frames.push(stripSyncUpdateEscapes(current))
      current = undefined
      rest = rest.slice(end + ESU.length)
    }
  }
  return frames
}

describe('interactive dashboard resize stream', () => {
  afterEach(() => vi.useRealTimers())

  it('publishes one coherent dimension transition after a resize burst settles', async () => {
    vi.useFakeTimers()
    const terminal = makeTerminal()
    const writes: string[] = []
    terminal.on('data', chunk => writes.push(String(chunk)))
    const transitions: Array<{ columns: number; rows: number }> = []
    const app = renderDebouncedInteractive(terminal, size => {
      transitions.push(size)
      return React.createElement(Text, null, `size:${size.columns}x${size.rows}`)
    }, {
      interactive: true,
      patchConsole: false,
      alternateScreen: true,
    })
    await vi.advanceTimersByTimeAsync(100)
    writes.length = 0
    transitions.length = 0

    terminal.columns = 99
    terminal.emit('resize')
    await vi.advanceTimersByTimeAsync(50)
    terminal.columns = 98
    terminal.emit('resize')
    await vi.advanceTimersByTimeAsync(50)
    terminal.columns = 97
    terminal.rows = 30
    terminal.emit('resize')

    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)
    await vi.advanceTimersByTimeAsync(100)

    expect(transitions).toEqual([{ columns: 97, rows: 30 }])
    const frames = writes
      .map(chunk => stripSyncUpdateEscapes(chunk))
      .map(chunk => chunk.match(/size:\d+x\d+/g) ?? [])
      .flat()
    expect(frames).toEqual(['size:97x30'])

    app.unmount()
    await vi.runAllTimersAsync()
    await app.waitUntilExit()
  })

  it('holds an unrelated state commit until one coherent settled resize frame', async () => {
    vi.useFakeTimers()
    const terminal = makeTerminal()
    const writes: string[] = []
    terminal.on('data', chunk => writes.push(String(chunk)))
    let updateVisibleState = () => {}
    const windowSizes: Array<{ columns: number; rows: number }> = []
    const StatefulProbe = ({ size }: { size: { columns: number; rows: number } }) => {
      const [revision, setRevision] = React.useState(0)
      updateVisibleState = () => setRevision(value => value + 1)
      const windowSize = useWindowSize()
      useEffect(() => {
        windowSizes.push(windowSize)
      }, [windowSize])
      return React.createElement(
        Text,
        null,
        `FRAME:revision=${revision}:prop=${size.columns}x${size.rows}:hook=${windowSize.columns}x${windowSize.rows}`,
      )
    }
    const app = renderDebouncedInteractive(terminal, size => React.createElement(StatefulProbe, { size }), {
      interactive: true,
      patchConsole: false,
      alternateScreen: true,
    })
    await vi.advanceTimersByTimeAsync(100)
    writes.length = 0
    windowSizes.length = 0

    terminal.columns = 80
    terminal.rows = 20
    terminal.emit('resize')
    updateVisibleState()
    await vi.advanceTimersByTimeAsync(100)

    expect(writes, 'no stale old-dimension application frame may reach the terminal before resize settlement').toEqual([])

    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)
    await vi.advanceTimersByTimeAsync(100)

    const frames = synchronizedFrames(writes)
      .filter(frame => frame.includes('FRAME:'))
      .map(frame => frame.match(/FRAME:[^\r\n]*/)?.[0])
    expect(frames).toEqual(['FRAME:revision=1:prop=80x20:hook=80x20'])
    expect(windowSizes).toEqual([{ columns: 80, rows: 20 }])

    app.unmount()
    await vi.runAllTimersAsync()
    await app.waitUntilExit()
  })

  it.each([
    { initial: { columns: 135, rows: 24 }, final: { columns: 132, rows: 30 } },
    { initial: { columns: 80, rows: 24 }, final: { columns: 160, rows: 12 } },
    { initial: { columns: 20, rows: 2 }, final: { columns: 10, rows: 1 } },
  ])('writes only the final frame for $initial → $final', async ({ initial, final }) => {
    vi.useFakeTimers()
    const terminal = makeTerminal()
    terminal.columns = initial.columns
    terminal.rows = initial.rows
    const writes: string[] = []
    terminal.on('data', chunk => writes.push(String(chunk)))
    const app = renderDebouncedInteractive(terminal, size => (
      React.createElement(Text, null, `FRAME:${size.columns}x${size.rows}`)
    ), {
      interactive: true,
      patchConsole: false,
      alternateScreen: true,
    })
    await vi.advanceTimersByTimeAsync(100)
    writes.length = 0

    terminal.columns = Math.max(1, final.columns + 1)
    terminal.rows = Math.max(1, final.rows - 1)
    terminal.emit('resize')
    await vi.advanceTimersByTimeAsync(50)
    terminal.columns = final.columns
    terminal.rows = final.rows
    terminal.emit('resize')
    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS + 100)

    const frames = writes
      .map(chunk => stripSyncUpdateEscapes(chunk))
      .flatMap(chunk => chunk.match(/FRAME:\d+x\d+/g) ?? [])
    expect(frames).toEqual([`FRAME:${final.columns}x${final.rows}`])

    app.unmount()
    await vi.runAllTimersAsync()
    await app.waitUntilExit()
  })

  it('does not require a post-commit layout correction for the settled resize frame', async () => {
    vi.useFakeTimers()
    const terminal = makeTerminal()
    terminal.columns = 135
    terminal.rows = 24
    const writes: string[] = []
    terminal.on('data', chunk => writes.push(String(chunk)))
    const app = renderDebouncedInteractive(terminal, size => (
      React.createElement(Text, null, `FRAME:${size.columns}x${size.rows}`)
    ), {
      interactive: true,
      patchConsole: false,
      alternateScreen: true,
    })
    await vi.advanceTimersByTimeAsync(100)
    writes.length = 0

    terminal.columns = 132
    terminal.rows = 30
    terminal.emit('resize')
    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS + 100)

    const frames = writes
      .map(chunk => stripSyncUpdateEscapes(chunk))
      .flatMap(chunk => chunk.match(/FRAME:\d+x\d+/g) ?? [])
    expect(frames).toEqual(['FRAME:132x30'])

    app.unmount()
    await vi.runAllTimersAsync()
    await app.waitUntilExit()
  })

  it('does not remount after exit when a source resize is still pending', async () => {
    vi.useFakeTimers()
    const terminal = makeTerminal()
    const onMount = vi.fn()
    const onCleanup = vi.fn()
    const app = renderDebouncedInteractive(terminal, () => (
      React.createElement(LifecycleProbe, { onMount, onCleanup })
    ), {
      interactive: true,
      patchConsole: false,
    })
    await vi.advanceTimersByTimeAsync(100)

    terminal.columns = 90
    terminal.emit('resize')
    app.unmount()
    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)
    await app.waitUntilExit()
    app.dispose()

    expect(onMount).toHaveBeenCalledOnce()
    expect(onCleanup).toHaveBeenCalledOnce()
    expect(terminal.listenerCount('resize')).toBe(0)
  })

  it('removes the source relay when the initial render throws', () => {
    const terminal = makeTerminal()

    expect(() => renderDebouncedInteractive(terminal, () => {
      throw new Error('render failed')
    }, { interactive: true, patchConsole: false })).toThrow('render failed')

    expect(terminal.listenerCount('resize')).toBe(0)
  })

  it('keeps disposal terminal across later listener mutation and introspection', () => {
    const terminal = makeTerminal()
    const stdout = createDebouncedResizeStream(terminal, RESIZE_DEBOUNCE_MS)

    expect(terminal.listenerCount('resize')).toBe(1)
    stdout.dispose()
    expect(terminal.listenerCount('resize')).toBe(0)

    stdout.removeAllListeners()
    stdout.eventNames()
    stdout.listeners('resize')
    stdout.rawListeners('resize')
    stdout.listenerCount('resize')
    stdout.dispose()

    expect(terminal.listenerCount('resize')).toBe(0)

    const resize = vi.fn()
    stdout.on('resize', resize)
    stdout.emit('resize')
    terminal.emit('resize')
    expect(resize).not.toHaveBeenCalled()
    expect(terminal.listenerCount('resize')).toBe(0)
  })

  it('keeps the mounted component state while applying a settled resize', async () => {
    vi.useFakeTimers()
    const terminal = makeTerminal()
    const mounts = vi.fn()
    const cleanups = vi.fn()
    const Stateful = ({ size }: { size: { columns: number; rows: number } }) => {
      const [cursor] = React.useState(7)
      useEffect(() => {
        mounts()
        return () => cleanups()
      }, [])
      return React.createElement(Text, null, `state:${cursor}:${size.columns}x${size.rows}`)
    }
    const app = renderDebouncedInteractive(terminal, size => React.createElement(Stateful, { size }), {
      interactive: true,
      patchConsole: false,
    })
    await vi.advanceTimersByTimeAsync(100)

    terminal.columns = 90
    terminal.rows = 20
    terminal.emit('resize')
    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS + 100)

    expect(mounts).toHaveBeenCalledOnce()
    expect(cleanups).not.toHaveBeenCalled()
    app.unmount()
    await vi.runAllTimersAsync()
    await app.waitUntilExit()
    expect(cleanups).toHaveBeenCalledOnce()
  })

  it('removes the source listener and cancels pending resize delivery on cleanup', async () => {
    vi.useFakeTimers()
    const terminal = makeTerminal()
    const stdout = createDebouncedResizeStream(terminal, RESIZE_DEBOUNCE_MS)
    const renderedSizes: Array<{ columns: number; rows: number }> = []
    const app = render(React.createElement(ResizeProbe, {
      windowColumns: stdout.columns,
      onRender: size => renderedSizes.push(size),
    }), {
      stdout,
      interactive: true,
      patchConsole: false,
    })
    await vi.advanceTimersByTimeAsync(100)
    renderedSizes.length = 0

    terminal.columns = 90
    terminal.emit('resize')
    app.unmount()
    await vi.runAllTimersAsync()
    await app.waitUntilExit()
    stdout.dispose()

    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)
    expect(renderedSizes).toEqual([])
    expect(terminal.listenerCount('resize')).toBe(0)
  })

  it('preserves native write arguments, return values, callbacks, and unrelated events', () => {
    const terminal = makeTerminal()
    const callback = vi.fn()
    const nativeWrite = vi.fn((_chunk: unknown, _encoding?: unknown, done?: () => void) => {
      done?.()
      return false
    })
    terminal.write = nativeWrite as typeof terminal.write
    const stdout = createDebouncedResizeStream(terminal, RESIZE_DEBOUNCE_MS)
    const onDrain = vi.fn()
    stdout.on('drain', onDrain)

    const accepted = stdout.write('terminal-frame', 'utf8', callback)
    terminal.emit('drain')

    expect(accepted).toBe(false)
    expect(nativeWrite).toHaveBeenCalledWith('terminal-frame', 'utf8', callback)
    expect(callback).toHaveBeenCalledOnce()
    expect(onDrain).toHaveBeenCalledOnce()

    stdout.off('drain', onDrain)
    stdout.dispose()
  })

  it('passes imperative controls during a pending resize and preserves suppressed-write completion', async () => {
    vi.useFakeTimers()
    const terminal = makeTerminal()
    const nativeWrites: string[] = []
    terminal.write = vi.fn((chunk: unknown, ...args: unknown[]) => {
      nativeWrites.push(String(chunk))
      const callback = args.find(arg => typeof arg === 'function') as (() => void) | undefined
      callback?.()
      return false
    }) as typeof terminal.write
    const stdout = createDebouncedResizeStream(terminal, RESIZE_DEBOUNCE_MS)
    const frameCallback = vi.fn()

    terminal.columns = 80
    terminal.emit('resize')
    expect(stdout.write('\u001B[?1006l\u001B[?1000l')).toBe(false)
    expect(stdout.write(`${BSU}stale-frame${ESU}`, frameCallback)).toBe(false)

    expect(nativeWrites).toEqual(['\u001B[?1006l\u001B[?1000l', ''])
    expect(frameCallback).toHaveBeenCalledOnce()
    stdout.dispose()
  })

  it('keeps listener chaining and inspection scoped to the debounced resize surface', async () => {
    vi.useFakeTimers()
    const terminal = makeTerminal()
    const stdout = createDebouncedResizeStream(terminal, RESIZE_DEBOUNCE_MS)
    const resize = vi.fn()
    const drain = vi.fn()

    const chained = stdout
      .setMaxListeners(20)
      .once('resize', resize)
      .on('drain', drain)

    expect(chained).toBe(stdout)
    expect(stdout.getMaxListeners()).toBe(20)
    expect(stdout.eventNames()).toEqual(expect.arrayContaining(['resize', 'drain']))
    expect(stdout.listenerCount('resize')).toBe(1)
    expect(terminal.listenerCount('resize')).toBe(1)

    stdout.emit('resize')
    stdout.emit('resize')
    terminal.emit('drain')
    stdout.emit('resize')

    expect(resize).toHaveBeenCalledOnce()
    expect(drain).toHaveBeenCalledOnce()
    expect(stdout.listenerCount('resize')).toBe(0)

    stdout.removeAllListeners()
    stdout.dispose()
  })

  it('preserves prepended one-shot order and applies global listener removal to both surfaces', async () => {
    vi.useFakeTimers()
    const terminal = makeTerminal()
    const stdout = createDebouncedResizeStream(terminal, RESIZE_DEBOUNCE_MS)
    const order: string[] = []
    const drain = vi.fn()
    stdout.on('resize', () => order.push('regular'))
    stdout.prependOnceListener('resize', () => order.push('prepended-once'))
    stdout.on('drain', drain)

    stdout.emit('resize')
    expect(order).toEqual(['prepended-once', 'regular'])

    stdout.removeAllListeners()
    expect(stdout.eventNames()).toEqual([])
    expect(stdout.listenerCount('resize')).toBe(0)
    expect(terminal.listenerCount('drain')).toBe(0)
    expect(terminal.listenerCount('resize')).toBe(1)

    terminal.emit('drain')
    expect(drain).toHaveBeenCalledTimes(0)

    const afterRemoval = vi.fn()
    stdout.once('resize', afterRemoval)
    stdout.emit('resize')
    expect(afterRemoval).toHaveBeenCalledOnce()

    stdout.dispose()
  })

  it('passes synchronized-update strings to the patched source without buffer conversion', () => {
    const terminal = makeTerminal()
    const filteredWrites: string[] = []
    terminal.write = vi.fn((chunk: unknown) => {
      filteredWrites.push(typeof chunk === 'string' ? stripSyncUpdateEscapes(chunk) : 'unexpected-buffer')
      return true
    }) as typeof terminal.write
    const stdout = createDebouncedResizeStream(terminal, RESIZE_DEBOUNCE_MS)

    stdout.write(`${BSU}terminal-frame${ESU}`)

    expect(filteredWrites).toEqual(['terminal-frame'])
    stdout.dispose()
  })
})
