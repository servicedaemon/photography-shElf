// Electron main process — spawns server, creates window, wires menu + IPC.

import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import getPort from 'get-port';
import { startServer, stopServer } from './server-process.js';
import { loadBounds, saveBounds } from './window-state.js';
import { registerIpc } from './ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow = null;
let serverPort = null;

async function createWindow() {
  if (isDev) {
    // In dev, the existing npm run dev starts Express on env PORT (pm assigns 23714)
    serverPort = parseInt(process.env.SHELF_SERVER_PORT || '23714');
  } else {
    // In packaged mode, pick a free port and spawn the server
    serverPort = await getPort();
    const distPath = path.join(app.getAppPath(), 'dist');
    await startServer({ port: serverPort, distPath });
  }

  const bounds = await loadBounds(serverPort);

  mainWindow = new BrowserWindow({
    ...bounds,
    title: 'Shelf',
    backgroundColor: '#1e1e2e',
    icon: path.join(__dirname, 'icon', 'source.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev, load Vite's URL (5173). In packaged, load the server directly.
  const url = isDev ? 'http://localhost:5173' : `http://localhost:${serverPort}`;
  mainWindow.loadURL(url);

  // External links open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Save bounds on close
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const b = mainWindow.getBounds();
      saveBounds(serverPort, b).catch(() => {});
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  registerIpc(() => mainWindow);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopServer();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  stopServer();
});
