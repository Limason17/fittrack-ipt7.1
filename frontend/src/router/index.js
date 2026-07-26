import { nextTick } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { ensureAuthBootstrap, isLoggedIn, safeInternalRedirect } from '../utils/auth'
import { t } from '../utils/i18n'
import { hydrateStudioContext, selectStudio } from '../utils/studioContext'

const routes = [
    {
        path: '/',
        name: 'home',
        component: HomeView,
        meta: { personalContext: true, titleKey: 'routing.titles.home' },
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
        meta: { requiresAuth: true, personalContext: true, titleKey: 'routing.titles.exercises' },
    },
    {
        path: '/workouts',
        name: 'workouts',
        component: () => import('../views/WorkoutsView.vue'),
        meta: { requiresAuth: true, personalContext: true, titleKey: 'routing.titles.workouts' },
    },
    {
        path: '/progress',
        name: 'progress',
        component: () => import('../views/ProgressView.vue'),
        meta: { requiresAuth: true, personalContext: true, titleKey: 'routing.titles.progress' },
    },
    {
        path: '/calendar',
        name: 'calendar',
        component: () => import('../views/CalendarView.vue'),
        meta: { requiresAuth: true, personalContext: true, titleKey: 'routing.titles.calendar' },
    },
    {
        path: '/profile',
        name: 'profile',
        component: () => import('../views/ProfileView.vue'),
        meta: { requiresAuth: true, titleKey: 'routing.titles.profile' },
    },
    {
        path: '/studios',
        name: 'studios',
        component: () => import('../views/StudiosView.vue'),
        meta: { requiresAuth: true, titleKey: 'routing.titles.studios' },
    },
    {
        path: '/studios/new',
        name: 'studio-create',
        component: () => import('../views/StudioCreateView.vue'),
        meta: { requiresAuth: true, titleKey: 'routing.titles.studioCreate' },
    },
    {
        path: '/studios/:studioId',
        name: 'studio-dashboard',
        component: () => import('../views/StudioDashboardView.vue'),
        meta: { requiresAuth: true, requiresStudio: true, titleKey: 'routing.titles.studioDashboard' },
    },
    {
        path: '/studios/:studioId/settings',
        name: 'studio-settings',
        component: () => import('../views/StudioSettingsView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            studioRoles: ['owner', 'admin'],
            titleKey: 'routing.titles.studioSettings',
        },
    },
    {
        path: '/studios/:studioId/members',
        name: 'studio-members',
        component: () => import('../views/StudioMembersView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            studioRoles: ['owner', 'admin', 'trainer'],
            titleKey: 'routing.titles.studioMembers',
        },
    },
    {
        path: '/studios/:studioId/invitations',
        name: 'studio-invitations',
        component: () => import('../views/StudioInvitationsView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            studioRoles: ['owner', 'admin'],
            titleKey: 'routing.titles.studioInvitations',
        },
    },
    {
        path: '/studios/:studioId/audit',
        name: 'studio-audit',
        component: () => import('../views/StudioAuditView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            studioRoles: ['owner', 'admin'],
            titleKey: 'routing.titles.studioAudit',
        },
    },
    {
        path: '/studios/:studioId/coaching',
        name: 'studio-coaching',
        component: () => import('../views/CoachingRelationshipsView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            studioRoles: ['owner', 'admin', 'trainer'],
            titleKey: 'routing.titles.studioCoaching',
        },
    },
    {
        path: '/studios/:studioId/training-programs',
        name: 'studio-training-programs',
        component: () => import('../views/TrainingProgramsView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            studioRoles: ['owner', 'admin', 'trainer'],
            titleKey: 'routing.titles.studioTrainingPrograms',
        },
    },
    {
        path: '/studios/:studioId/training-programs/:programId',
        name: 'studio-training-program-detail',
        component: () => import('../views/TrainingProgramBuilderView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            studioRoles: ['owner', 'admin', 'trainer'],
            titleKey: 'routing.titles.studioTrainingProgramDetail',
        },
    },
    {
        path: '/studios/:studioId/assignments',
        name: 'studio-program-assignments',
        component: () => import('../views/ProgramAssignmentsView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            studioRoles: ['owner', 'admin', 'trainer'],
            titleKey: 'routing.titles.studioAssignments',
        },
    },
    {
        path: '/studios/:studioId/program-assignments/:assignmentId/schedule',
        name: 'studio-assignment-schedule',
        component: () => import('../views/ScheduleRulesView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            studioRoles: ['owner', 'admin', 'trainer'],
            titleKey: 'routing.titles.studioAssignmentSchedule',
        },
    },
    {
        path: '/studios/:studioId/my-training-plan',
        name: 'studio-my-training-plan',
        component: () => import('../views/MyTrainingPlanView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            titleKey: 'routing.titles.studioMyTrainingPlan',
        },
    },
    {
        path: '/studios/:studioId/workout-sessions',
        name: 'studio-workout-sessions',
        component: () => import('../views/WorkoutSessionHistoryView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            titleKey: 'routing.titles.studioWorkoutSessions',
        },
    },
    {
        path: '/studios/:studioId/workout-sessions/:sessionId',
        name: 'studio-workout-session-detail',
        component: () => import('../views/WorkoutSessionView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            titleKey: 'routing.titles.studioWorkoutSessionDetail',
        },
    },
    {
        path: '/studios/:studioId/coach-results',
        name: 'studio-coach-results',
        component: () => import('../views/CoachResultsView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            studioRoles: ['owner', 'admin', 'trainer'],
            titleKey: 'routing.titles.studioCoachResults',
        },
    },
    {
        path: '/studios/:studioId/coach-results/:memberMembershipId/sessions/:sessionId',
        name: 'studio-coach-result-session-detail',
        component: () => import('../views/CoachSessionDetailView.vue'),
        meta: {
            requiresAuth: true,
            requiresStudio: true,
            studioRoles: ['owner', 'admin', 'trainer'],
            titleKey: 'routing.titles.studioCoachResultSessionDetail',
        },
    },
    {
        path: '/studios/:studioId/access-denied',
        name: 'studio-access-denied',
        component: () => import('../views/StudioAccessDeniedView.vue'),
        meta: { requiresAuth: true, requiresStudio: true, titleKey: 'routing.titles.accessDenied' },
    },
    {
        path: '/invitations/:token',
        name: 'invitation-accept',
        component: () => import('../views/InvitationAcceptView.vue'),
        meta: {
            requiresAuth: true,
            replaceAuthRedirect: true,
            sensitiveHistory: true,
            titleKey: 'routing.titles.invitationAccept',
        },
    },
    {
        path: '/account/email-change/:token',
        name: 'account-email-change-confirm',
        component: () => import('../views/EmailChangeConfirmView.vue'),
        // Deliberately no requiresAuth: the backend confirmation endpoint is
        // public and token-only (see backend/routes/accountRouter.js) since
        // the link is delivered to the new e-mail address, which may be
        // opened in a browser session that isn't logged into FitTrack at
        // all. sensitiveHistory still applies so the token never lingers in
        // the app shell/sidebar the way an authenticated route's chrome would.
        meta: {
            sensitiveHistory: true,
            titleKey: 'routing.titles.accountEmailChangeConfirm',
        },
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

export async function navigationGuard(to, { studioLoader } = {}) {
    // The access token is memory-only (see utils/auth.js) - a hard reload
    // always starts with authToken.value === null, so the very first
    // navigation decision must wait for the one-time silent-refresh attempt
    // before treating a real returning session as logged out. Subsequent
    // navigations resolve this instantly since ensureAuthBootstrap() is
    // memoized and already settled.
    await ensureAuthBootstrap()
    const loggedIn = isLoggedIn()

    if (to.meta.requiresAuth && !loggedIn) {
        const loginRedirect = {
            path: '/login',
            query: { redirect: safeInternalRedirect(to.fullPath) },
        }
        if (to.meta.replaceAuthRedirect) loginRedirect.replace = true
        return loginRedirect
    }

    if (to.meta.guestOnly && loggedIn) {
        return '/'
    }

    if (to.meta.personalContext) {
        selectStudio(null)
    }

    if (to.meta.requiresAuth && loggedIn) {
        try {
            const hydration = await hydrateStudioContext({
                force: Boolean(to.meta.requiresStudio),
                ...(studioLoader ? { loader: studioLoader } : {}),
            })
            if (hydration?.ignored) return false
        } catch {
            if (to.meta.requiresStudio) return { name: 'studios' }
            return true
        }
    }

    if (to.meta.requiresStudio) {
        const studio = selectStudio(to.params.studioId)
        if (!studio) return { name: 'studios' }
        if (to.meta.studioRoles && !to.meta.studioRoles.includes(studio.membership.role)) {
            return { name: 'studio-access-denied', params: { studioId: studio.id } }
        }
    }
}

router.beforeEach((to) => navigationGuard(to))

router.afterEach(async (to) => {
    document.title = `${t(to.meta.titleKey || 'routing.titles.home')} | FitTrack`
    await nextTick()
    document.getElementById('main-content')?.focus({ preventScroll: true })
})

export default router
