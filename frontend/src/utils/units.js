import { ref } from 'vue'
import { apiRequest } from './api'
import { getToken, getUser, updateAuthUser } from './auth'
import {
    convertWeightValue,
    normalizeWeightUnit,
    roundCanonicalWeightValue,
} from './measurements'

const GUEST_UNIT_KEY = 'fittrack_unit_guest'
const USER_UNIT_PREFIX = 'fittrack_unit_user_'
const GUEST_DISTANCE_UNIT_KEY = 'fittrack_distance_unit_guest'
const USER_DISTANCE_UNIT_PREFIX = 'fittrack_distance_unit_user_'
const KM_TO_MI = 0.6213711922

function normalizeUnit(unit) {
    return normalizeWeightUnit(unit)
}

function normalizeDistanceUnit(unit) {
    return unit === 'mi' ? 'mi' : 'km'
}

function userUnitKey(user) {
    return user?.id ? `${USER_UNIT_PREFIX}${user.id}` : GUEST_UNIT_KEY
}

function userDistanceUnitKey(user) {
    return user?.id ? `${USER_DISTANCE_UNIT_PREFIX}${user.id}` : GUEST_DISTANCE_UNIT_KEY
}

function initialUnit() {
    const user = getUser()

    if (user?.weight_unit) {
        return normalizeUnit(user.weight_unit)
    }

    const storedUserUnit = user ? localStorage.getItem(userUnitKey(user)) : null
    const storedGuestUnit = localStorage.getItem(GUEST_UNIT_KEY)

    return normalizeUnit(storedUserUnit || storedGuestUnit || 'kg')
}

function initialDistanceUnit() {
    const user = getUser()

    if (user?.distance_unit) {
        return normalizeDistanceUnit(user.distance_unit)
    }

    const storedUserUnit = user ? localStorage.getItem(userDistanceUnitKey(user)) : null
    const storedGuestUnit = localStorage.getItem(GUEST_DISTANCE_UNIT_KEY)

    return normalizeDistanceUnit(storedUserUnit || storedGuestUnit || 'km')
}

export const weightUnit = ref(initialUnit())
export const distanceUnit = ref(initialDistanceUnit())

export async function setWeightUnit(unit, options = {}) {
    const nextUnit = normalizeUnit(unit)
    const { saveRemote = true } = options

    weightUnit.value = nextUnit
    
    const user = getUser()
    localStorage.setItem(userUnitKey(user), nextUnit)
    
    if (!user) {
        localStorage.setItem(GUEST_UNIT_KEY, nextUnit)
    }

    const token = getToken()

    if (user) {
        updateAuthUser({ weight_unit: nextUnit })
    }

    if (saveRemote && user && token) {
        try {
            await apiRequest('/users/weight-unit', {
                method: 'PUT',
                token,
                body: { weight_unit: nextUnit },
            })
        } catch (error) {
            console.warn('Could not save weight unit preference', error)
        }
    }
}

export function toggleWeightUnit() {
    return setWeightUnit(weightUnit.value === 'kg' ? 'lb' : 'kg')
}

export async function setDistanceUnit(unit, options = {}) {
    const nextUnit = normalizeDistanceUnit(unit)
    const { saveRemote = true } = options

    distanceUnit.value = nextUnit

    const user = getUser()
    localStorage.setItem(userDistanceUnitKey(user), nextUnit)

    if (!user) {
        localStorage.setItem(GUEST_DISTANCE_UNIT_KEY, nextUnit)
    }

    const token = getToken()

    if (user) {
        updateAuthUser({ distance_unit: nextUnit })
    }

    if (saveRemote && user && token) {
        try {
            await apiRequest('/users/distance-unit', {
                method: 'PUT',
                token,
                body: { distance_unit: nextUnit },
            })
        } catch (error) {
            console.warn('Could not save distance unit preference', error)
        }
    }
}

export function toggleDistanceUnit() {
    return setDistanceUnit(distanceUnit.value === 'km' ? 'mi' : 'km')
}

export function applyWeightUnitForUser(user) {
    const preferredUnit = normalizeUnit(
        user?.weight_unit || localStorage.getItem(userUnitKey(user)) || weightUnit.value
    )

    return setWeightUnit(preferredUnit, { saveRemote: false })
}

export function applyDistanceUnitForUser(user) {
    const preferredUnit = normalizeDistanceUnit(
        user?.distance_unit ||
            localStorage.getItem(userDistanceUnitKey(user)) ||
            distanceUnit.value
    )

    return setDistanceUnit(preferredUnit, { saveRemote: false })
}

/**
 * Converts a weight from the base unit (kg) to the current display unit.
 */
export function formatWeightValue(kgValue) {
    if (kgValue === null || kgValue === undefined || kgValue === '') return null

    const result = convertWeightValue(kgValue, 'kg', weightUnit.value)
    if (result === null) return null

    return Math.round(result * 10) / 10
}

/**
 * Converts a weight from the current display unit back to the base unit (kg).
 */
export function normalizeWeightValue(displayValue) {
    if (displayValue === null || displayValue === undefined || displayValue === '') return null

    const result = convertWeightValue(displayValue, weightUnit.value, 'kg')
    if (result === null) return null

    return roundCanonicalWeightValue(result)
}

/**
 * Converts a distance from the base unit (km) to the requested display unit.
 */
export function formatDistanceValue(kmValue, unit = distanceUnit.value) {
    if (kmValue === null || kmValue === undefined || kmValue === '') return null

    const value = Number(kmValue)
    if (!Number.isFinite(value)) return null

    const result = normalizeDistanceUnit(unit) === 'mi' ? value * KM_TO_MI : value
    return Math.round(result * 100) / 100
}

/**
 * Converts a distance from the requested display unit back to the base unit (km).
 */
export function normalizeDistanceValue(displayValue, unit = distanceUnit.value) {
    if (displayValue === null || displayValue === undefined || displayValue === '') return null

    const value = Number(displayValue)
    if (!Number.isFinite(value)) return null

    const result = normalizeDistanceUnit(unit) === 'mi' ? value / KM_TO_MI : value
    return Math.round(result * 100) / 100
}

export function formatSpeedValue(kmhValue, unit = distanceUnit.value) {
    if (kmhValue === null || kmhValue === undefined || kmhValue === '') return null

    const value = Number(kmhValue)
    if (!Number.isFinite(value)) return null

    const result = normalizeDistanceUnit(unit) === 'mi' ? value * KM_TO_MI : value
    return Math.round(result * 100) / 100
}
