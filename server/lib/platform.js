import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import open from 'open';

const execFileAsync = promisify(execFile);
const VALID_FILENAME = /^[\w][\w. -]*\.(cr3|cr2|arw|nef|raf|dng|jpg|jpeg|tif|tiff)$/i;

// Open native OS folder picker dialog, returns selected path or null
export async function pickFolder() {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Select a photo folder")',
      ]);
      const picked = stdout.trim().replace(/\/$/, '');
      return picked || null;
    } catch {
      // User cancelled the dialog
      return null;
    }
  } else if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('powershell', [
        '-Command',
        `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Select a photo folder'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath } else { '' }`,
      ]);
      const picked = stdout.trim();
      return picked || null;
    } catch {
      return null;
    }
  } else {
    // Linux: try zenity
    try {
      const { stdout } = await execFileAsync('zenity', [
        '--file-selection',
        '--directory',
        '--title=Select a photo folder',
      ]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
}

export async function openFolderInLightroom(folderPath) {
  const resolved = path.resolve(folderPath);

  if (process.platform === 'darwin') {
    await new Promise((resolve, reject) => {
      execFile(
        'open',
        ['-a', 'Adobe Lightroom CC', resolved],
        (err) => (err ? reject(err) : resolve()),
      );
    });
  } else {
    // Windows/Linux: try to open with default app
    await open(resolved);
  }
}
