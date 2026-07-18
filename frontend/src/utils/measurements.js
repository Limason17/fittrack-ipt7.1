export const KG_TO_LB = 2.20462262
export const MAX_EPLEY_REPS = 100
export const WEIGHT_INPUT_DECIMALS = 4
export const CANONICAL_WEIGHT_DECIMALS = 2

export function normalizeWeightUnit(unit) {
    return unit === 'lb' ? 'lb' : 'kg'
}

function finiteNumber(value) {
    if (
        value === null ||
        value === undefined ||
        value === '' ||
        (typeof value === 'string' && value.trim() === '')
    ) {
        return null
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }

    if (typeof value !== 'string') {
        return null
    }

    const normalized = value.trim()
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
        return null
    }

    const number = Number(normalized)
    return Number.isFinite(number) ? number : null
}

export function convertWeightValue(value, fromUnit = 'kg', toUnit = 'kg') {
    const number = finiteNumber(value)

    if (number === null) {
        return null
    }

    const sourceUnit = normalizeWeightUnit(fromUnit)
    const targetUnit = normalizeWeightUnit(toUnit)

    if (sourceUnit === targetUnit) {
        return number
    }

    return sourceUnit === 'kg' ? number * KG_TO_LB : number / KG_TO_LB
}

export function convertWeightInputValue(value, fromUnit, toUnit) {
    if (value === null || value === undefined || value === '') {
        return value
    }

    const convertedValue = convertWeightValue(value, fromUnit, toUnit)
    if (convertedValue === null) {
        return ''
    }

    return Number(convertedValue.toFixed(WEIGHT_INPUT_DECIMALS)).toString()
}

export function roundCanonicalWeightValue(value) {
    const number = finiteNumber(value)
    if (number === null) {
        return null
    }

    const factor = 10 ** CANONICAL_WEIGHT_DECIMALS
    return Math.round((number + Number.EPSILON) * factor) / factor
}

/**
 * Epley estimate: weight × (1 + reps / 30).
 * Values above MAX_EPLEY_REPS are deliberately not estimated because they are
 * outside the useful range of a one-repetition estimate and amplify bad input.
 */
export function estimateOneRepMax(weight, reps) {
    const numericWeight = finiteNumber(weight)
    const numericReps = finiteNumber(reps)

    if (
        numericWeight === null ||
        numericReps === null ||
        numericWeight <= 0 ||
        numericReps <= 0 ||
        numericReps > MAX_EPLEY_REPS
    ) {
        return null
    }

    return numericWeight * (1 + numericReps / 30)
}
