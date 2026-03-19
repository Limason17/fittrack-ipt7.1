import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes:[
        {
            path: '/',
            name: 'home',
            component: HomeView
        },
        {
            path: '/login',
            name: 'login',
            component: () => import('../views/LoginView.vue')
        },
        {
            path: '/register',
            name: 'register',
            component: () => import('../views/RegisterView.vue')
        },
        {
            path: '/exercises',
            name: 'exercises',
            component: () => import('../views/ExercisesView.vue')
        },
        {
            path: '/workouts',
            name: 'workouts',
            component: () => import('../views/WorkoutsView.vue')
        },
        {
            path: '/progress',
            name: 'progress',
            component: () => import('../views/ProgressView.vue')
        }
    ]
})

export default router