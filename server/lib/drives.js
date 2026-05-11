import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { findImageFolders } from './image-discovery.js';

const execFileAsync = promisify(execFile);

// Fallback for camera cards that don't follow the strict /DCIM/<subdir>/
// layout — some action cams, drones, or third-party SD card writers use
// other folder names. Returns just the paths of image-bearing directories.
// Pre-v1.5.1 these cards were invisible to Scan-for-Camera.
function findImageDirs(rootPath, maxDepth) {
  return findImageFolders(rootPath, '', maxDepth).map((r) => r.path);
}

export async function detectCameraDrives() {
  const drives = [];

  if (process.platform === 'darwin') {
    // macOS: scan /Volumes/ for dirs containing DCIM/. If a volume has no
    // DCIM at its root, fall back to a shallow scan for any image-bearing
    // subdirectory — covers cards from cameras that don't follow the DCF
    // standard layout (e.g., some drones, action cams, or hand-organized cards).
    const volumesDir = '/Volumes';
    if (fs.existsSync(volumesDir)) {
      const volumes = fs.readdirSync(volumesDir);
      for (const vol of volumes) {
        const volPath = path.join(volumesDir, vol);
        const dcimPath = path.join(volPath, 'DCIM');
        let subDirs = [];
        let dcim = null;
        if (fs.existsSync(dcimPath) && fs.statSync(dcimPath).isDirectory()) {
          // Standard DCF layout — find subdirectories with images
          // (e.g., 100CANON, 101CANON).
          subDirs = fs
            .readdirSync(dcimPath)
            .filter((d) => {
              const fullPath = path.join(dcimPath, d);
              return fs.statSync(fullPath).isDirectory();
            })
            .map((d) => path.join(dcimPath, d));
          dcim = dcimPath;
        } else {
          // No DCIM at root — try a shallow image-folder scan. Skip the
          // system volume (`/`) since that would scan the whole disk.
          if (volPath === '/' || vol === 'Macintosh HD') continue;
          subDirs = findImageDirs(volPath, 3);
          if (subDirs.length === 0) continue;
        }

        drives.push({
          name: vol,
          mountPoint: volPath,
          dcimPath: dcim,
          imageDirs: subDirs,
        });
      }
    }
  } else if (process.platform === 'win32') {
    // Windows: use PowerShell to find removable drives
    try {
      const { stdout } = await execFileAsync('powershell', [
        '-Command',
        'Get-Volume | Where-Object { $_.DriveType -eq "Removable" } | Select-Object -Property DriveLetter,FileSystemLabel | ConvertTo-Json',
      ]);

      let volumes = JSON.parse(stdout || '[]');
      if (!Array.isArray(volumes)) volumes = [volumes];

      for (const vol of volumes) {
        if (!vol.DriveLetter) continue;
        const drivePath = `${vol.DriveLetter}:\\`;
        const dcimPath = path.join(drivePath, 'DCIM');
        let subDirs = [];
        let dcim = null;
        if (fs.existsSync(dcimPath) && fs.statSync(dcimPath).isDirectory()) {
          subDirs = fs
            .readdirSync(dcimPath)
            .filter((d) => fs.statSync(path.join(dcimPath, d)).isDirectory())
            .map((d) => path.join(dcimPath, d));
          dcim = dcimPath;
        } else {
          subDirs = findImageDirs(drivePath, 3);
          if (subDirs.length === 0) continue;
        }

        drives.push({
          name: vol.FileSystemLabel || vol.DriveLetter,
          mountPoint: drivePath,
          dcimPath: dcim,
          imageDirs: subDirs,
        });
      }
    } catch {
      // PowerShell not available or failed
    }
  } else {
    // Linux: scan /media/$USER/ and /mnt/
    const user = process.env.USER || process.env.LOGNAME;
    const searchDirs = ['/mnt'];
    if (user) searchDirs.unshift(`/media/${user}`);

    for (const searchDir of searchDirs) {
      if (!fs.existsSync(searchDir)) continue;
      const entries = fs.readdirSync(searchDir);
      for (const entry of entries) {
        const entryPath = path.join(searchDir, entry);
        const dcimPath = path.join(entryPath, 'DCIM');
        let subDirs = [];
        let dcim = null;
        if (fs.existsSync(dcimPath) && fs.statSync(dcimPath).isDirectory()) {
          subDirs = fs
            .readdirSync(dcimPath)
            .filter((d) => fs.statSync(path.join(dcimPath, d)).isDirectory())
            .map((d) => path.join(dcimPath, d));
          dcim = dcimPath;
        } else {
          subDirs = findImageDirs(entryPath, 3);
          if (subDirs.length === 0) continue;
        }

        drives.push({
          name: entry,
          mountPoint: entryPath,
          dcimPath: dcim,
          imageDirs: subDirs,
        });
      }
    }
  }

  return drives;
}
