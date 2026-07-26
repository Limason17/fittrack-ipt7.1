import { ref } from 'vue'

// Shared by every view that shows a 429 rate-limit message with a
// Retry-After countdown (LoginView, RegisterView, ProfileView's account
// security tab, invitation resend). Purely a visual countdown - it never
// re-issues the request itself when it reaches zero, only re-enables
// whatever submit control the caller has disabled while it was running.
// "No aggressive automatic retry" (Section 11) is a property of how callers
// use secondsRemaining (to gate a disabled attribute), not of this helper.
export function createRetryCountdown() {
    const secondsRemaining = ref(0)
    let intervalId = null

    function clear() {
        if (intervalId !== null) {
            clearInterval(intervalId)
            intervalId = null
        }
    }

    function start(seconds) {
        clear()
        const initial = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0
        secondsRemaining.value = initial
        if (initial <= 0) return
        intervalId = setInterval(() => {
            secondsRemaining.value = Math.max(0, secondsRemaining.value - 1)
            if (secondsRemaining.value <= 0) clear()
        }, 1000)
    }

    return { secondsRemaining, start, clear }
}
