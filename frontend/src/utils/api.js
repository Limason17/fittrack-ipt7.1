import { logout, safeInternalRedirect } from './auth'

export const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || '/api'

export function joinApiUrl(baseUrl, path) {
    const base = String(baseUrl ?? '').trim()
    const pathPart = String(path ?? '').trim()
    const normalizedBase = base === '/' ? '' : base.replace(/\/+$/, '')
    const normalizedPath = `/${pathPart.replace(/^\/+/, '')}`

    return `${normalizedBase}${normalizedPath}`
}

export function replaceWithLogin(location) {
    if (!location || typeof location.replace !== 'function') return
    const currentPath = `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`
    const redirect = encodeURIComponent(safeInternalRedirect(currentPath))
    location.replace(`/login?redirect=${redirect}`)
}

export async function apiRequest(path, options = {}) {
    const { method = 'GET', body, signal, token } = options
    const headers = {
        Accept: 'application/json',
    }

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
    }

    if (token) {
        headers.Authorization = `Bearer ${token}`
    }

    const response = await fetch(joinApiUrl(API_BASE_URL, path), {
        method,
        headers,
        signal,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const text = await response.text()
    let data = null

    if (text) {
        try {
            data = JSON.parse(text)
        } catch (error) {
            data = { message: text }
        }
    }

    if (!response.ok) {
        if (token && response.status === 401) {
            logout()

            if (typeof window !== 'undefined') replaceWithLogin(window.location)
        }

        const error = new Error(data?.error?.message || data?.message || response.statusText)
        error.status = response.status
        error.data = data
        throw error
    }

    return data
}
