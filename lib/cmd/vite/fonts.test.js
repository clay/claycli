/* global jest:false */
'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');

let tmpDir;

let originalCwd;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-fonts-'));
  originalCwd = process.cwd;
  process.cwd = () => tmpDir;

  // Create representative font source tree across two styleguides
  const defaultFonts = path.join(tmpDir, 'styleguides', '_default', 'fonts');
  const mobileFonts = path.join(tmpDir, 'styleguides', 'mobile', 'fonts');

  await fs.ensureDir(defaultFonts);
  await fs.ensureDir(mobileFonts);

  await fs.writeFile(
    path.join(defaultFonts, 'fonts.css'),
    '@font-face { src: url($asset-host$asset-path/fonts/Gotham.woff2); }'
  );
  await fs.writeFile(path.join(defaultFonts, 'Gotham.woff2'), 'woff2-binary');
  await fs.writeFile(path.join(defaultFonts, 'Gotham.ttf'), 'ttf-binary');
  await fs.writeFile(
    path.join(mobileFonts, 'fonts.css'),
    '@font-face { src: url($asset-host$asset-path/fonts/Roboto.woff); }'
  );
});

afterEach(async () => {
  process.cwd = originalCwd;
  delete process.env.CLAYCLI_COMPILE_ASSET_HOST;
  delete process.env.CLAYCLI_COMPILE_ASSET_PATH;
  await fs.remove(tmpDir);
  jest.resetModules();
});

describe('buildFonts', () => {
  it('returns 0 when no font files exist', async () => {
    await fs.remove(path.join(tmpDir, 'styleguides'));

    const { buildFonts } = require('./fonts');
    const count = await buildFonts();

    expect(count).toBe(0);
  });

  it('returns total count of all font files processed', async () => {
    const { buildFonts } = require('./fonts');
    const count = await buildFonts();

    // 1 css + 2 binary for _default, 1 css for mobile = 4
    expect(count).toBe(4);
  });

  it('writes _linked-fonts.{sg}.css to public/css/', async () => {
    const { buildFonts } = require('./fonts');

    await buildFonts();

    const defaultOut = path.join(tmpDir, 'public', 'css', '_linked-fonts._default.css');
    const mobileOut = path.join(tmpDir, 'public', 'css', '_linked-fonts.mobile.css');

    expect(fs.existsSync(defaultOut)).toBe(true);
    expect(fs.existsSync(mobileOut)).toBe(true);
  });

  it('copies binary font files to public/fonts/{sg}/', async () => {
    const { buildFonts } = require('./fonts');

    await buildFonts();

    const woff2 = path.join(tmpDir, 'public', 'fonts', '_default', 'Gotham.woff2');
    const ttf = path.join(tmpDir, 'public', 'fonts', '_default', 'Gotham.ttf');

    expect(fs.existsSync(woff2)).toBe(true);
    expect(fs.existsSync(ttf)).toBe(true);
  });

  it('substitutes $asset-host in CSS output', async () => {
    process.env.CLAYCLI_COMPILE_ASSET_HOST = 'https://cdn.example.com';

    const { buildFonts } = require('./fonts');

    await buildFonts();

    const content = await fs.readFile(
      path.join(tmpDir, 'public', 'css', '_linked-fonts._default.css'),
      'utf8'
    );

    expect(content).toContain('https://cdn.example.com');
    expect(content).not.toContain('$asset-host');
  });

  it('substitutes $asset-path in CSS output', async () => {
    process.env.CLAYCLI_COMPILE_ASSET_PATH = '/static/v2';

    const { buildFonts } = require('./fonts');

    await buildFonts();

    const content = await fs.readFile(
      path.join(tmpDir, 'public', 'css', '_linked-fonts._default.css'),
      'utf8'
    );

    expect(content).toContain('/static/v2');
    expect(content).not.toContain('$asset-path');
  });

  it('replaces both $asset-host and $asset-path together', async () => {
    process.env.CLAYCLI_COMPILE_ASSET_HOST = 'https://cdn.example.com';
    process.env.CLAYCLI_COMPILE_ASSET_PATH = '/v3';

    const { buildFonts } = require('./fonts');

    await buildFonts();

    const content = await fs.readFile(
      path.join(tmpDir, 'public', 'css', '_linked-fonts._default.css'),
      'utf8'
    );

    expect(content).toContain('https://cdn.example.com/v3');
    expect(content).not.toContain('$asset-host');
    expect(content).not.toContain('$asset-path');
  });

  it('strips trailing slash from CLAYCLI_COMPILE_ASSET_HOST', async () => {
    process.env.CLAYCLI_COMPILE_ASSET_HOST = 'https://cdn.example.com/';

    const { buildFonts } = require('./fonts');

    await buildFonts();

    const content = await fs.readFile(
      path.join(tmpDir, 'public', 'css', '_linked-fonts._default.css'),
      'utf8'
    );

    expect(content).not.toContain('https://cdn.example.com//');
    expect(content).toContain('https://cdn.example.com');
  });

  it('creates public/css and public/fonts directories if they do not exist', async () => {
    const { buildFonts } = require('./fonts');

    await buildFonts();

    expect(fs.existsSync(path.join(tmpDir, 'public', 'css'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'public', 'fonts'))).toBe(true);
  });

  it('handles styleguides that have only CSS files (no binaries)', async () => {
    const { buildFonts } = require('./fonts');

    // mobile styleguide only has fonts.css, no binary files
    await buildFonts();

    const mobileOut = path.join(tmpDir, 'public', 'css', '_linked-fonts.mobile.css');

    expect(fs.existsSync(mobileOut)).toBe(true);
    // No binary fonts directory created for mobile
    expect(fs.existsSync(path.join(tmpDir, 'public', 'fonts', 'mobile'))).toBe(false);
  });
});
