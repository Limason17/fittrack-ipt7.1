import { ref } from 'vue'
import { apiRequest } from './api'
import { getToken, getUser, updateAuthUser } from './auth'

const GUEST_UNIT_KEY = 'fittrack_unit_guest'
const USER_UNIT_PREFIX = 'fittrack_unit_user_'
const KG_TO_LB = 2.20462262

function normalizeUnit(unit) {
    return unit === 'lb' ? 'lb' : 'kg'
}

function userUnitKey(user) {
    return user?.id ? `${USER_UNIT_PREFIX}${user.id}` : GUEST_UNIT_KEY
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

export const weightUnit = ref(initialUnit())

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

export function applyWeightUnitForUser(user) {
    const preferredUnit = normalizeUnit(
        user?.weight_unit || localStorage.getItem(userUnitKey(user)) || weightUnit.value
    )

    return setWeightUnit(preferredUnit, { saveRemote: false })
}

/**
 * Converts a weight from the base unit (kg) to the current display unit.
 */
export function formatWeightValue(kgValue) {
    if (kgValue === null || kgValue === undefined || kgValue === '') return null
    
    const value = Number(kgValue)
    const result = weightUnit.value === 'lb' ? value * KG_TO_LB : value
    return Math.round(result * 10) / 10
}

/**
 * Converts a weight from the current display unit back to the base unit (kg).
 */
export function normalizeWeightValue(displayValue) {
    if (displayValue === null || displayValue === undefined || displayValue === '') return null
    
    const value = Number(displayValue)
    const result = weightUnit.value === 'lb' ? value / KG_TO_LB : value
    return Math.round(result * 10) / 10
}
