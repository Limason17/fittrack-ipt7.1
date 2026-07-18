import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

function targetsLocalMachine(value) {
  const sameOriginPath = value.startsWith('/') && !value.startsWith('//')
  if (sameOriginPath) {
    return false
  }

  let parsed
  try {
    parsed = new URL(value.startsWith('//') ? `https:${value}` : value)
  } catch {
    return false
  }

  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '0.0.0.0' ||
    hostname === '::' ||
    hostname === '::1'
  ) {
    return true
  }

  const ipv4 = hostname.split('.').map(Number)
  return ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part)) && ipv4[0] === 127
}

function isValidProductionApiTarget(value) {
  if (value.startsWith('/') && !value.startsWith('//')) {
    return !/[?#\\]/.test(value)
  }

  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === 'https:' &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    )
  } catch {
    return false
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBaseUrl = env.VITE_API_BASE_URL?.trim() || '/api'
  const apiProxyTarget = env.API_PROXY_TARGET?.trim() || 'http://localhost:3001'

  if (mode === 'production' && targetsLocalMachine(apiBaseUrl)) {
    throw new Error(
      'VITE_API_BASE_URL must not target localhost in a production build. Use /api or a deployed HTTPS API URL.'
    )
  }
  if (mode === 'production' && !isValidProductionApiTarget(apiBaseUrl)) {
    throw new Error(
      'VITE_API_BASE_URL must be a root-relative path or an absolute HTTPS URL in a production build.'
    )
  }

  return {
    plugins: [
      vue(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      },
    },
    server: {
      proxy: apiBaseUrl.startsWith('/')
        ? {
            [apiBaseUrl]: {
              target: apiProxyTarget,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.js', 'vite.config.test.js'],
      restoreMocks: true,
    },
  }
})

export { isValidProductionApiTarget, targetsLocalMachine }
