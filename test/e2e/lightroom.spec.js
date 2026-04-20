import { test, expect } from '@playwright/test';
import { launchApp, loadFolder, FIXTURES } from '../helpers.js';
import path from 'path';

test('Edit in Lightroom button triggers open-in-lightroom API', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'Keeps - 04-2026 - Test', 'Favorites'));

  const button = window.locator('#action-open-editor');
  await expect(button).toBeVisible({ timeout: 5000 });

  const requestPromise = window.waitForRequest(req =>
    req.url().includes('/api/open-in-lightroom') && req.method() === 'POST'
  );

  await button.click();
  const req = await requestPromise;
  const body = req.postDataJSON();
  expect(body.source).toContain('Favorites');

  await app.close();
});
