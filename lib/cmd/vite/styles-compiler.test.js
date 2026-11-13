/* global jest:false */
'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const postcss = require('postcss');
const {
  resolveStylesConfig,
  getTargetBrowsers,
  resolveTargets,
  createCompiler,
  findNodeAt,
} = require('./styles-compiler');

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-styles-compiler-'));
  await fs.ensureDir(path.join(tmpDir, 'styleguides', '_default', 'components'));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

function getter(values) {
  return key => values[key];
}

async function compile(css, { minify = true, browsers = ['chrome 89', 'safari 14'], files = {}, config = {} } = {}) {
  const src = path.join(tmpDir, 'styleguides', '_default', 'components', 'test.css');
  const dest = path.join(tmpDir, 'public', 'css', 'test._default.css');

  for (const [file, content] of Object.entries(files)) {
    await fs.outputFile(path.join(tmpDir, 'styleguides', file), content);
  }
  await fs.writeFile(src, css);

  const compiler = createCompiler({
    root: tmpDir,
    config: { importPaths: ['./styleguides'], plugins: [], lightningcssOptions: {}, minify, ...config },
    variables: { 'asset-host': 'https://assets.example.com', 'asset-path': '', minify: '' },
    targets: resolveTargets({ browserslist: browsers }, tmpDir),
  });
  const { errors } = await compiler.compile(src, dest);

  return { css: await fs.readFile(dest, 'utf8'), errors };
}

describe('resolveStylesConfig', () => {
  it('starts from the legacy keys and lets the hook change everything', () => {
    const plugin = { postcssPlugin: 'test' };
    const config = resolveStylesConfig(getter({
      postcssImportPaths: ['./legacy'],
      autoprefixerOptions: { overrideBrowserslist: ['> 2%'] },
      stylesConfig: c => {
        c.plugins.push(plugin);
        c.browserslist = ['chrome 120'];
        c.lightningcssOptions.drafts = { customMedia: true };
      },
    }), { minify: true });

    expect(config).toEqual({
      importPaths: ['./legacy'],
      autoprefixerOptions: { overrideBrowserslist: ['> 2%'] },
      browserslist: ['chrome 120'],
      plugins: [plugin],
      lightningcssOptions: { drafts: { customMedia: true } },
      minify: true,
    });
  });

  it('defaults without a config file', () => {
    expect(resolveStylesConfig(getter({}))).toMatchObject({ importPaths: ['./styleguides'], plugins: [] });
  });
});

describe('getTargetBrowsers', () => {
  const savedEnv = {};

  // The env vars beat every file, so keep a developer's own out of these tests.
  beforeEach(() => {
    for (const key of ['BROWSERSLIST', 'BROWSERSLIST_CONFIG']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('reads the project browserslist from the root', async () => {
    await fs.writeFile(path.join(tmpDir, '.browserslistrc'), 'chrome 100\n');

    expect(getTargetBrowsers({}, tmpDir)).toEqual(['chrome 100']);
  });

  it('does not use autoprefixer overrideBrowserslist as targets', async () => {
    await fs.writeFile(path.join(tmpDir, '.browserslistrc'), 'chrome 100\n');

    expect(getTargetBrowsers({ autoprefixerOptions: { overrideBrowserslist: ['> 2%'] } }, tmpDir)).toEqual(['chrome 100']);
  });

  it('uses the browserslist option in place of the project list', async () => {
    await fs.writeFile(path.join(tmpDir, '.browserslistrc'), 'chrome 100\n');

    expect(getTargetBrowsers({ browserslist: ['safari 15'] }, tmpDir)).toEqual(['safari 15']);
  });

  it('reads the browserslist key of package.json', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), { name: 'x', browserslist: ['safari 15'] });

    expect(getTargetBrowsers({}, tmpDir)).toEqual(['safari 15']);
  });

  it('lets the BROWSERSLIST env var win over the project files', async () => {
    await fs.writeFile(path.join(tmpDir, '.browserslistrc'), 'chrome 100\n');
    process.env.BROWSERSLIST = 'firefox 99';

    expect(getTargetBrowsers({}, tmpDir)).toEqual(['firefox 99']);
  });

  // Browserslist's own default is a usage share (`> 0.5%, last 2 versions, ...`) that moves
  // with its data, and Lightning CSS prints newer syntax once every target supports it.
  it.each([
    ['no config files', () => {}],
    ['a package.json without a browserslist key', () => fs.writeJson(path.join(tmpDir, 'package.json'), { name: 'x' })],
  ])('falls back to a fixed Baseline floor with %s', async (name, setup) => {
    await setup();

    const browsers = getTargetBrowsers({}, tmpDir);
    const browserslist = require('browserslist');

    expect(browsers).toEqual(browserslist('baseline widely available on 2025-05-01'));
    expect(browsers).toEqual(expect.arrayContaining(['chrome 107', 'edge 107', 'firefox 104', 'safari 16.0', 'ios_saf 16.0']));
    expect(browsers).not.toContain('chrome 106');
    expect(browsers).not.toEqual(browserslist('defaults'));
  });
});

