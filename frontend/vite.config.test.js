// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import createViteConfig from './vite.config'

function resolveConfig(mode) {
  return createViteConfig({ command: mode === 'production' ? 'build' : 'serve', mode })
}

describe('Vite API configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('proxies the same-origin API path to the local backend in development', () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api')
    vi.stubEnv('API_PROXY_TARGET', 'http://localhost:3001')

    const config = resolveConfig('development')

    expect(config.server.proxy['/api']).toMatchObject({
      target: 'http://localhost:3001',
      changeOrigin: true,
    })
  })

  it('rejects a localhost API URL in production', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3001/api')

    expect(() => resolveConfig('production')).toThrow(
      'VITE_API_BASE_URL must not target localhost in a production build'
    )
  })

  it.each([
    '//localhost:3001/api',
    '//127.0.0.1:3001/api',
    '//[::1]:3001/api',
  ])('rejects the protocol-relative local API URL %s in production', (apiUrl) => {
    vi.stubEnv('VITE_API_BASE_URL', apiUrl)

    expect(() => resolveConfig('production')).toThrow(
      'VITE_API_BASE_URL must not target localhost in a production build'
    )
  })

  it.each([
    'localhost:3001/api',
    'http//localhost:3001/api',
    'http://api.example.test/api',
    'ftp://api.example.test/api',
    '//api.example.test/api',
    '/api?tenant=unexpected',
    '/api#fragment',
  ])('rejects the malformed production API URL %s', (apiUrl) => {
    vi.stubEnv('VITE_API_BASE_URL', apiUrl)

    expect(() => resolveConfig('production')).toThrow(
      'VITE_API_BASE_URL must be a root-relative path or an absolute HTTPS URL'
    )
  })

  it('allows an absolute HTTPS API URL in production', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/api')

    expect(() => resolveConfig('production')).not.toThrow()
  })

  it('allows the same-origin API path in production', () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api')

    expect(resolveConfig('production').server.proxy['/api']).toBeDefined()
  })
})
