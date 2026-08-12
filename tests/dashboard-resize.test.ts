import { PassThrough } from 'node:stream'

import React, { useEffect } from 'react'
import { render, Text, useWindowSize } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RESIZE_DEBOUNCE_MS, createDebouncedResizeStream } from '../src/dashboard.js'
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

describe('interactive dashboard resize stream', () => {
  afterEach(() => vi.useRealTimers())

  it('lets Ink observe one final resize after a terminal resize burst settles', async () => {
    vi.useFakeTimers()
    const terminal = makeTerminal()
    const stdout = createDebouncedResizeStream(terminal, RESIZE_DEBOUNCE_MS)
    const writes: string[] = []
    terminal.on('data', chunk => writes.push(String(chunk)))
    const renderedSizes: Array<{ columns: number; rows: number }> = []
    const onRender = (size: { columns: number; rows: number }) => renderedSizes.push(size)
    let windowColumns = stdout.columns
    const probe = () => React.createElement(ResizeProbe, { windowColumns, onRender })
    const app = render(probe(), {
      stdout,
      interactive: true,
      patchConsole: false,
    })
    const resize = () => {
      windowColumns = stdout.columns
      app.rerender(probe())
    }
    stdout.prependListener('resize', resize)
    await vi.advanceTimersByTimeAsync(100)
    writes.length = 0
    renderedSizes.length = 0

    terminal.columns = 99
    terminal.emit('resize')
    await vi.advanceTimersByTimeAsync(50)
    terminal.columns = 98
    terminal.emit('resize')
    await vi.advanceTimersByTimeAsync(50)
    terminal.columns = 97
    terminal.rows = 30
    terminal.emit('resize')

    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS - 1)
    expect({ columns: stdout.columns, rows: stdout.rows }).toEqual({ columns: 100, rows: 24 })
    expect(renderedSizes).toEqual([])
    expect(writes).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(100)
    expect({ columns: stdout.columns, rows: stdout.rows }).toEqual({ columns: 97, rows: 30 })
    expect(renderedSizes).toEqual([{ columns: 97, rows: 30 }])
    expect(writes.join('').match(/size:97x30/g)).toHaveLength(1)

    stdout.off('resize', resize)
    app.unmount()
    await vi.runAllTimersAsync()
    await app.waitUntilExit()
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

    terminal.emit('resize')
    terminal.emit('resize')
    terminal.emit('drain')
    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)
    terminal.emit('resize')
    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)

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

    terminal.emit('resize')
    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)
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
    terminal.emit('resize')
    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS)
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
