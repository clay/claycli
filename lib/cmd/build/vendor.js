'use strict';

const path = require('path');
const fs = require('fs-extra');

const CWD = process.cwd();
const DEST = path.join(CWD, 'public', 'js');

const KILN_FILES = [
  'clay-kiln-edit.js',
  'clay-kiln-view.js',
];

/**
 * Copy clay-kiln dist files to public/js/.
 *
 * Copies clay-kiln-edit.js and clay-kiln-view.js from the installed
 * clay-kiln package's dist/ directory to public/js/ so they can be
 * served directly without bundling.
 *
 * @returns {Promise<string[]>} list of destination paths
 */
async function copyVendor() {
  let kilnDist;

  try {
    // resolve from the calling project's node_modules
    kilnDist = path.dirname(require.resolve('clay-kiln/dist/clay-kiln-edit.js'));
  } catch (e) {
    console.warn('[vendor] clay-kiln not found — skipping kiln dist copy:', e.message);
    return [];
  }

  await fs.ensureDir(DEST);

  const results = await Promise.all(
    KILN_FILES.map(async (file) => {
      const src = path.join(kilnDist, file);
      const dest = path.join(DEST, file);

      try {
        await fs.copy(src, dest, { overwrite: true });
        return dest;
      } catch (e) {
        console.warn(`[vendor] Could not copy ${file}: ${e.message}`);
        return null;
      }
    })
  );

  return results.filter(Boolean);
}

module.exports = { copyVendor };
