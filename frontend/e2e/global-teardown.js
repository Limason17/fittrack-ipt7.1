import { spawnSync } from 'node:child_process'
import { backendDirectory, sharedBackendEnvironment } from '../playwright.config.js'

export default async function globalTeardown() {
  const result = spawnSync(process.execPath, ['scripts/testDbDrop.js'], {
    cwd: backendDirectory,
    env: { ...process.env, ...sharedBackendEnvironment },
    encoding: 'utf8',
    windowsHide: true,
  })

  if (result.status !== 0) {
    throw new Error(`E2E database cleanup failed: ${result.stderr || result.stdout}`)
  }
}
