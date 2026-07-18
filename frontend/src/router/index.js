import { nextTick } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { isLoggedIn } from '../utils/auth'
import { t } from '../utils/i18n'

const routes = [
    {
        path: '/',
        name: 'home',
        component: HomeView,
        meta: { titleKey: 'routing.titles.home' },
    },
    {
        path: '/login',
        name: 'login',
        component: () => import('../views/LoginView.vue'),
        meta: { guestOnly: true, titleKey: 'routing.titles.login' },
    },
    {
        path: '/register',
        name: 'register',
        component: () => import('../views/RegisterView.vue'),
        meta: { guestOnly: true, titleKey: 'routing.titles.register' },
    },
    {
        path: '/exercises',
        name: 'exercises',
        component: () => import('../views/ExercisesView.vue'),
        meta: { requiresAuth: true, titleKey: 'routing.titles.exercises' },
    },
    {
        path: '/workouts',
        name: 'workouts',
        component: () => import('../views/WorkoutsView.vue'),
        meta: { requiresAuth: true, titleKey: 'routing.titles.workouts' },
    },
    {
        path: '/progress',
        name: 'progress',
        component: () => import('../views/ProgressView.vue'),
        meta: { requiresAuth: true, titleKey: 'routing.titles.progress' },
    },
    {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: () => import('../views/NotFoundView.vue'),
        meta: { titleKey: 'routing.titles.notFound' },
    },
]

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
})

router.beforeEach((to) => {
    const loggedIn = isLoggedIn()

    if (to.meta.requiresAuth && !loggedIn) {
        return { path: '/login', query: { redirect: to.fullPath } }
    }

    if (to.meta.guestOnly && loggedIn) {
        return '/'
    }
})

router.afterEach(async (to) => {
    document.title = `${t(to.meta.titleKey || 'routing.titles.home')} | FitTrack`
    await nextTick()
    document.getElementById('main-content')?.focus({ preventScroll: true })
})

export default router
