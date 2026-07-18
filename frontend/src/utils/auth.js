import { ref } from 'vue'

const TOKEN_KEY = 'fittrack_token'
const USER_KEY = 'fittrack_user'
const cleanupHandlers = new Set()

function readStoredUser() {
    const storedUser = localStorage.getItem(USER_KEY)

    if (!storedUser) {
        return null
    }

    try {
        return JSON.parse(storedUser)
    } catch (error) {
        localStorage.removeItem(USER_KEY)
        return null
    }
}

export const authUser = ref(readStoredUser())
export const authToken = ref(localStorage.getItem(TOKEN_KEY))

export function saveAuth(token, user) {
    runAuthCleanup()
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))

    authToken.value = token
    authUser.value = user
}

export function updateAuthUser(updates) {
    if (!authUser.value) {
        return
    }

    const updatedUser = {
        ...authUser.value,
        ...updates,
    }

    localStorage.setItem(USER_KEY, JSON.stringify(updatedUser))
    authUser.value = updatedUser
}

export function getToken() {
    return authToken.value
}

export function getUser() {
    return authUser.value
}

export function isLoggedIn() {
    return !!authToken.value
}

export function isSafeInternalRedirect(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
        return false
    }

    if (/[\\\u0000-\u001f\u007f]/.test(value)) {
        return false
    }

    try {
        const origin = typeof window === 'undefined' ? 'https://fittrack.invalid' : window.location.origin
        const target = new URL(value, origin)
        return target.origin === origin && target.pathname.startsWith('/')
    } catch {
        return false
    }
}

export function safeInternalRedirect(value, fallback = '/') {
    return isSafeInternalRedirect(value) ? value : fallback
}

export function registerAuthCleanup(handler) {
    if (typeof handler !== 'function') {
        throw new TypeError('Auth cleanup handler must be a function.')
    }
    cleanupHandlers.add(handler)
    return () => cleanupHandlers.delete(handler)
}

function runAuthCleanup() {
    for (const handler of cleanupHandlers) {
        handler()
    }
}

export function logout() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)

    authToken.value = null
    authUser.value = null
    runAuthCleanup()
}
