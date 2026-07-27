import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const frontendDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = path.resolve(frontendDirectory, '..')
const backendDirectory = path.join(repositoryDirectory, 'backend')
const useSystemChrome = process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === 'true'

const sharedBackendEnvironment = {
  NODE_ENV: 'test',
  PORT: '3201',
  DB_HOST: process.env.DB_HOST || '127.0.0.1',
  DB_PORT: process.env.DB_PORT || '3306',
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || 'root',
  DB_NAME: 'fittrack_e2e_stage1a',
  JWT_SECRET: 'fittrack-stage1a-e2e-secret-with-at-least-32-characters',
  CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
  INVITATION_ACCEPT_BASE_URL: 'http://127.0.0.1:4173',
  // Stage 3D: login is keyed by normalized e-mail + client IP (see
  // rateLimiting/rateLimitPolicies.js), so every OTHER spec file's own
  // unique per-test fixture e-mails keep their own separate budget
  // regardless of this value - only e2e/rateLimitSecurity.spec.js
  // deliberately reuses one fixed e-mail to actually trip this limit and
  // prove the 429 UX and window rollover, which is why this is small and
  // short-lived rather than the real default (10 / 15 min). This is a
  // test-specific policy for the E2E-only backend instance, not a change to
  // the real default used in development/production.
  AUTH_LOGIN_RATE_LIMIT_MAX: '6',
  AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: '8000',
  // IP-keyed with a 60-minute window (see rateLimitPolicies.js) - every spec
  // file in this suite shares one loopback IP and one backend instance for
  // the whole run, and each file registers its own fresh fixture users, so
  // the accumulated total across all ~59 tests in a single run legitimately
  // exceeds the real production default (5/60min) many times over. Sized
  // generously like the other limits below rather than tightly to the
  // current test count, since that count only grows as more E2E coverage is
  // added (this exact ceiling was hit, and raised, once the suite's own
  // registration count grew past 100 - see Stage 5A3's merge-readiness
  // report for the reproduction).
  AUTH_REGISTRATION_RATE_LIMIT_MAX: '1000',
  // Refresh (IP-keyed) and logout-all (user-keyed) had no limiter at all
  // before Stage 3D; every spec file in this suite shares one loopback IP
  // and the cross-tab tests alone repeat-each their reload up to 20 times,
  // so the real default (30/5min) would otherwise be exhausted by this
  // suite's own legitimate traffic, not abuse.
  AUTH_REFRESH_RATE_LIMIT_MAX: '1000',
  AUTH_LOGOUT_ALL_RATE_LIMIT_MAX: '1000',
  INVITATION_CREATE_RATE_LIMIT_MAX: '1000',
  INVITATION_ACCEPT_RATE_LIMIT_MAX: '1000',
  ALLOW_TEST_DB_RESET: 'true',
  // Isolate the E2E backend from any real SMTP configuration a developer
  // may have in their own local backend/.env for manual provider testing:
  // without this, backend/config/db.js's dotenv fallback would fill the
  // gap from that file and silently switch every E2E-created invitation
  // from the expected dev-preview contract to a real SMTP send attempt.
  INVITATION_EMAIL_PROVIDER: '',
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['line']],
  outputDir: 'test-results',
  globalTeardown: './e2e/global-teardown.js',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'de-CH',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: [
    {
      command: 'node scripts/e2eServer.js',
      cwd: backendDirectory,
      env: sharedBackendEnvironment,
      url: 'http://127.0.0.1:3201/api/health/ready',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
      cwd: frontendDirectory,
      env: {
        VITE_API_BASE_URL: '/api',
        API_PROXY_TARGET: 'http://127.0.0.1:3201',
      },
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(useSystemChrome ? { channel: 'chrome' } : {}),
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})

export { backendDirectory, sharedBackendEnvironment }
