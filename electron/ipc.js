// IPC handlers wired from the preload bridge.

import { ipcMain, dialog, Notification } from 'electron';

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
}
