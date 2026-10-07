'use strict';

const path = require('path');
const fs = require('fs-extra');
const { globSync } = require('glob');

const CWD = process.cwd();
const DEST = path.join(CWD, 'public', 'media');

// Media file extensions to copy
const MEDIA_PATTERN = '**/*.{jpg,jpeg,png,gif,webp,svg,ico,mp4,webm,pdf}';

// Subsites live in sites/{site}/subsites/{subsite}/. They are copied separately (see copySubsiteMedia),
// so the generic walk of sites/ must skip them.
const SUBSITES_DIR = 'subsites';

const SOURCE_DIRS = [
  { base: 'components', dest: 'components' },
  { base: 'layouts', dest: 'layouts' },
  { base: 'styleguides', dest: 'styleguides' },
  { base: 'sites', dest: 'sites', ignore: [`*/${SUBSITES_DIR}/**`] },
];

const sum = (numbers) => numbers.reduce((total, n) => total + n, 0);

/**
 * Copy one file, creating its directory. A failure is reported but does not stop the build.
 *
 * @param {string} srcPath
 * @param {string} destPath
 * @returns {Promise<number>} 1 if the file was copied, 0 if not
 */
async function copyFile(srcPath, destPath) {
  try {
    await fs.ensureDir(path.dirname(destPath));
    await fs.copy(srcPath, destPath, { overwrite: true });
    return 1;
  } catch (e) {
    console.warn(`[media] Could not copy ${path.relative(CWD, srcPath)}: ${e.message}`);
    return 0;
  }
}

/**
 * Names of the directories directly inside a directory (symlinks to directories included).
 * Anything else (files, a missing directory) is ignored.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listDirs(dir) {
  let names;

  try {
    names = await fs.readdir(dir);
  } catch (e) {
    return [];
  }

  const isDir = await Promise.all(names.map((name) => fs.stat(path.join(dir, name)).then((stat) => stat.isDirectory(), () => false)));

  return names.filter((name, i) => isDir[i]);
}

/**
 * Every media file under a media directory, as [path relative to that directory, absolute path].
 * A missing directory has no files.
 *
 * @param {string} mediaDir
 * @returns {Array<[string, string]>}
 */
function listMedia(mediaDir) {
  return globSync(MEDIA_PATTERN, { cwd: mediaDir, nodir: true }).map((rel) => [rel, path.join(mediaDir, rel)]);
}

/**
 * Copy the media of every subsite, matching `clay compile media`:
 *   sites/{site}/media/{file}                         → public/media/sites/{site}/{subsite}/{file}   (inherited from the parent site)
 *   sites/{site}/subsites/{subsite}/media/{file}      → public/media/sites/{site}/{subsite}/{file}   (overrides a same-named parent file)
 *
 * The subsite's files win over the parent's, and a subsite with no media directory still gets the parent's files.
 * The result is resolved before anything is written, so each destination is written once.
 *
 * @returns {Promise<number>} count of files copied
 */
async function copySubsiteMedia() {
  const sitesDir = path.join(CWD, 'sites');

  let total = 0;

  for (const site of await listDirs(sitesDir)) {
    const parentMedia = path.join(sitesDir, site, 'media');
    const subsitesDir = path.join(sitesDir, site, SUBSITES_DIR);

    for (const subsite of await listDirs(subsitesDir)) {
      const files = new Map([...listMedia(parentMedia), ...listMedia(path.join(subsitesDir, subsite, 'media'))]);
      const destDir = path.join(DEST, 'sites', site, subsite);

      total += sum(await Promise.all([...files].map(([rel, srcPath]) => copyFile(srcPath, path.join(destDir, rel)))));
    }
  }

  return total;
}

/**
 * Copy all media files from components/[name]/media/, layouts/[name]/media/,
 * styleguides/[sg]/media/ and sites/[site]/media/ to public/media/ preserving sub-path structure.
 *
 * Output mirrors the Browserify compile/media.js output:
 *   components/{name}/media/{file} → public/media/components/{name}/{file}
 *   layouts/{name}/media/{file}    → public/media/layouts/{name}/{file}
 *   styleguides/{sg}/media/{file}  → public/media/styleguides/{sg}/{file}
 *   sites/{site}/media/{file}      → public/media/sites/{site}/{file}
 *
 * Subsites (sites/{site}/subsites/{subsite}/) inherit the parent site's media and can override it,
 * and are written to public/media/sites/{site}/{subsite}/ (see copySubsiteMedia).
 *
 * @returns {Promise<number>} total count of files copied
 */
async function copyMedia() {
  await fs.ensureDir(DEST);

  let total = 0;

  for (const { base, dest: destPrefix, ignore = [] } of SOURCE_DIRS) {
    const srcBase = path.join(CWD, base);
    const mediaGlob = path.join(srcBase, '**', 'media', MEDIA_PATTERN);
    const files = globSync(mediaGlob, { nodir: true, ignore: ignore.map((pattern) => path.join(srcBase, pattern)) });

    if (files.length === 0) continue;

    total += sum(await Promise.all(files.map(async (srcPath) => {
      // Compute path relative to the source base so we preserve the sub-path
      const rel = path.relative(srcBase, srcPath);
      // rel: {name}/media/{...file} — strip the 'media/' segment
      const parts = rel.split(path.sep);
      const mediaIdx = parts.indexOf('media');

      if (mediaIdx === -1) return 0;

      const componentName = parts.slice(0, mediaIdx).join(path.sep);
      const filePart = parts.slice(mediaIdx + 1).join(path.sep);

      return copyFile(srcPath, path.join(DEST, destPrefix, componentName, filePart));
    })));
  }

  return total + await copySubsiteMedia();
}

module.exports = { copyMedia, SOURCE_DIRS };
