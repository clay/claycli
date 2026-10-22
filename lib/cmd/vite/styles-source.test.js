'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { inlineImports, leadingImports, loadTokens, inlineTokens, declarationAt, findPostcssSyntax } = require('./styles-source');

describe('leadingImports', () => {
  it('finds the @imports before the first rule, skipping comments', () => {
    const css = "/* @import 'no.css'; */\n@charset \"utf-8\";\n@import 'a.css';\n@import url(\"b.css\");\n@import url(c.css) print;\n.a { } @import 'late.css';";

    expect(leadingImports(css).map(i => [i.url, i.conditions])).toEqual([['a.css', ''], ['b.css', ''], ['c.css', 'print']]);
  });
});

describe('inlineImports', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-styles-source-'));
  });
  afterEach(() => fs.remove(dir));

  it('inlines depth first, once per file, and keeps line numbers', async () => {
    await fs.outputFile(path.join(dir, 'sg/_default/a.css'), "@import '_default/b.css';\n.a {}");
    await fs.outputFile(path.join(dir, 'sg/_default/b.css'), '.b {}');
    await fs.outputFile(path.join(dir, 'sg/x/entry.css'), "@import '_default/a.css';\n@import '_default/b.css';\n.entry {}");

    const parts = inlineImports(path.join(dir, 'sg/x/entry.css'), { importPaths: [path.join(dir, 'sg')], read: f => fs.readFileSync(f, 'utf8') });

    expect(parts.map(p => path.relative(dir, p.file))).toEqual(['sg/_default/b.css', 'sg/_default/a.css', 'sg/x/entry.css']);
    expect(parts[2].text.split('\n')).toHaveLength(3);
    expect(parts[2].text.trim()).toBe('.entry {}');
  });

  it("says which import it can't find", async () => {
    await fs.outputFile(path.join(dir, 'entry.css'), "@import 'nope.css';");

    expect(() => inlineImports(path.join(dir, 'entry.css'), { importPaths: [], read: f => fs.readFileSync(f, 'utf8') }))
      .toThrow(/can't find @import 'nope.css'/);
  });
});

describe('loadTokens', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-tokens-'));
  });
  afterEach(() => fs.remove(dir));

  it('names tokens by their path and resolves references; later files win', async () => {
    await fs.outputJson(path.join(dir, 'a.json'), {
      $description: 'ignored',
      color: { $type: 'color', red: { $value: '#db2800' }, brand: { nymag: { $value: '{color.red}' } } },
      font: { serif: { $value: ['Miller Text', 'Georgia', 'serif'] } },
      size: { gutter: { $value: { value: 20, unit: 'px' } } },
    });
    await fs.outputJson(path.join(dir, 'b.json'), { color: { red: { $value: '#f00' } } });

    expect([...loadTokens([path.join(dir, 'a.json'), path.join(dir, 'b.json')])]).toEqual([
      ['--color-red', '#f00'],
      ['--color-brand-nymag', '#f00'],
      ['--font-serif', "'Miller Text', Georgia, serif"],
      ['--size-gutter', '20px'],
    ]);
  });

  it('reports a reference to a missing token', async () => {
    await fs.outputJson(path.join(dir, 'a.json'), { color: { a: { $value: '{color.b}' } } });

    expect(() => loadTokens([path.join(dir, 'a.json')])).toThrow(/--color-a refers to missing --color-b/);
  });
});

describe('inlineTokens', () => {
  const tokens = new Map([['--color-black', '#000']]);

  it('replaces known tokens without a fallback, outside comments and strings', () => {
    expect(inlineTokens(".a { color: var(--color-black); border: 1px solid var( --color-black ); top: var(--other); left: var(--color-black, red); content: 'var(--color-black)'; } /* var(--color-black) */", tokens))
      .toBe(".a { color: #000; border: 1px solid #000; top: var(--other); left: var(--color-black, red); content: 'var(--color-black)'; } /* var(--color-black) */");
  });
});

describe('declarationAt', () => {
  const css = ".a {\n  color: red;\n  background: url('x;y') no-repeat;\n  .b { top: 0 }\n}";

  it('finds the declaration around a position', () => {
    const at = declarationAt(css, css.indexOf('no-repeat'));

    expect(css.slice(at.start, at.end).trim()).toBe("background: url('x;y') no-repeat;");
    expect(css.slice(...Object.values(declarationAt(css, css.indexOf('top')))).trim()).toBe('top: 0');
  });

  it('returns null for selectors', () => {
    expect(declarationAt(css, css.indexOf('.b'))).toBeNull();
  });
});

describe('findPostcssSyntax', () => {
  it('spots variables and mixins but not $ in strings or urls', () => {
    expect(findPostcssSyntax('$gutter: 10px;')).toBe('$gutter:');
    expect(findPostcssSyntax('.a { @mixin glyph; }')).toBe('@mixin');
    expect(findPostcssSyntax(".a { background: url('$asset-host/x.svg'); content: '$x: y'; }")).toBeNull();
  });
});
