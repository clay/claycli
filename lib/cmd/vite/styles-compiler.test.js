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

async function compile(css, { minify = true, browsers = ['chrome 89', 'safari 14'], files = {}, config = {}, pipeline = 'postcss' } = {}) {
  const src = path.join(tmpDir, 'styleguides', '_default', 'components', 'test.css');
  const dest = path.join(tmpDir, 'public', 'css', 'test._default.css');

  for (const [file, content] of Object.entries(files)) {
    await fs.outputFile(path.join(tmpDir, 'styleguides', file), content);
  }
  await fs.writeFile(src, css);

  const compiler = createCompiler({
    root: tmpDir,
    config: { pipeline, importPaths: ['./styleguides'], plugins: [], lightningcssOptions: {}, minify, ...config },
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
      pipeline: 'lightningcss',
      importPaths: ['./legacy'],
      tokens: undefined,
      autoprefixerOptions: { overrideBrowserslist: ['> 2%'] },
      browserslist: ['chrome 120'],
      plugins: [plugin],
      lightningcssOptions: { drafts: { customMedia: true } },
      minify: true,
    });
  });

  it('defaults without a config file', () => {
    expect(resolveStylesConfig(getter({}))).toMatchObject({ pipeline: 'lightningcss', importPaths: ['./styleguides'], plugins: [] });
  });
});

describe('getTargetBrowsers', () => {
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
});

describe('createCompiler: postcss pipeline', () => {
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

describe('createCompiler: lightningcss pipeline', () => {
  const lightning = (css, opts = {}) => compile(css, { ...opts, pipeline: 'lightningcss' });

  it('flattens nesting the way postcss-nested did, so rules still merge', async () => {
    const { css } = await lightning([
      '.x { color: red; }',
      '.a { .y { color: red; } margin: 0; &:hover { top: 0; } @media (min-width: 600px) { padding: 0; .z { left: 0; } } bottom: 0; }',
    ].join('\n'));

    expect(css).toBe('.x,.a .y{color:red}.a{margin:0}.a:hover{top:0}@media (min-width:600px){.a{padding:0}.a .z{left:0}}.a{bottom:0}');
  });

  it('repeats the rule for each selector of a comma-list parent', async () => {
    expect((await lightning('.a, .b { & + & { color: red; } .c { top: 0; } }')).css)
      .toBe('.a+.a,.b+.b{color:red}.a .c,.b .c{top:0}');
  });

  it('inlines @imports once, the first time, next to the file or in importPaths', async () => {
    const { css } = await lightning("@import '_default/a.css';\n@import 'shared';\n.own { top: 0; }", {
      files: { '_default/a.css': "@import '_default/shared.css';\n.a { top: 1px; }", '_default/components/shared.css': '.local { top: 2px; }', '_default/shared.css': '.shared { top: 3px; }' },
    });

    expect(css).toBe('.shared{top:3px}.a{top:1px}.local{top:2px}.own{top:0}');
  });

  it('replaces design tokens with their values, references included', async () => {
    await fs.outputJson(path.join(tmpDir, 'styleguides', '_default', 'tokens.json'), {
      color: { black: { $type: 'color', $value: '#000' }, text: { $value: '{color.black}' } },
      font: { serif: { $type: 'fontFamily', $value: ['Miller Text', 'Georgia', 'serif'] } },
    });
    const { css } = await lightning('.a { border: 1px solid var(--color-text); font: 12px var(--font-serif); background: linear-gradient(var(--color-black) 0, transparent 25%); color: var(--color-other, red); }');

    expect(css).toBe('.a{color:var(--color-other,red);background:linear-gradient(#000 0,#0000 25%);border:1px solid #000;font:12px Miller Text,Georgia,serif}');
  });

  it('fills the asset host into url() placeholders', async () => {
    expect((await lightning(".a { background: url('$asset-host/media/x.svg'); } .b { background: url(/media/y.svg); }")).css)
      .toBe('.a{background:url(https://assets.example.com/media/x.svg)}.b{background:url(/media/y.svg)}');
  });

  it('reports invalid CSS as an error at the file and line it came from', async () => {
    const { errors } = await lightning(
      "@import '_default/_broken.css';",
      { files: { '_default/_broken.css': ".a {\n  width: 10px;\n  .b {\n    top: 0;\n    background: url('x('y')');\n    color: red;\n  }\n}" } }
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ file: path.join('styleguides', '_default', '_broken.css'), line: 5, column: 5 });
    expect(errors[0].message).toMatch(/ in `background: url\('x\('y'\)'\)`$/);
  });

  it('refuses PostCSS syntax and says what to do', async () => {
    await expect(lightning('$brand: #00f;\n.a { color: $brand; }')).rejects.toThrow(/uses PostCSS syntax \(`\$brand:`\).*pipeline: 'postcss'/);
    await expect(lightning('.a { @mixin red; }')).rejects.toThrow(/uses PostCSS syntax \(`@mixin`\)/);
  });

  it('refuses an @import with conditions', async () => {
    await expect(lightning("@import 'x.css' screen;", { files: { 'x.css': '' } })).rejects.toThrow(/@import with conditions \(screen\)/);
  });

  it('reads whole numbers past 16 bits back from nested rules', async () => {
    expect((await lightning('.a { .b { text-indent: -99999px; z-index: 2147483647; } }')).css)
      .toBe('.a .b{text-indent:-99999px;z-index:2147483647}');
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
