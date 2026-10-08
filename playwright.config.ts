import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:3173'
// Expose only the disposable database path, so browser tests can exercise CLI-created aliases.
const databasePath = process.env.PLAYWRIGHT_DATABASE_PATH ?? `.scratch/e2e-${Date.now()}.db`
process.env.PLAYWRIGHT_DATABASE_PATH = databasePath

/** Run against the compiled application and its real production CSP/API. */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '.scratch/playwright/results',
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: `${baseURL}/api/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '3173',
      PUBLIC_ORIGIN: baseURL,
      COOKIE_SECURE: 'false',
      ALLOW_SIGNUP: 'true',
      DATABASE_PATH: databasePath,
      LOG_LEVEL: 'silent',
    },
  },
})
