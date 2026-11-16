import { defineConfig, devices } from '@playwright/test';

const DEV_URL = 'http://localhost:5173';
const PREVIEW_URL = 'http://localhost:4173';

// Two kinds of browser tests:
//  - e2e/harness/*.spec.ts exercise the analysis engine through harness.html on the Vite dev server.
//  - e2e/app/*.spec.ts exercise the production build (vite preview), as installed on an iPhone.
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'harness-webkit', testMatch: /harness\/.*\.spec\.ts/, use: { ...devices['Desktop Safari'], baseURL: DEV_URL } },
    { name: 'harness-chromium', testMatch: /harness\/.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: DEV_URL } },
    { name: 'app-webkit-iphone', testMatch: /app\/.*\.spec\.ts/, use: { ...devices['iPhone 15'], baseURL: PREVIEW_URL } },
    { name: 'app-chromium-mobile', testMatch: /app\/.*\.spec\.ts/, use: { ...devices['Pixel 7'], baseURL: PREVIEW_URL } },
  ],
  webServer: [
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: `${DEV_URL}/harness.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: PREVIEW_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
