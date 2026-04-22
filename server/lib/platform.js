import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import open from 'open';

const execFileAsync = promisify(execFile);

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

// Bundle IDs for Lightroom variants. Adobe's actual app name is "Adobe
// Lightroom" (the "CC" is only in the containing folder and the bundle ID),
// so passing `-a "Adobe Lightroom CC"` to `open` fails with "Unable to find
// application". Targeting by bundle ID is the reliable path.
//
// Order matters — first match wins. Shelf prefers modern Lightroom (cloud/CC)
// over Classic because the "Edit in Lightroom" handoff is primarily designed
// for the CC workflow. If a user has both installed and wants Classic, set
// Classic as the default handler for the folder in macOS.
const LIGHTROOM_BUNDLE_IDS = [
  'com.adobe.lightroomCC', // Lightroom (modern, "CC"/cloud) — preferred
  'com.adobe.Lightroom7', // Lightroom Classic
];

// Fallback app names if bundle IDs fail (older installs, renamed apps)
const LIGHTROOM_APP_NAMES = ['Adobe Lightroom', 'Adobe Lightroom Classic', 'Lightroom'];

// Open the given folder in Lightroom on macOS, or in the system file manager
// on Windows/Linux (since Lightroom doesn't exist on Linux and the Windows
// Lightroom handoff is less reliable than letting the user drag from Explorer).
// Returns 'lightroom' or 'filemanager' so the caller can phrase the toast.
export async function openFolderInLightroom(folderPath) {
  const resolved = path.resolve(folderPath);

  if (process.platform === 'darwin') {
    // Try each bundle ID, then each app name. First success wins.
    const attempts = [
      ...LIGHTROOM_BUNDLE_IDS.map((id) => ['-b', id, resolved]),
      ...LIGHTROOM_APP_NAMES.map((name) => ['-a', name, resolved]),
    ];

    let lastError = null;
    for (const args of attempts) {
      try {
        await execFileAsync('open', args);
        return 'lightroom';
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error('Lightroom not found');
  }

  // Windows: Explorer. Linux: xdg-open via the `open` package.
  // Neither platform reliably hands a folder to Lightroom, so surface the
  // folder in the file manager and let the user drag from there.
  await open(resolved);
  return 'filemanager';
}
