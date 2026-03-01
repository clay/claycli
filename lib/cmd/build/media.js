'use strict';

const path = require('path');
const fs = require('fs-extra');
const { globSync } = require('glob');

const CWD = process.cwd();
const DEST = path.join(CWD, 'public', 'media');

// Media file extensions to copy
const MEDIA_PATTERN = '**/*.{jpg,jpeg,png,gif,webp,svg,ico,mp4,webm,pdf}';

const SOURCE_DIRS = [
  { base: 'components', dest: 'components' },
  { base: 'layouts', dest: 'layouts' },
  { base: 'styleguides', dest: 'styleguides' },
];

/**
 * Copy all media files from components/[name]/media/, layouts/[name]/media/,
 * and styleguides/[sg]/media/ to public/media/ preserving sub-path structure.
 *
 * Output mirrors the Browserify compile/media.js output:
 *   components/{name}/media/{file} → public/media/components/{name}/{file}
 *   layouts/{name}/media/{file}    → public/media/layouts/{name}/{file}
 *   styleguides/{sg}/media/{file}  → public/media/styleguides/{sg}/{file}
 *
 * @returns {Promise<number>} total count of files copied
 */
async function copyMedia() {
  await fs.ensureDir(DEST);

  let total = 0;

  for (const { base, dest: destPrefix } of SOURCE_DIRS) {
    const srcBase = path.join(CWD, base);
    const mediaGlob = path.join(srcBase, '**', 'media', MEDIA_PATTERN);
    const files = globSync(mediaGlob, { nodir: true });

    if (files.length === 0) continue;

    await Promise.all(files.map(async (srcPath) => {
      // Compute path relative to the source base so we preserve the sub-path
      const rel = path.relative(srcBase, srcPath);
      // rel: {name}/media/{...file} — strip the 'media/' segment
      const parts = rel.split(path.sep);
      const mediaIdx = parts.indexOf('media');

      if (mediaIdx === -1) return;

      const componentName = parts.slice(0, mediaIdx).join(path.sep);
      const filePart = parts.slice(mediaIdx + 1).join(path.sep);
      const destPath = path.join(DEST, destPrefix, componentName, filePart);

      try {
        await fs.ensureDir(path.dirname(destPath));
        await fs.copy(srcPath, destPath, { overwrite: true });
        total++;
      } catch (e) {
        console.warn(`[media] Could not copy ${path.relative(CWD, srcPath)}: ${e.message}`);
      }
    }));
  }

  return total;
}

module.exports = { copyMedia, SOURCE_DIRS };
