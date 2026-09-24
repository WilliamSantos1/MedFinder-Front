import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        }
      : {},
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1080 } },
    },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    {
      command: 'node --import tsx server/index.ts',
      url: 'http://127.0.0.1:3001/api/ready',
      timeout: 90000,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'test',
        AI_PROVIDER: 'demo',
        ALLOW_DEMO_DATA: 'true',
        AUTO_SEED: 'true',
        DATABASE_URL: '',
        DATA_DIR: 'memory://',
        CHAT_RATE_LIMIT: '120',
      },
    },
    {
      command: 'npm run dev:web',
      url: 'http://localhost:5173',
      timeout: 30000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
