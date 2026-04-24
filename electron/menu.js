// Native menu with platform-specific branches.

import { Menu, app, dialog } from 'electron';

const isMac = process.platform === 'darwin';

async function openFolder(mainWindow) {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Open Folder',
  });
  if (result.canceled || result.filePaths.length === 0) return;
  mainWindow.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('shelf:load-folder', { detail: { path: ${JSON.stringify(result.filePaths[0])} } }))`,
  );
}

async function fetchRecentShoots(serverPort) {
  try {
    const res = await fetch(`http://localhost:${serverPort}/api/config`);
    const cfg = await res.json();
    return Array.isArray(cfg.recentShoots) ? cfg.recentShoots : [];
  } catch {
    return [];
  }
}

function recentSubmenu(recent, mainWindow) {
  if (recent.length === 0) {
    return [{ label: 'No Recent Shoots', enabled: false }];
  }
  return recent.map((p) => ({
    label: p.split(/[/\\]/).slice(-2).join('/'),
    click: () => {
      mainWindow.webContents.executeJavaScript(
        `window.dispatchEvent(new CustomEvent('shelf:load-folder', { detail: { path: ${JSON.stringify(p)} } }))`,
      );
    },
  }));
}

export async function buildMenu({ mainWindow, isDev, serverPort }) {
  const recent = await fetchRecentShoots(serverPort);

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Shoot',
          accelerator: isMac ? 'Cmd+O' : 'Ctrl+O',
          click: () => openFolder(mainWindow),
        },
        { label: 'Open Recent', submenu: recentSubmenu(recent, mainWindow) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: isMac ? 'Cmd+Z' : 'Ctrl+Z',
          click: () => {
            mainWindow.webContents.executeJavaScript(
              `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, ctrlKey: true, bubbles: true }))`,
            );
          },
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(isDev ? [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'Shift+/',
          click: () => {
            mainWindow.webContents.executeJavaScript(
              `document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`,
            );
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
