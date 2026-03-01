'use strict';

const path = require('path');
const fs = require('fs-extra');
const os = require('os');

// clayhandlebars uses private class fields (#each) which are not supported by
// Jest's default code-transform config.  Mock it with a lightweight stand-in
// that precompiles templates to a simple string representation.
jest.mock('clayhandlebars', () => {
  const wrapPartial = (name, src) => `{{> ${name}}} ${src}`;
  const hbsInstance = {
    precompile: src => JSON.stringify({ compiled: src }),
  };
  const factory = () => hbsInstance;

  factory.wrapPartial = wrapPartial;
  return factory;
});

let tmpDir;
let originalCwd;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-templates-'));
  originalCwd = process.cwd;
  process.cwd = () => tmpDir;

  // Minimal valid Handlebars templates for two components
  await fs.ensureDir(path.join(tmpDir, 'components', 'article'));
  await fs.ensureDir(path.join(tmpDir, 'components', 'paragraph'));

  await fs.writeFile(
    path.join(tmpDir, 'components', 'article', 'template.hbs'),
    '<article><h1>{{title}}</h1></article>'
  );
  await fs.writeFile(
    path.join(tmpDir, 'components', 'paragraph', 'template.hbs'),
    '<p>{{text}}</p>'
  );
});

afterEach(async () => {
  process.cwd = originalCwd;
  await fs.remove(tmpDir);
  jest.resetModules();
});

describe('buildTemplates', () => {
  it('compiles all Handlebars templates to public/js/', async () => {
    const { buildTemplates } = require('./templates');
    const results = await buildTemplates();

    expect(results.length).toBeGreaterThanOrEqual(2);

    const dest = path.join(tmpDir, 'public', 'js');

    expect(fs.existsSync(path.join(dest, 'article.template.js'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'paragraph.template.js'))).toBe(true);
  });

  it('output files contain window.kiln.componentTemplates assignment', async () => {
    const { buildTemplates } = require('./templates');

    await buildTemplates();

    const content = await fs.readFile(
      path.join(tmpDir, 'public', 'js', 'article.template.js'),
      'utf8'
    );

    expect(content).toMatch(/window\.kiln\.componentTemplates\['article'\]/);
  });

  it('returns an empty array when no template files exist', async () => {
    await fs.remove(path.join(tmpDir, 'components'));

    const { buildTemplates } = require('./templates');
    const results = await buildTemplates();

    expect(results).toEqual([]);
  });

  it('calls onProgress with (done, total) after each template', async () => {
    const { buildTemplates } = require('./templates');
    const calls = [];

    await buildTemplates({ onProgress: (done, total) => calls.push({ done, total }) });

    expect(calls.length).toBeGreaterThan(0);

    const last = calls[calls.length - 1];

    expect(last.done).toBe(last.total);
  });

  it('continues compiling valid templates even when one fails in watch mode', async () => {
    // The mocked precompile will throw for any template that starts with 'THROW'
    const { buildTemplates } = require('./templates');

    // Override the mock to throw for the broken template's content
    const clayHbs = require('clayhandlebars');

    const originalPrecompile = clayHbs().precompile;
    const instance = clayHbs();

    instance.precompile = src => {
      if (src.includes('THROW_ERROR')) throw new Error('Simulated compile error');
      return originalPrecompile(src);
    };

    await fs.ensureDir(path.join(tmpDir, 'components', 'broken'));
    await fs.writeFile(
      path.join(tmpDir, 'components', 'broken', 'template.hbs'),
      'THROW_ERROR'
    );

    const errors = [];
    const orig = console.error;

    console.error = msg => errors.push(msg);

    // watch: true suppresses the throw so the rest still compile
    const results = await buildTemplates({ watch: true });

    console.error = orig;

    // The two valid templates (article + paragraph) should still compile
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('groups templates into buckets when minify is true', async () => {
    const { buildTemplates } = require('./templates');
    const results = await buildTemplates({ minify: true });

    // In minified mode output files are named _templates-{bucket}.js
    for (const r of results) {
      expect(path.basename(r)).toMatch(/^_templates-[a-z]-[a-z]\.js$/);
    }
  });

  it('creates public/js directory if it does not exist', async () => {
    const { buildTemplates } = require('./templates');

    await buildTemplates();

    expect(fs.existsSync(path.join(tmpDir, 'public', 'js'))).toBe(true);
  });
});
