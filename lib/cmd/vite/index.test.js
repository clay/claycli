/* eslint-env jest */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// scripts.js imports lib/cmd/build/* modules that were removed when Vite replaced
// the Browserify pipeline.  The `{ virtual: true }` flag tells Jest to create
// these mocks even though no file exists at those paths.
jest.mock('../build/styles',    () => ({ buildStyles: jest.fn(), SRC_GLOBS: [] }),            { virtual: true });
jest.mock('../build/fonts',     () => ({ buildFonts: jest.fn(), FONTS_SRC_GLOB: '' }),        { virtual: true });
jest.mock('../build/templates', () => ({ buildTemplates: jest.fn(), TEMPLATE_GLOB_PATTERN: '' }), { virtual: true });
jest.mock('../build/vendor',    () => ({ copyVendor: jest.fn() }),                            { virtual: true });
jest.mock('../build/media',     () => ({ copyMedia: jest.fn() }),                             { virtual: true });
// Vite itself is mocked to avoid triggering any filesystem/build side effects.
jest.mock('vite', () => ({ build: jest.fn() }));

// ── Manifest key constants (match generate-bootstrap.js / generate-kiln-edit.js) ──

const BOOTSTRAP_KEY  = '.clay/vite-bootstrap';
const NO_MOUNT_KEY   = '.clay/vite-bootstrap-no-mount';
const KILN_EDIT_KEY  = '.clay/vite-kiln-edit-init';

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a temporary project directory with a _manifest.json, temporarily
 * redirect process.cwd() to it, and return a freshly-required index module.
 *
 * The module-level constants in index.js (CWD, DEST, MANIFEST_PATH) are
 * evaluated when the module is first loaded, so we must use jest.resetModules()
 * before each require to ensure they pick up the new cwd.
 *
 * @param {Object} manifestContent
 * @returns {{mod: Object, cleanup: Function}}
 */
function withManifest(manifestContent) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-index-test-'));
  const dest   = path.join(tmpDir, 'public', 'js');

  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, '_manifest.json'), JSON.stringify(manifestContent));

  const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);

  jest.resetModules();

  // Re-apply virtual mocks after resetModules so the new require graph can find them.
  jest.mock('../build/styles',    () => ({ buildStyles: jest.fn(), SRC_GLOBS: [] }),            { virtual: true });
  jest.mock('../build/fonts',     () => ({ buildFonts: jest.fn(), FONTS_SRC_GLOB: '' }),        { virtual: true });
  jest.mock('../build/templates', () => ({ buildTemplates: jest.fn(), TEMPLATE_GLOB_PATTERN: '' }), { virtual: true });
  jest.mock('../build/vendor',    () => ({ copyVendor: jest.fn() }),                            { virtual: true });
  jest.mock('../build/media',     () => ({ copyMedia: jest.fn() }),                             { virtual: true });
  jest.mock('vite',               () => ({ build: jest.fn() }));

  // eslint-disable-next-line global-require
  const mod = require('./index');

  function cleanup() {
    cwdSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  }

  return { mod, cleanup };
}

function withNoManifest() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-no-manifest-'));
  const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);

  jest.resetModules();
  jest.mock('../build/styles',    () => ({ buildStyles: jest.fn(), SRC_GLOBS: [] }),            { virtual: true });
  jest.mock('../build/fonts',     () => ({ buildFonts: jest.fn(), FONTS_SRC_GLOB: '' }),        { virtual: true });
  jest.mock('../build/templates', () => ({ buildTemplates: jest.fn(), TEMPLATE_GLOB_PATTERN: '' }), { virtual: true });
  jest.mock('../build/vendor',    () => ({ copyVendor: jest.fn() }),                            { virtual: true });
  jest.mock('../build/media',     () => ({ copyMedia: jest.fn() }),                             { virtual: true });
  jest.mock('vite',               () => ({ build: jest.fn() }));

  // eslint-disable-next-line global-require
  const mod = require('./index');

  function cleanup() {
    cwdSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  }

  return { mod, cleanup };
}

// ── hasManifest ───────────────────────────────────────────────────────────────

describe('index — hasManifest', () => {
  it('returns false when public/js/_manifest.json does not exist', () => {
    const { mod, cleanup } = withNoManifest();
    const result = mod.hasManifest();

    cleanup();
    expect(result).toBe(false);
  });

  it('returns true when _manifest.json exists', () => {
    const { mod, cleanup } = withManifest({ [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc.js', imports: [] } });
    const result = mod.hasManifest();

    cleanup();
    expect(result).toBe(true);
  });
});

// ── view mode scripts ─────────────────────────────────────────────────────────

describe('index — view mode scripts', () => {
  it('does not populate moduleScripts when there is no manifest', () => {
    const { mod, cleanup } = withNoManifest();
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: false });
    cleanup();

    expect(media.moduleScripts).toBeUndefined();
  });

  it('populates moduleScripts with the bootstrap URL in view mode', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc123.js', imports: [] },
    });
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: false });
    cleanup();

    expect(media.moduleScripts).toContain('/js/bootstrap-abc123.js');
    expect(media.scripts).toEqual([]);
  });

  it('prefixes script URLs with assetPath', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc123.js', imports: [] },
    });
    const media = {};

    mod.resolveModuleScripts(media, 'https://cdn.example.com', { edit: false });
    cleanup();

    expect(media.moduleScripts[0]).toBe('https://cdn.example.com/js/bootstrap-abc123.js');
  });

  it('sets modulePreloads to the same URL as moduleScripts', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc123.js', imports: [] },
    });
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: false });
    cleanup();

    expect(media.modulePreloads).toEqual(media.moduleScripts);
  });
});

// ── edit mode scripts ─────────────────────────────────────────────────────────

