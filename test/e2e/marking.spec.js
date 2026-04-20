import { test, expect } from '@playwright/test';
import { launchApp, loadFolder, FIXTURES } from '../helpers.js';
import path from 'path';

test('P key marks image as keep', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'unsorted'));

  await window.click('.card[data-index="0"]');
  await window.keyboard.press('p');

  await expect(window.locator('.card[data-index="0"] .badge')).toHaveText(/keep/i);
  await app.close();
});

test('F key marks image as favorite', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'unsorted'));

  await window.click('.card[data-index="0"]');
  await window.keyboard.press('f');

  await expect(window.locator('.card[data-index="0"] .badge')).toHaveText(/favorite/i);
  await app.close();
});

test('X key marks image as reject', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'unsorted'));

  await window.click('.card[data-index="0"]');
  await window.keyboard.press('x');

  await expect(window.locator('.card[data-index="0"] .badge')).toHaveText(/reject/i);
  await app.close();
});
