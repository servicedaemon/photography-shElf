import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function detectCameraDrives() {
  const drives = [];

  if (process.platform === 'darwin') {
    // macOS: scan /Volumes/ for dirs containing DCIM/
    const volumesDir = '/Volumes';
    if (fs.existsSync(volumesDir)) {
      const volumes = fs.readdirSync(volumesDir);
      for (const vol of volumes) {
        const volPath = path.join(volumesDir, vol);
        const dcimPath = path.join(volPath, 'DCIM');
        if (fs.existsSync(dcimPath) && fs.statSync(dcimPath).isDirectory()) {
          // Find subdirectories with images (e.g., 100CANON, 101CANON)
          const subDirs = fs
            .readdirSync(dcimPath)
            .filter((d) => {
              const fullPath = path.join(dcimPath, d);
              return fs.statSync(fullPath).isDirectory();
            })
            .map((d) => path.join(dcimPath, d));

          drives.push({
            name: vol,
            mountPoint: volPath,
            dcimPath,
            imageDirs: subDirs,
          });
        }
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
        if (fs.existsSync(dcimPath) && fs.statSync(dcimPath).isDirectory()) {
          const subDirs = fs
            .readdirSync(dcimPath)
            .filter((d) => fs.statSync(path.join(dcimPath, d)).isDirectory())
            .map((d) => path.join(dcimPath, d));

          drives.push({
            name: vol.FileSystemLabel || vol.DriveLetter,
            mountPoint: drivePath,
            dcimPath,
            imageDirs: subDirs,
          });
        }
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
        if (fs.existsSync(dcimPath) && fs.statSync(dcimPath).isDirectory()) {
          const subDirs = fs
            .readdirSync(dcimPath)
            .filter((d) => fs.statSync(path.join(dcimPath, d)).isDirectory())
            .map((d) => path.join(dcimPath, d));

          drives.push({
            name: entry,
            mountPoint: entryPath,
            dcimPath,
            imageDirs: subDirs,
          });
        }
      }
    }
  }

  return drives;
}
