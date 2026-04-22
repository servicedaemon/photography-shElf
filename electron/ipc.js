// IPC handlers wired from the preload bridge.

import { ipcMain, dialog, Notification, shell } from 'electron';
import fs from 'fs';

const IMAGE_EXT = /\.(cr3|cr2|arw|nef|raf|dng|jpg|jpeg|tif|tiff)$/i;

export function registerIpc(getMainWindow) {
  ipcMain.handle('shelf:pick-folder', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select a photo folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { path: null, cancelled: true };
    }
    return { path: result.filePaths[0] };
  });

  ipcMain.handle('shelf:notification', async (_evt, { title, body }) => {
    const win = getMainWindow();
    // Only notify when the app is unfocused
    if (win && win.isFocused()) return { shown: false };
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
      return { shown: true };
    }
    return { shown: false };
  });

  ipcMain.handle('shelf:progress', async (_evt, fraction) => {
    const win = getMainWindow();
    if (win) win.setProgressBar(fraction);
    return { ok: true };
  });

  // Move image files to the system trash. Safer than hard-deleting — the user
  // can recover from Trash/Recycle Bin if they regret it.
  //
  // Validation: each path must exist, be a regular file, and end in a known
  // image extension. This prevents a confused caller from trashing a whole
  // directory or an unrelated file.
  ipcMain.handle('shelf:trash-files', async (_evt, paths) => {
    if (!Array.isArray(paths)) return { ok: false, error: 'paths must be an array' };
    let trashed = 0;
    const errors = [];
    for (const p of paths) {
      try {
        if (typeof p !== 'string' || !IMAGE_EXT.test(p)) {
          errors.push({ path: p, error: 'not an image file' });
          continue;
        }
        let stat;
        try { stat = fs.statSync(p); } catch {
          errors.push({ path: p, error: 'not found' });
          continue;
        }
        if (!stat.isFile()) {
          errors.push({ path: p, error: 'not a regular file' });
          continue;
        }
        await shell.trashItem(p);
        trashed++;
      } catch (e) {
        errors.push({ path: p, error: e.message });
      }
    }
    return { ok: true, trashed, errors };
  });
}
