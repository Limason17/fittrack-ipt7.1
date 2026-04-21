import { ref } from 'vue'

const TOKEN_KEY = 'fittrack_token'
const USER_KEY = 'fittrack_user'

const storedUser = localStorage.getItem(USER_KEY)

export const authUser = ref(storedUser ? JSON.parse(storedUser) : null)
export const authToken = ref(localStorage.getItem(TOKEN_KEY))

export function saveAuth(token, user) {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))

    authToken.value = token
    authUser.value = user
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

export function logout() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)

    authToken.value = null
    authUser.value = null
}