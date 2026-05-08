<script setup>
import { ref, computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { authToken, authUser, logout } from '../utils/auth'
import { locale, t, toggleLanguage } from '../utils/i18n'
import { weightUnit, toggleWeightUnit } from '../utils/units'
import fitTrackLogo from '../assets/FitTrack Logo/FitTrack Logo.png'

const router = useRouter()
const isMenuOpen = ref(false)

const loggedIn = computed(() => !!authToken.value)
const user = computed(() => authUser.value)

function handleLogout() {
  logout()
  isMenuOpen.value = false
  router.push('/login')
}

function toggleMenu() {
  isMenuOpen.value = !isMenuOpen.value
}

function closeMenu() {
  isMenuOpen.value = false
}

// Global Exercises Icon (New Dumbbell)
const ExercisesIcon = `
  <rect x="2" y="7" width="4" height="10" rx="1"/>
  <rect x="18" y="7" width="4" height="10" rx="1"/>
  <path d="M6 12h12"/>
  <path d="M6 9v6"/>
  <path d="M18 9v6"/>
`
</script>

<template>
  <nav class="ft-nav">
    <div class="page-container">
      <div class="ft-nav-inner">
        <!-- Logo Section -->
        <RouterLink to="/" class="ft-logo-link" @click="closeMenu">
          <img :src="fitTrackLogo" alt="FitTrack" class="ft-logo-img" />
        </RouterLink>

        <!-- Desktop Navigation -->
        <div v-if="loggedIn" class="ft-links desktop-only">
          <RouterLink to="/exercises" class="ft-link">
            <svg class="ft-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="ExercisesIcon"></svg>
            <span>{{ t('nav.exercises') }}</span>
          </RouterLink>
          <RouterLink to="/workouts" class="ft-link">
            <svg class="ft-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>{{ t('nav.workouts') }}</span>
          </RouterLink>
          <RouterLink to="/progress" class="ft-link">
            <svg class="ft-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
              <polyline points="17 6 23 6 23 12"></polyline>
            </svg>
            <span>{{ t('nav.progress') }}</span>
          </RouterLink>
        </div>

        <!-- Action Section -->
        <div class="ft-actions">
          <div class="ft-toggles">
            <button class="ft-toggle-btn" @click="toggleLanguage">{{ locale.toUpperCase() }}</button>
            <button class="ft-toggle-btn" @click="toggleWeightUnit">{{ weightUnit.toUpperCase() }}</button>
          </div>

          <template v-if="loggedIn">
            <div class="ft-user-info">
              <div class="ft-avatar">{{ user?.username?.charAt(0).toUpperCase() }}</div>
              <button class="ft-logout-small desktop-only" @click="handleLogout" title="Logout">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
              </button>
            </div>
            <button class="ft-burger mobile-only" @click="toggleMenu" :class="{ 'active': isMenuOpen }" aria-label="Menu">
              <div class="burger-bar"></div>
              <div class="burger-bar"></div>
              <div class="burger-bar"></div>
            </button>
          </template>

          <template v-else>
            <div class="ft-auth-btns">
              <RouterLink to="/login" class="ft-btn-link">{{ t('nav.login') }}</RouterLink>
              <RouterLink to="/register" class="ft-btn-solid">{{ t('nav.register') }}</RouterLink>
            </div>
          </template>
        </div>
      </div>

      <!-- Mobile Popover Menu -->
      <transition name="pop">
        <div v-if="isMenuOpen && loggedIn" class="ft-popover mobile-only">
          <div class="ft-popover-inner">
            <div class="ft-popover-header">
              <span class="ft-popover-user">{{ user?.username }}</span>
            </div>
            <RouterLink to="/exercises" class="ft-popover-item" @click="closeMenu">
              <svg class="ft-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="ExercisesIcon"></svg>
              <span>{{ t('nav.exercises') }}</span>
            </RouterLink>
            <RouterLink to="/workouts" class="ft-popover-item" @click="closeMenu">
              <svg class="ft-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <span>{{ t('nav.workouts') }}</span>
            </RouterLink>
            <RouterLink to="/progress" class="ft-popover-item" @click="closeMenu">
              <svg class="ft-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                <polyline points="17 6 23 6 23 12"></polyline>
              </svg>
              <span>{{ t('nav.progress') }}</span>
            </RouterLink>
            <div class="ft-divider"></div>
            <button class="ft-popover-item ft-logout-text" @click="handleLogout">
              <svg class="ft-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              <span>{{ t('nav.logout') }}</span>
            </button>
          </div>
        </div>
      </transition>
    </div>
  </nav>
</template>

<style scoped>
.ft-nav {
  position: sticky;
  top: 0;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid #eeeeee;
  height: 64px;
  display: flex;
  align-items: center;
}

.ft-nav-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ft-logo-img {
  height: 32px;
  width: auto;
  display: block;
}

.ft-links {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.ft-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #666666;
  font-weight: 600;
  font-size: 0.9rem;
  transition: color 0.2s ease;
}

.ft-link:hover, .ft-link.router-link-active {
  color: var(--accent);
}

.ft-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.ft-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.ft-toggles {
  display: flex;
  gap: 0.35rem;
}

.ft-toggle-btn {
  font-size: 0.7rem;
  font-weight: 700;
  color: #333;
  background: #f5f5f5;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  transition: background 0.2s;
}

.ft-toggle-btn:hover {
  background: #eeeeee;
}

.ft-user-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ft-avatar {
  width: 26px;
  height: 26px;
  background: var(--accent);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 800;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.ft-logout-small {
  color: #999;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
  display: flex;
}

.ft-logout-small:hover {
  background: #fff0f0;
  color: #ff4444;
}

.ft-logout-small svg {
  width: 16px;
  height: 16px;
}

.ft-auth-btns {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.ft-btn-link {
  font-weight: 700;
  font-size: 0.85rem;
  color: #666;
}

.ft-btn-solid {
  background: var(--accent);
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-weight: 700;
  font-size: 0.85rem;
}

/* Burger Menu */
.ft-burger {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: none;
}

.burger-bar {
  width: 20px;
  height: 2px;
  background: #333;
  border-radius: 1px;
  transition: all 0.2s ease;
}

.ft-burger.active .burger-bar:nth-child(1) { transform: translateY(6px) rotate(45deg); }
.ft-burger.active .burger-bar:nth-child(2) { opacity: 0; }
.ft-burger.active .burger-bar:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }

/* Popover Menu */
.ft-popover {
  position: absolute;
  top: 56px;
  right: 1rem;
  width: 180px;
  background: white;
  border: 1px solid #eeeeee;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.12);
  overflow: hidden;
  z-index: 1001;
}

.ft-popover-inner {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.ft-popover-header {
  padding: 0.75rem 1rem;
  background: #f9f9f9;
  border-bottom: 1px solid #eeeeee;
  width: 100%;
}

.ft-popover-user {
  font-size: 0.8rem;
  font-weight: 700;
  color: #666;
  display: block;
}

.ft-popover-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  color: #444;
  font-weight: 600;
  font-size: 0.9rem;
  transition: all 0.2s;
  width: 100%;
  text-decoration: none;
}

.ft-popover-item:hover {
  background: #f5f5f5;
}

.ft-popover-item.router-link-active {
  color: var(--accent);
  background: var(--accent-soft);
}

.ft-divider {
  height: 1px;
  background: #eeeeee;
  width: 100%;
}

.ft-logout-text {
  color: #ff4444;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
}

/* Responsive */
.desktop-only { display: flex; }
.mobile-only { display: none; }

@media (max-width: 768px) {
  .desktop-only { display: none; }
  .mobile-only { display: flex; }
  
  .ft-nav {
    height: 60px;
  }
}

/* Animation */
.pop-enter-active, .pop-leave-active { transition: all 0.2s ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(-10px) scale(0.95); }
</style>
