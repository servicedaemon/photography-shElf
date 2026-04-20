import { test, expect } from '@playwright/test';
import { launchApp } from '../helpers.js';

test('app launches with welcome screen and help button', async () => {
  const { app, window } = await launchApp();
  await expect(window.locator('#app-empty')).toBeVisible();
  await expect(window.locator('h2', { hasText: 'Welcome to Shelf' })).toBeVisible();
  await expect(window.locator('#help-button')).toBeVisible();
  await app.close();
});
