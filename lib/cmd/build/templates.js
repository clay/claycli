'use strict';

const path = require('path');
const fs = require('fs-extra');
const { globSync } = require('glob');

const CWD = process.cwd();
const DEST = path.join(CWD, 'public', 'js');

const TEMPLATE_GLOB_PATTERN = 'template.+(hbs|handlebars)';

const BUCKETS = ['a-d', 'e-h', 'i-l', 'm-p', 'q-t', 'u-z'];

/**
 * Determine the alphabetical bucket for a component name.
 * Mirrors the bucket() function in compilation-helpers.js.
 *
 * @param {string} name
 * @returns {string} e.g. 'a-d', 'e-h', ...
 */
function bucket(name) {
  if (/^[a-d]/i.test(name)) return 'a-d';
  if (/^[e-h]/i.test(name)) return 'e-h';
  if (/^[i-l]/i.test(name)) return 'i-l';
  if (/^[m-p]/i.test(name)) return 'm-p';
  if (/^[q-t]/i.test(name)) return 'q-t';
  return 'u-z';
}

/**
 * Replace `{{{ read 'file' }}}` helpers with inlined file contents.
 * Matches the behaviour of compile/templates.js inlineRead().
 *
 * @param {string} source
 * @param {string} filepath
 * @returns {string}
 */
function inlineRead(source, filepath) {
  const matches = source.match(/\{\{\{\s?read\s?'(.*?)'\s?\}\}\}/ig);

  if (!matches) return source;

  let inlined = source;

  for (const match of matches) {
    const filePath = match.match(/'(.*?)'/)[1];

    try {
      const escape = require('escape-quotes');
      const contents = escape(fs.readFileSync(filePath, 'utf8'));

      inlined = inlined.replace(match, contents);
    } catch (e) {
      // Log but do not crash — process.exit(1) would kill the entire watch
      // process for a missing media file. Leave the token unreplaced so the
      // template still compiles; the missing asset will be visible in the browser.
      console.error(`[templates] Error replacing {{{ read '${filePath}' }}} in ${filepath}: ${e.message}`);
    }
  }

  return inlined;
}

/**
 * Compile all Handlebars templates for components and layouts, writing
 * window.kiln.componentTemplates assignments to public/js/.
 *
 * Non-minified: one {name}.template.js per component.
 * Minified: six bucketed _templates-{a-d}.js files.
 *
 * @param {object}   [options]
 * @param {boolean}  [options.minify=false]
 * @param {boolean}  [options.watch=false]      - suppress fatal throw on error in watch mode
 * @param {function} [options.onProgress]       - Called with (doneCount, totalCount) after
 *                                                each template finishes (success or error).
 * @returns {Promise<string[]>} list of output file paths written
 */
async function buildTemplates(options = {}) {
  let clayHbs;

  try {
    clayHbs = require('clayhandlebars');
  } catch (e) {
    console.error('[templates] clayhandlebars is required. Install it: npm install clayhandlebars');
    return [];
  }

  const hbs = clayHbs();
  const minify = options.minify || !!process.env.CLAYCLI_COMPILE_MINIFIED || false;
  const isWatch = options.watch || false;
  const { onProgress } = options;

  const templateFiles = [
    ...globSync(path.join(CWD, 'components', '**', TEMPLATE_GLOB_PATTERN)),
    ...globSync(path.join(CWD, 'layouts', '**', TEMPLATE_GLOB_PATTERN)),
  ];

  if (templateFiles.length === 0) return [];

  await fs.ensureDir(DEST);

  const compiled = [];
  let doneCount = 0;

  for (const srcPath of templateFiles) {
    const name = path.basename(path.dirname(srcPath));

    try {
      let source = await fs.readFile(srcPath, 'utf8');

      // clay-kiln templates are handled differently — skip inline read expansion
      if (!srcPath.includes('clay-kiln')) {
        source = inlineRead(source, srcPath);
      }

      // Wrap as a clay partial before precompiling
      source = clayHbs.wrapPartial(name, source);

      const precompiled = hbs.precompile(source);

      let output = precompiled;

      if (minify) {
        const uglify = require('uglify-js');
        const line = `window.kiln.componentTemplates['${name}']=${precompiled}\n`;
        const result = uglify.minify(line, { output: { inline_script: true } });

        if (result.error) throw result.error;
        output = result.code.slice(0, -1); // strip trailing newline from uglify output
      }

      compiled.push({
        name,
        code: `window.kiln.componentTemplates['${name}']=${output}\n`,
      });
    } catch (e) {
      console.error(`[templates] Error compiling template "${name}": ${e.message}`);
      if (!isWatch) throw e;
    } finally {
      doneCount++;
      if (onProgress) onProgress(doneCount, templateFiles.length);
    }
  }

  if (compiled.length === 0) return [];

  const outputPaths = [];

  if (minify) {
    // Group templates into alphabetical buckets and write one file per bucket
    const bucketMap = Object.fromEntries(BUCKETS.map(b => [b, []]));

    for (const { name, code } of compiled) {
      bucketMap[bucket(name)].push(code);
    }

    for (const b of BUCKETS) {
      if (bucketMap[b].length === 0) continue;
      const destPath = path.join(DEST, `_templates-${b}.js`);

      await fs.writeFile(destPath, bucketMap[b].join(''), 'utf8');
      outputPaths.push(destPath);
    }
  } else {
    // Write each template as its own file
    for (const { name, code } of compiled) {
      const destPath = path.join(DEST, `${name}.template.js`);

      await fs.writeFile(destPath, code, 'utf8');
      outputPaths.push(destPath);
    }
  }

  return outputPaths;
}

module.exports = { buildTemplates, TEMPLATE_GLOB_PATTERN, bucket };