describe('createCompiler', () => {
  it('runs import, mixins, simple-vars and nested before Lightning CSS', async () => {
    const { css, errors } = await compile(
      "@import '_default/_vars.css';\n.a { @mixin red; color: $brand; &:hover { background: url($asset-host/x.png); } }",
      { files: { '_default/_vars.css': '$brand: #00f;\n@define-mixin red { border-color: red; }' } }
    );

    expect(css).toBe('.a{color:#00f;border-color:red}.a:hover{background:url(https://assets.example.com/x.png)}');
    expect(errors).toEqual([]);
  });

  it('adds vendor prefixes for the targets', async () => {
    expect((await compile('.a { user-select: none; }', { browsers: ['safari 14'] })).css)
      .toBe('.a{-webkit-user-select:none;user-select:none}');
    expect((await compile('.a { user-select: none; }', { browsers: ['chrome 120'] })).css)
      .toBe('.a{user-select:none}');
  });

  it('keeps unminified output readable', async () => {
    const { css } = await compile('.a{color:red;margin:0}', { minify: false });

    expect(css).toBe('.a {\n  color: red;\n  margin: 0;\n}\n');
  });

  // Lightning CSS prints `font` after everything else in the rule, and `font` resets these properties.
  describe('a font shorthand followed by a property it resets', () => {
    it.each([
      ['font-variation-settings', '"opsz" 60'],
      ['font-feature-settings', '"liga" 0'],
      ['font-variant-numeric', 'tabular-nums'],
      ['font-variant-ligatures', 'none'],
      ['font-kerning', 'none'],
      ['font-optical-sizing', 'none'],
    ])('keeps font before %s', async (prop, value) => {
      const { css, errors } = await compile(`.a { color: red; font: 28px/29px serif; ${prop}: ${value}; grid-area: x; }`);

      expect(css).toBe(`.a{color:red;font:28px/29px serif;${prop}:${value};grid-area:x}`);
      expect(errors).toEqual([]);
    });

    it('keeps font-stretch out of the shorthand, which cannot hold it', async () => {
      const { css } = await compile('.a { font: 12px serif; font-stretch: condensed; }');

      expect(css).toBe('.a{font:12px serif;font-stretch:75%}');
    });

    it('works inside a media query, with !important and without minifying', async () => {
      const important = await compile('@media (min-width: 600px) { .a { font: 12px serif !important; font-variation-settings: normal; } }');
      const pretty = await compile('.a { font: 12px serif; font-feature-settings: "liga" 0; }', { minify: false });

      expect(important.css).toBe('@media (min-width:600px){.a{font-variation-settings:normal;font:12px serif!important}}');
      expect(pretty.css).toBe('.a {\n  font: 12px serif;\n  font-feature-settings: "liga" 0;\n}\n');
    });

    it('still merges the font longhands that follow font, and a font with nothing reset after it', async () => {
      const { css } = await compile('.a { font: 12px serif; font-weight: 700; color: red; } .b { font-variation-settings: normal; font: 12px serif; }');

      expect(css).toBe('.a{color:red;font:700 12px serif}.b{font-variation-settings:normal;font:12px serif}');
    });

    it('never leaves the held name in the output', async () => {
      const { css } = await compile('.a { font: 12px serif; font-kerning: none; } .b { font: 14px serif; font-optical-sizing: none; }');

      expect(css).not.toContain('--claycli-font');
    });
  });

  it('treats the targets as a floor: newer syntax only once every target supports it', async () => {
    const css = '@media (min-width: 600px) { .a { color: red; } }';

    expect((await compile(css, { browsers: ['chrome 107', 'safari 16'] })).css).toBe('@media (min-width:600px){.a{color:red}}');
    expect((await compile(css, { browsers: ['chrome 120', 'safari 17'] })).css).toBe('@media (width>=600px){.a{color:red}}');
  });

  it('reports CSS Lightning CSS cannot parse at its source file and line', async () => {
    const { errors } = await compile(
      "@import '_default/_broken.css';",
      { files: { '_default/_broken.css': ".a {\n  width: 10px;\n  background: url('x('y')');\n  color: red;\n}" } }
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: path.join('styleguides', '_default', '_broken.css'), line: 3, column: 3 });
    expect(errors[0].message).toMatch(/ in `background: url\('x\('y'\)'\)`$/);
  });

  it('runs the plugins and lightningcssOptions from the config', async () => {
    const { css } = await compile('.a { color: red; }', {
      config: {
        plugins: [{ postcssPlugin: 'blue', Declaration: { color: decl => { decl.value = 'blue'; } } }],
        lightningcssOptions: { minify: false },
      },
    });

    expect(css).toBe('.a {\n  color: #00f;\n}\n');
  });

  it('fails a file PostCSS cannot compile', async () => {
    // postcss-import 12 is a PostCSS 7 plugin; PostCSS 8 logs a notice when it throws.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(compile("@import 'missing-file.css';")).rejects.toThrow(/missing-file\.css/);
    spy.mockRestore();
  });
});

describe('findNodeAt', () => {
  it('finds the declaration or rule prelude printed at a line/column', () => {
    const root = postcss.parse('.a {\n  color: red;\n  margin: 0;\n}\n.b{top:0}');

    expect(findNodeAt(root, { line: 2, column: 5 }).prop).toBe('color');
    expect(findNodeAt(root, { line: 3, column: 3 }).prop).toBe('margin');
    expect(findNodeAt(root, { line: 1, column: 1 }).selector).toBe('.a');
    expect(findNodeAt(root, { line: 5, column: 5 }).prop).toBe('top');
    expect(findNodeAt(root, { line: 9, column: 1 })).toBeNull();
  });
});
