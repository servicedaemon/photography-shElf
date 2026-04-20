import { _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(__dirname, '..');
export const FIXTURES = path.join(__dirname, 'fixtures');

export async function launchApp({ serverPort = 23714 } = {}) {
  const app = await electron.launch({
    args: [path.join(REPO_ROOT, 'electron', 'main.js')],
    env: {
      ...process.env,
      SHELF_SERVER_PORT: String(serverPort),
    },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

export async function loadFolder(window, folderPath) {
  await window.evaluate((p) => {
    window.dispatchEvent(new CustomEvent('shelf:load-folder', { detail: { path: p } }));
  }, folderPath);
  await window.waitForSelector('.card', { timeout: 10000 });
}
