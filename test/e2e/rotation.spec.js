import { test, expect } from '@playwright/test';
import { launchApp, loadFolder, FIXTURES } from '../helpers.js';
import path from 'path';

test('Option+Right rotates image and fires API call', async () => {
  const { app, window } = await launchApp();
  await loadFolder(window, path.join(FIXTURES, 'unsorted'));

  let rotateCalled = false;
  window.on('request', (req) => {
    if (req.url().includes('/api/rotate') && req.method() === 'POST') {
      rotateCalled = true;
    }
  });

  await window.click('.card[data-index="0"]');
  await window.keyboard.press('Alt+ArrowRight');
  await window.waitForTimeout(700);

  expect(rotateCalled).toBe(true);
  await app.close();
});
