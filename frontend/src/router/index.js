import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { isLoggedIn } from '../utils/auth'

const routes = [
    {
        path: '/',
        name: 'home',
        component: HomeView,
    },
    {
        path: '/login',
        name: 'login',
        component: () => import('../views/LoginView.vue'),
        meta: { guestOnly: true },
    },
    {
        path: '/register',
        name: 'register',
        component: () => import('../views/RegisterView.vue'),
        meta: { guestOnly: true },
    },
    {
        path: '/exercises',
        name: 'exercises',
        component: () => import('../views/ExercisesView.vue'),
        meta: { requiresAuth: true },
    },
    {
        path: '/workouts',
        name: 'workouts',
        component: () => import('../views/WorkoutsView.vue'),
        meta: { requiresAuth: true },
    },
    {
        path: '/progress',
        name: 'progress',
        component: () => import('../views/ProgressView.vue'),
        meta: { requiresAuth: true },
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

export default router