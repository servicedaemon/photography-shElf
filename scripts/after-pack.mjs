// electron-builder afterPack hook.
//
// After electron-builder assembles the .app bundle but before it wraps it
// in a DMG, we ad-hoc codesign the whole bundle on macOS. Without any
// signature at all, modern macOS (Sequoia+) flags downloaded apps as
// "damaged" — even the right-click-Open workaround doesn't bypass it.
//
// Ad-hoc signing (codesign --sign -) gives the app A signature (though
// not from a registered Apple Developer), which is enough for macOS to
// show the normal "unidentified developer" flow that users can click
// through.

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[after-pack] ad-hoc codesigning ${appPath}`);
  try {
    await execFileAsync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit',
    });
    console.log(`[after-pack] codesign complete`);
  } catch (e) {
    console.warn(`[after-pack] codesign failed (non-fatal):`, e.message);
  }
}
