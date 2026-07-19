import { computed, ref } from 'vue'

import { getToken, registerAuthCleanup } from './auth'
import { listStudios } from './studioApi'

export const PREFERRED_STUDIO_KEY = 'fittrack_preferred_studio_id'
export const MANAGEMENT_ROLES = Object.freeze(['owner', 'admin'])
export const MEMBERSHIP_VIEW_ROLES = Object.freeze(['owner', 'admin', 'trainer'])
export const TRAINING_MANAGEMENT_ROLES = Object.freeze(['owner', 'admin', 'trainer'])
export const COACHING_MANAGE_ROLES = Object.freeze(['owner', 'admin'])

export const authorizedStudios = ref([])
export const activeStudioId = ref(null)
export const studioContextStatus = ref('idle')
export const studioContextError = ref(null)

let contextGeneration = 0
let currentHydration = null

export const activeStudio = computed(
    () => authorizedStudios.value.find((studio) => studio.id === activeStudioId.value) || null
)
export const activeMembership = computed(() => activeStudio.value?.membership || null)
export const activeStudioRole = computed(() => activeMembership.value?.role || null)
export const isPersonalContext = computed(() => activeStudioId.value === null)
export const canManageActiveStudio = computed(
    () => MANAGEMENT_ROLES.includes(activeStudioRole.value) && activeMembership.value?.status === 'active'
)
export const canViewActiveStudioMembers = computed(
    () => MEMBERSHIP_VIEW_ROLES.includes(activeStudioRole.value) && activeMembership.value?.status === 'active'
)
export const canAccessTrainingManagement = computed(
    () => TRAINING_MANAGEMENT_ROLES.includes(activeStudioRole.value) && activeMembership.value?.status === 'active'
)
export const isStudioMemberRole = computed(
    () => activeStudioRole.value === 'member' && activeMembership.value?.status === 'active'
)

function normalizedStudio(studio) {
    if (!studio || typeof studio !== 'object' || typeof studio.id !== 'string' || !studio.id.trim()) {
        return null
    }
    return { ...studio, id: studio.id.trim() }
}

function usableStudio(studio) {
    return (
        studio?.status === 'active' &&
        studio?.membership?.status === 'active' &&
        typeof studio.membership.role === 'string'
    )
}

function preferredStudioId() {
    const value = localStorage.getItem(PREFERRED_STUDIO_KEY)
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function persistPreferredStudio(studioId) {
    if (studioId) {
        localStorage.setItem(PREFERRED_STUDIO_KEY, studioId)
    } else {
        localStorage.removeItem(PREFERRED_STUDIO_KEY)
    }
}

function chooseAuthorizedStudio(studios, requestedId) {
    if (!requestedId) return null
    return studios.find((studio) => studio.id === requestedId && usableStudio(studio)) || null
}

export function selectStudio(studioId) {
    if (studioId === null || studioId === undefined || studioId === '') {
        activeStudioId.value = null
        persistPreferredStudio(null)
        return null
    }

    const selected = chooseAuthorizedStudio(authorizedStudios.value, String(studioId))
    if (!selected) {
        activeStudioId.value = null
        persistPreferredStudio(null)
        return null
    }

    activeStudioId.value = selected.id
    persistPreferredStudio(selected.id)
    return selected
}

export function clearStudioContext() {
    contextGeneration += 1
    currentHydration = null
    authorizedStudios.value = []
    activeStudioId.value = null
    studioContextStatus.value = 'idle'
    studioContextError.value = null
    persistPreferredStudio(null)
}

export function addAndSelectStudio(studio) {
    const candidate = normalizedStudio(studio)
    if (!candidate || !usableStudio(candidate)) {
        return selectStudio(null)
    }
    authorizedStudios.value = [
        candidate,
        ...authorizedStudios.value.filter((entry) => entry.id !== candidate.id),
    ]
    studioContextStatus.value = 'ready'
    return selectStudio(candidate.id)
}

export function updateAuthorizedStudio(studio) {
    const candidate = normalizedStudio(studio)
    if (!candidate) return null

    const index = authorizedStudios.value.findIndex((entry) => entry.id === candidate.id)
    if (index === -1) return null
    const next = [...authorizedStudios.value]
    next[index] = {
        ...next[index],
        ...candidate,
        membership: candidate.membership || next[index].membership,
    }
    authorizedStudios.value = next
    if (!usableStudio(next[index]) && activeStudioId.value === candidate.id) {
        selectStudio(null)
    }
    return next[index]
}

export async function hydrateStudioContext({ force = false, loader = listStudios } = {}) {
    const token = getToken()
    if (!token) {
        clearStudioContext()
        return { studios: [], activeStudio: null }
    }
    if (!force && currentHydration) return currentHydration
    if (!force && studioContextStatus.value === 'ready') {
        return { studios: authorizedStudios.value, activeStudio: activeStudio.value }
    }

    const generation = ++contextGeneration
    studioContextStatus.value = 'loading'
    studioContextError.value = null
    activeStudioId.value = null

    const hydration = Promise.resolve()
        .then(() => loader({ token }))
        .then((result) => {
            if (generation !== contextGeneration) return { ignored: true }
            const studios = Array.isArray(result?.studios)
                ? result.studios.map(normalizedStudio).filter(Boolean)
                : []
            authorizedStudios.value = studios
            studioContextStatus.value = 'ready'
            const preferred = chooseAuthorizedStudio(studios, preferredStudioId())
            if (preferred) {
                activeStudioId.value = preferred.id
                persistPreferredStudio(preferred.id)
            } else {
                activeStudioId.value = null
                persistPreferredStudio(null)
            }
            return { studios, activeStudio: preferred }
        })
        .catch((error) => {
            if (generation !== contextGeneration) return { ignored: true }
            authorizedStudios.value = []
            activeStudioId.value = null
            persistPreferredStudio(null)
            studioContextStatus.value = 'error'
            studioContextError.value = error
            throw error
        })
        .finally(() => {
            if (generation === contextGeneration) currentHydration = null
        })

    currentHydration = hydration
    return hydration
}

export async function refreshSelectedStudio(studioId, { loader = listStudios } = {}) {
    const hydration = await hydrateStudioContext({ force: true, loader })
    if (hydration?.ignored) return { ignored: true }
    return selectStudio(studioId)
}

registerAuthCleanup(clearStudioContext)
