import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRetryCountdown } from './retryCountdown'

describe('createRetryCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts down to zero, one second at a time, and stops itself there', () => {
    const { secondsRemaining, start } = createRetryCountdown()
    start(3)
    expect(secondsRemaining.value).toBe(3)

    vi.advanceTimersByTime(1000)
    expect(secondsRemaining.value).toBe(2)
    vi.advanceTimersByTime(1000)
    expect(secondsRemaining.value).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(secondsRemaining.value).toBe(0)

    // No further decrement below zero once it reaches zero.
    vi.advanceTimersByTime(5000)
    expect(secondsRemaining.value).toBe(0)
  })

  it('rounds a fractional Retry-After up, never down to zero seconds of visible waiting', () => {
    const { secondsRemaining, start } = createRetryCountdown()
    start(1.2)
    expect(secondsRemaining.value).toBe(2)
  })

  it('treats null/undefined/zero/negative as "no wait" without throwing', () => {
    const { secondsRemaining, start } = createRetryCountdown()
    for (const value of [null, undefined, 0, -5, NaN]) {
      start(value)
      expect(secondsRemaining.value).toBe(0)
    }
  })

  it('a second start() call replaces the first, never runs two overlapping intervals', () => {
    const { secondsRemaining, start } = createRetryCountdown()
    start(10)
    vi.advanceTimersByTime(2000)
    expect(secondsRemaining.value).toBe(8)

    start(3)
    expect(secondsRemaining.value).toBe(3)
    vi.advanceTimersByTime(1000)
    expect(secondsRemaining.value).toBe(2)
  })

  it('clear() stops the countdown immediately without resetting the displayed value', () => {
    const { secondsRemaining, start, clear } = createRetryCountdown()
    start(5)
    vi.advanceTimersByTime(1000)
    expect(secondsRemaining.value).toBe(4)
    clear()
    vi.advanceTimersByTime(5000)
    expect(secondsRemaining.value).toBe(4)
  })
})
