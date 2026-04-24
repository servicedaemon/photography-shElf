// Spawns the Express server as a child process with a free port.
// Forwards logs and handles lifecycle.
//
// In packaged Electron, the Electron binary is used as the Node interpreter
// (via ELECTRON_RUN_AS_NODE=1). The server script is accessed from the
// asar.unpacked directory because Node's `spawn` can't read JS files from
// inside an asar archive.

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Compute the server entry path, translating asar → asar.unpacked in packaged mode.
function resolveServerEntry() {
  const asarPath = path.join(__dirname, '..', 'server', 'index.js');
  return asarPath.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
}

let serverProcess = null;

export function startServer({ port, distPath }) {
  return new Promise((resolve, reject) => {
    const serverEntry = resolveServerEntry();

    const env = {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      // Make Electron's binary behave like plain Node for the child process.
      ELECTRON_RUN_AS_NODE: '1',
    };
    if (distPath) env.SHELF_DIST_PATH = distPath;

    serverProcess = spawn(process.execPath, [serverEntry], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const onStdout = (data) => {
      const s = data.toString();
      process.stdout.write(`[server] ${s}`);
      if (!resolved && s.includes('Shelf server running')) {
        resolved = true;
        resolve();
      }
    };
    const onStderr = (data) => {
      process.stderr.write(`[server err] ${data.toString()}`);
    };

    serverProcess.stdout.on('data', onStdout);
    serverProcess.stderr.on('data', onStderr);

    serverProcess.on('error', (err) => {
      if (!resolved) reject(err);
    });
    serverProcess.on('exit', (code) => {
      if (!resolved) reject(new Error(`Server exited with code ${code} before ready`));
      serverProcess = null;
    });

    // Safety timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, 5000);
  });
}

export function stopServer() {
  if (serverProcess) {
    const proc = serverProcess;
    serverProcess = null;
    proc.kill('SIGTERM');
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }, 2000);
  }
}
