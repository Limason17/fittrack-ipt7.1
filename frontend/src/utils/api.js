import { logout } from './auth'

export const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api'

export async function apiRequest(path, options = {}) {
    const { method = 'GET', body, token } = options
    const headers = {
        Accept: 'application/json',
    }

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
    }

    if (token) {
        headers.Authorization = `Bearer ${token}`
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers,
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
        if (token && (response.status === 401 || response.status === 403)) {
            logout()

            if (typeof window !== 'undefined') {
                const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search}`)
                window.location.assign(`/login?redirect=${redirect}`)
            }
        }

        const error = new Error(data?.message || response.statusText)
        error.status = response.status
        error.data = data
        throw error
    }

    return data
}
