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
  CORS_ORIGIN: 'http://127.0.0.1:4173',
  INVITATION_ACCEPT_BASE_URL: 'http://127.0.0.1:4173',
  AUTH_LOGIN_RATE_LIMIT_MAX: '100',
  AUTH_REGISTRATION_RATE_LIMIT_MAX: '100',
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
