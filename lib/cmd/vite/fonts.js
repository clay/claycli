'use strict';

const path = require('path');
const fs = require('fs-extra');
const { globSync } = require('glob');

const CWD = process.cwd();

const FONT_EXTS = 'css,woff,woff2,otf,ttf';
const FONTS_SRC_GLOB = path.join(CWD, 'styleguides', '*', 'fonts', `*.{${FONT_EXTS}}`);

// Output destinations
const CSS_DEST = path.join(CWD, 'public', 'css');
const BINARY_DEST = path.join(CWD, 'public', 'fonts');

const ASSET_HOST = process.env.CLAYCLI_COMPILE_ASSET_HOST
  ? process.env.CLAYCLI_COMPILE_ASSET_HOST.replace(/\/$/, '')
  : '';
const ASSET_PATH = process.env.CLAYCLI_COMPILE_ASSET_PATH || '';

/**
 * Extract the styleguide name from an absolute font file path.
 * Expected structure: .../styleguides/{sg}/fonts/{file}
 *
 * @param {string} srcPath
 * @returns {string} styleguide name
 */
function getStyleguide(srcPath) {
  const parts = srcPath.split(path.sep);
  const sgIdx = parts.lastIndexOf('styleguides');

  return parts[sgIdx + 1];
}

/**
 * Process fonts:
 *   - CSS files: apply $asset-host / $asset-path substitution, then concatenate
 *     all per-styleguide CSS into public/css/_linked-fonts.{sg}.css so that
 *     amphora-html can find and inline the @font-face declarations.
 *   - Binary files (.woff, .woff2, .otf, .ttf): copy as-is to
 *     public/fonts/{styleguide}/ for cases where fonts are self-hosted.
 *
 * @returns {Promise<number>} count of files processed
 */
async function buildFonts() {
  const files = globSync(FONTS_SRC_GLOB);

  if (files.length === 0) return 0;

  // Group by styleguide
  const byStyleguide = {};

  for (const srcPath of files) {
    const sg = getStyleguide(srcPath);

    if (!byStyleguide[sg]) {
      byStyleguide[sg] = { css: [], binary: [] };
    }

    const ext = path.extname(srcPath).toLowerCase();

    if (ext === '.css') {
      byStyleguide[sg].css.push(srcPath);
    } else {
      byStyleguide[sg].binary.push(srcPath);
    }
  }

  await Promise.all([
    fs.ensureDir(CSS_DEST),
    fs.ensureDir(BINARY_DEST),
  ]);

  await Promise.all(Object.entries(byStyleguide).map(async ([sg, { css, binary }]) => {
    // Write _linked-fonts.{sg}.css — amphora-html looks for this file to inject
    // @font-face declarations into every page that uses this styleguide.
    if (css.length > 0) {
      const cssChunks = await Promise.all(css.map(async (srcPath) => {
        let content = await fs.readFile(srcPath, 'utf8');

        content = content.replace(/\$asset-host/g, ASSET_HOST);
        content = content.replace(/\$asset-path/g, ASSET_PATH);

        return content;
      }));

      await fs.writeFile(
        path.join(CSS_DEST, `_linked-fonts.${sg}.css`),
        cssChunks.join('\n'),
        'utf8'
      );
    }

    // Copy binary font files (self-hosted scenarios)
    await Promise.all(binary.map(async (srcPath) => {
      const destPath = path.join(BINARY_DEST, sg, path.basename(srcPath));

      await fs.ensureDir(path.dirname(destPath));
      await fs.copy(srcPath, destPath, { overwrite: true });
    }));
  }));

  return files.length;
}

module.exports = { buildFonts, FONTS_SRC_GLOB };
