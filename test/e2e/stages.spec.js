import { test, expect } from '@playwright/test';
import { launchApp, loadFolder, FIXTURES } from '../helpers.js';
import path from 'path';

test('CULL stage detected for unsorted folder', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'unsorted'));
  await expect(window.locator('.stage-pill')).toHaveText(/CULL/);
  await app.close();
});

test('HEROES stage detected for Keeps folder', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'Keeps - 04-2026 - Test'));
  await expect(window.locator('.stage-pill')).toHaveText(/HEROES/);
  await app.close();
});

test('FINAL stage detected for Favorites subfolder', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'Keeps - 04-2026 - Test', 'Favorites'));
  await expect(window.locator('.stage-pill')).toHaveText(/FINAL/);
  await app.close();
});
