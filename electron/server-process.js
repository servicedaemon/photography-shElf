// Spawns the Express server as a child process with a free port.
// Forwards logs and handles lifecycle.

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'index.js');

let serverProcess = null;

export function startServer({ port, distPath }) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
    };
    if (distPath) env.SHELF_DIST_PATH = distPath;

    serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
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
    serverProcess.kill('SIGTERM');
    setTimeout(() => {
      if (serverProcess) serverProcess.kill('SIGKILL');
    }, 2000);
    serverProcess = null;
  }
}
