// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useElapsedTime, formatElapsed } from './useElapsedTime'

describe('formatElapsed', () => {
  it('formats sub-minute as plain seconds', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(45)).toBe('45s')
    expect(formatElapsed(59)).toBe('59s')
  })
  it('formats minutes with zero-padded seconds', () => {
    expect(formatElapsed(60)).toBe('1m 00s')
    expect(formatElapsed(84)).toBe('1m 24s')
    expect(formatElapsed(605)).toBe('10m 05s')
  })
})

describe('useElapsedTime', () => {
  it('returns 0 when inactive', () => {
    const { result } = renderHook(() => useElapsedTime(false))
    expect(result.current).toBe(0)
  })
  it('starts at 0 the moment it becomes active', () => {
    const { result } = renderHook(({ active }) => useElapsedTime(active), { initialProps: { active: true } })
    expect(result.current).toBe(0)
  })
})