describe('index — edit mode scripts', () => {
  it('includes bootstrap first, then kiln edit bundle in edit mode', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc.js',  imports: [] },
      [KILN_EDIT_KEY]: { file: '/js/kiln-edit-xyz.js', imports: ['/js/vue-chunk.js'] },
    });
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: true });
    cleanup();

    expect(media.moduleScripts).toContain('/js/bootstrap-abc.js');
    expect(media.moduleScripts).toContain('/js/kiln-edit-xyz.js');
    expect(media.moduleScripts.indexOf('/js/bootstrap-abc.js'))
      .toBeLessThan(media.moduleScripts.indexOf('/js/kiln-edit-xyz.js'));
  });

  it('still serves view scripts when kiln entry is absent from manifest', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc.js', imports: [] },
    });
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: true });
    cleanup();

    expect(media.moduleScripts).toContain('/js/bootstrap-abc.js');
  });

  it('includes kiln bundle in modulePreloads when preloadEditBundle is true', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc.js',  imports: [] },
      [KILN_EDIT_KEY]: { file: '/js/kiln-edit-xyz.js', imports: ['/js/vue-chunk.js'] },
    });
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: true, preloadEditBundle: true });
    cleanup();

    expect(media.modulePreloads).toContain('/js/kiln-edit-xyz.js');
  });

  it('does not add kiln bundle to preloads when preloadEditBundle is false', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc.js',  imports: [] },
      [KILN_EDIT_KEY]: { file: '/js/kiln-edit-xyz.js', imports: ['/js/vue-chunk.js'] },
    });
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: true, preloadEditBundle: false });
    cleanup();

    expect(media.modulePreloads).not.toContain('/js/kiln-edit-xyz.js');
  });
});

// ── edit-mode component mounting ──────────────────────────────────────────────
//
// The legacy clay compile pipeline resolved component client.js for view mode
// only, so editors never ran component controllers inside Kiln. Edit mode must
// therefore load the no-mount bootstrap, not the mounting one.

describe('index — edit mode component mounting', () => {
  it('serves the no-mount bootstrap in edit mode by default', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc.js',  imports: [] },
      [NO_MOUNT_KEY]:   { file: '/js/no-mount-def.js',  imports: [] },
      [KILN_EDIT_KEY]:  { file: '/js/kiln-edit-xyz.js', imports: [] },
    });
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: true });
    cleanup();

    expect(media.moduleScripts).toContain('/js/no-mount-def.js');
    expect(media.moduleScripts).not.toContain('/js/bootstrap-abc.js');
  });

  it('keeps the no-mount bootstrap ahead of the kiln edit bundle', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc.js',  imports: [] },
      [NO_MOUNT_KEY]:   { file: '/js/no-mount-def.js',  imports: [] },
      [KILN_EDIT_KEY]:  { file: '/js/kiln-edit-xyz.js', imports: [] },
    });
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: true });
    cleanup();

    expect(media.moduleScripts.indexOf('/js/no-mount-def.js'))
      .toBeLessThan(media.moduleScripts.indexOf('/js/kiln-edit-xyz.js'));
  });

  it('serves the mounting bootstrap when mountInEditMode is true', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc.js', imports: [] },
      [NO_MOUNT_KEY]:   { file: '/js/no-mount-def.js', imports: [] },
    });
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: true, mountInEditMode: true });
    cleanup();

    expect(media.moduleScripts).toContain('/js/bootstrap-abc.js');
    expect(media.moduleScripts).not.toContain('/js/no-mount-def.js');
  });

  it('falls back to the mounting bootstrap when the no-mount entry is absent', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc.js', imports: [] },
    });
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: true });
    cleanup();

    // A manifest built by an older claycli has no no-mount entry. Serving no
    // initializers at all would break Kiln, so degrade rather than fail.
    expect(media.moduleScripts).toContain('/js/bootstrap-abc.js');
  });

  it('preloads the edit bootstrap rather than the view bootstrap', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc.js', imports: [] },
      [NO_MOUNT_KEY]:   { file: '/js/no-mount-def.js', imports: [] },
    });
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: true });
    cleanup();

    expect(media.modulePreloads).toEqual(['/js/no-mount-def.js']);
  });

  it('leaves view mode on the mounting bootstrap', () => {
    const { mod, cleanup } = withManifest({
      [BOOTSTRAP_KEY]: { file: '/js/bootstrap-abc.js', imports: [] },
      [NO_MOUNT_KEY]:   { file: '/js/no-mount-def.js', imports: [] },
    });
    const media = {};

    mod.resolveModuleScripts(media, '', { edit: false });
    cleanup();

    expect(media.moduleScripts).toEqual(['/js/bootstrap-abc.js']);
  });
});

// ── exported constants ────────────────────────────────────────────────────────

describe('index — exported constants', () => {
  it('exports VITE_BOOTSTRAP_KEY matching the bootstrap generator', () => {
    const { mod, cleanup } = withNoManifest();

    cleanup();
    expect(mod.VITE_BOOTSTRAP_KEY).toBe(BOOTSTRAP_KEY);
  });

  it('exports KILN_EDIT_ENTRY_KEY matching the kiln-edit generator', () => {
    const { mod, cleanup } = withNoManifest();

    cleanup();
    expect(mod.KILN_EDIT_ENTRY_KEY).toBe(KILN_EDIT_KEY);
  });

  it('exports VITE_BOOTSTRAP_NO_MOUNT_KEY matching the bootstrap generator', () => {
    const { mod, cleanup } = withNoManifest();

    cleanup();
    expect(mod.VITE_BOOTSTRAP_NO_MOUNT_KEY).toBe(NO_MOUNT_KEY);
  });
});
