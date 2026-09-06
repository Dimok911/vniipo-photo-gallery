import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', reporter: 'list',
  use: { ...devices['iPhone 13 Pro Max'], browserName: 'webkit' },
});
