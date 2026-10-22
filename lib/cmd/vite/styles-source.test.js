'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { inlineImports, leadingImports, loadTokens, inlineTokens, findUnknownTokens, fillPlaceholders, declarationAt, findPostcssSyntax } = require('./styles-source');

describe('leadingImports', () => {
  it('finds the @imports before the first rule, skipping comments', () => {
    const css = "/* @import 'no.css'; */\n@charset \"utf-8\";\n@import 'a.css';\n@import url(\"b.css\");\n@import url(c.css) print;\n.a { } @import 'late.css';";

    expect(leadingImports(css).map(i => [i.url, i.conditions])).toEqual([['a.css', ''], ['b.css', ''], ['c.css', 'print']]);
  });

  it('takes a last @import with no semicolon', () => {
    expect(leadingImports("@import 'a.css';\n@import 'b.css'").map(i => i.url)).toEqual(['a.css', 'b.css']);
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

  it('keeps @imports of other sites first, strips byte order marks, and rejects unbalanced files', async () => {
    const read = f => fs.readFileSync(f, 'utf8');

    await fs.outputFile(path.join(dir, 'sg/_default/a.css'), '\uFEFF.a {}');
    await fs.outputFile(path.join(dir, 'sg/x/entry.css'), "@import 'https://fonts.example.com/x.css';\n@import '_default/a.css';\n.entry {}");
    const parts = inlineImports(path.join(dir, 'sg/x/entry.css'), { importPaths: [path.join(dir, 'sg')], read });

    expect(parts[0].text).toBe("@import 'https://fonts.example.com/x.css';");
    expect(parts[1].text).toBe('.a {}');

    for (const [css, problem] of [['.a { color: red;\n', 'unclosed `{`'], ['.a {}\n/* note', 'unclosed comment'], [".a { content: 'x }", 'unclosed string'], ['.a {}\n}', 'unexpected `}`']]) {
      await fs.outputFile(path.join(dir, 'sg/_default/p.css'), css);
      await fs.outputFile(path.join(dir, 'sg/x/uses.css'), "@import '_default/p.css';\n.own {}");
      expect(() => inlineImports(path.join(dir, 'sg/x/uses.css'), { importPaths: [path.join(dir, 'sg')], read }))
        .toThrow(new RegExp(`p\\.css:\\d+: ${problem.replace(/[`{}]/g, m => `\\${m}`)}`));
    }
  });

  it('keeps the entry\'s @charset and @layer statements first, with the line numbers it had', async () => {
    await fs.outputFile(path.join(dir, 'sg/_default/a.css'), '.a {}');
    await fs.outputFile(path.join(dir, 'sg/x/entry.css'), "@charset \"utf-8\";\n@layer base, components;\n@import 'https://f.example.com/x.css';\n@import '_default/a.css';\n.entry {}");

    const parts = inlineImports(path.join(dir, 'sg/x/entry.css'), { importPaths: [path.join(dir, 'sg')], read: f => fs.readFileSync(f, 'utf8') });

    expect(parts[0].text).toBe("@charset \"utf-8\";\n@layer base, components;\n@import 'https://f.example.com/x.css';");
    expect(parts[2].text.split('\n')).toHaveLength(5);
    expect(parts[2].text.trim()).toBe('.entry {}');
  });

  it('reads escapes, line continuations and url()s as text when checking brackets', async () => {
    const read = f => fs.readFileSync(f, 'utf8'),
      check = async css => {
        await fs.outputFile(path.join(dir, 'b.css'), css);
        return () => inlineImports(path.join(dir, 'b.css'), { importPaths: [], read });
      };

    for (const css of ['.a { content: "a\\"b{"; }', ".a { content: 'x\\\r\ny{'; }", '.a\\{ { top: 0 }', '.a { background: url(x{.png); }']) {
      expect(await check(css)).not.toThrow();
    }
    expect(await check('@media (min-width: 1px { .a { top: 0 } }')).toThrow(/b\.css:1: unclosed `\(`/);
    expect(await check('.a { width: calc(1px + 2px; }')).toThrow(/b\.css:1: unexpected `}`/);
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

  it('writes cubicBezier tokens and refuses arrays it does not know', async () => {
    await fs.outputJson(path.join(dir, 'a.json'), { easing: { $type: 'cubicBezier', out: { $value: [0, 0, 0.58, 1] } } });
    expect(loadTokens([path.join(dir, 'a.json')]).get('--easing-out')).toBe('cubic-bezier(0, 0, 0.58, 1)');

    await fs.outputJson(path.join(dir, 'b.json'), { shadow: { $type: 'shadow', a: { $value: [1, 2] } } });
    expect(() => loadTokens([path.join(dir, 'b.json')])).toThrow(/design token shadow.a: unsupported \$value/);
  });

  it('quotes font family names, escaping quotes and backslashes', async () => {
    await fs.outputJson(path.join(dir, 'a.json'), { font: { $type: 'fontFamily', a: { $value: ["O'Neil Sans", 'Back\\slash', 'serif'] } } });

    expect(loadTokens([path.join(dir, 'a.json')]).get('--font-a')).toBe("'O\\'Neil Sans', 'Back\\\\slash', serif");
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

describe('findUnknownTokens', () => {
  const tokens = new Map([['--color-black', '#000'], ['--font-serif', 'Georgia, serif']]);

  it('flags a var() a couple of edits from a token, unless the code sets it', () => {
    const found = findUnknownTokens('.a { color: var(--color-blakc); font: var(--font-size-1); top: var(--color-blank); } .b { --color-blank: 0; }', tokens);

    expect(found.map(f => [f.name, f.suggestion])).toEqual([['--color-blakc', '--color-black']]);
  });

  it('counts a swap as one edit, allows two in long names, and stays within the group', () => {
    const long = new Map([...tokens, ['--color-medium-grey', '#999']]),
      found = findUnknownTokens([
        '@property --color-blak { syntax: "<color>"; inherits: true; }',
        '.a { a: var(--color-blak); b: var(--color-balck); c: var(--colr-black); d: var(--font-black);',
        'e: var(--color-medum-gery); f: var(--color-bla); }',
      ].join('\n'), long);

    expect(found.map(f => [f.name, f.suggestion])).toEqual([['--color-balck', '--color-black'], ['--color-medum-gery', '--color-medium-grey']]);
  });
});

describe('fillPlaceholders', () => {
  it('fills $asset-host in urls, image-set strings and $(…) form, not in comments', () => {
    expect(fillPlaceholders(".a { background: url($(asset-host)/x.png); background-image: image-set('$asset-host/y.png' 1x); } /* $asset-host */", { 'asset-host': 'https://h' }))
      .toBe(".a { background: url(https://h/x.png); background-image: image-set('https://h/y.png' 1x); } /* $asset-host */");
  });

  it('fills only the whole placeholder name', () => {
    expect(fillPlaceholders('url($asset-host-x/a) url($asset-hostname) url($(asset-path)/b) url($asset-path/c)', { 'asset-host': 'H', 'asset-path': 'P' }))
      .toBe('url($asset-host-x/a) url($asset-hostname) url(P/b) url(P/c)');
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
    expect(findPostcssSyntax('.a { @at-root .b {} }')).toBe('@at-root');
    expect(findPostcssSyntax(".a { background: url('$asset-host/x.svg'); content: '$x: y'; }")).toBeNull();
  });

  it('spots variables used in values and &-suffix selectors', () => {
    expect(findPostcssSyntax('.a { top: calc(1px * $n); }')).toBe('$n');
    expect(findPostcssSyntax('.a { width: $(gutter); }')).toBe('$(gutter');
    expect(findPostcssSyntax('.a { &-b { top: 0 } }')).toBe('&-b');
    expect(findPostcssSyntax('.a { &.b { top: 0 } background: image-set($asset-host/x.png 1x); }')).toBeNull();
  });
});
