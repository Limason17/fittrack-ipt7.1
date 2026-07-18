import { describe, expect, it } from 'vitest'

import {
  convertWeightInputValue,
  convertWeightValue,
  estimateOneRepMax,
} from './measurements'

describe('weight measurement conversion', () => {
  it('meets the canonical 100 kg to 220.46 lb to 100 kg acceptance criterion', () => {
    const pounds = convertWeightValue(100, 'kg', 'lb')
    const kilograms = convertWeightValue(pounds, 'lb', 'kg')

    expect(pounds).toBeCloseTo(220.46, 2)
    expect(kilograms).toBeCloseTo(100, 8)
  })

  it('converts open form values between kg and lb without changing their meaning', () => {
    expect(convertWeightInputValue('100', 'kg', 'lb')).toBe('220.4623')
    expect(convertWeightInputValue('220.4623', 'lb', 'kg')).toBe('100')
  })

  it('keeps empty values empty and clears invalid numeric values instead of producing NaN', () => {
    expect(convertWeightInputValue('', 'kg', 'lb')).toBe('')
    expect(convertWeightInputValue(null, 'kg', 'lb')).toBeNull()
    expect(convertWeightInputValue(undefined, 'kg', 'lb')).toBeUndefined()
    expect(convertWeightInputValue('   ', 'kg', 'lb')).toBe('')
    expect(convertWeightInputValue('invalid', 'kg', 'lb')).toBe('')
    expect(convertWeightValue('invalid', 'kg', 'lb')).toBeNull()
  })

  it.each([true, false, [], [100], {}])(
    'rejects coercible non-numeric input %j',
    (value) => {
      expect(convertWeightValue(value, 'kg', 'lb')).toBeNull()
      expect(convertWeightInputValue(value, 'kg', 'lb')).toBe('')
      expect(estimateOneRepMax(value, 10)).toBeNull()
    }
  )

  it('does not accumulate rounding drift across repeated kg/lb roundtrips', () => {
    let value = '137.5'

    for (let index = 0; index < 20; index += 1) {
      value = convertWeightInputValue(value, 'kg', 'lb')
      value = convertWeightInputValue(value, 'lb', 'kg')
    }

    expect(value).toBe('137.5')
  })

  it('preserves a low pound value across repeated open-form roundtrips', () => {
    let value = '1'

    for (let index = 0; index < 20; index += 1) {
      value = convertWeightInputValue(value, 'lb', 'kg')
      value = convertWeightInputValue(value, 'kg', 'lb')
    }

    expect(value).toBe('1')
  })
})

describe('estimated one-repetition maximum', () => {
  it('calculates the Epley estimate in the supplied unit', () => {
    expect(estimateOneRepMax(100, 10)).toBeCloseTo(133.333333, 5)
    expect(estimateOneRepMax(220.462262, 10)).toBeCloseTo(293.949682, 5)
  })

  it('is converted exactly once and survives a kg/lb roundtrip', () => {
    const estimateKg = estimateOneRepMax(100, 10)
    const estimateLb = convertWeightValue(estimateKg, 'kg', 'lb')
    const roundtripKg = convertWeightValue(estimateLb, 'lb', 'kg')

    expect(estimateLb).toBeCloseTo(293.949682, 5)
    expect(roundtripKg).toBeCloseTo(estimateKg, 5)
  })

  it.each([
    [null, 10],
    ['', 10],
    ['invalid', 10],
    [100, null],
    [100, 0],
    [100, -1],
    [100, 101],
    [0, 10],
    [-100, 10],
    [Number.POSITIVE_INFINITY, 10],
  ])('rejects invalid boundary input weight=%s reps=%s', (weight, reps) => {
    expect(estimateOneRepMax(weight, reps)).toBeNull()
  })
})
