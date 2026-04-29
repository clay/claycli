/* eslint-env jest */

'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const { createClientEnvCollector, collectDestructuredEnvNames } = require('./client-env');

// ── helpers ───────────────────────────────────────────────────────────────────

let tmpCounter = 0;

function tmpOutputPath() {
  tmpCounter++;
  return path.join(os.tmpdir(), `client-env-test-${tmpCounter}.json`);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ── createClientEnvCollector ──────────────────────────────────────────────────

describe('createClientEnvCollector', () => {
  it('returns plugin() and write() functions', () => {
    const collector = createClientEnvCollector(tmpOutputPath());

    expect(typeof collector.plugin).toBe('function');
    expect(typeof collector.write).toBe('function');
  });

  it('plugin() returns a Rollup plugin with name and transform', () => {
    const collector = createClientEnvCollector(tmpOutputPath());
    const p = collector.plugin();

    expect(p.name).toBe('clay-client-env');
    expect(typeof p.transform).toBe('function');
  });

  it('transform returns null (no source transformation)', () => {
    const collector = createClientEnvCollector(tmpOutputPath());
    const p = collector.plugin();
    const result = p.transform('const x = process.env.FOO;');

    expect(result).toBeNull();
  });

  it('transform collects a single env var reference', () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    p.transform('const x = process.env.MY_VAR;');
    return collector.write().then(result => {
      expect(result).toEqual(['MY_VAR']);
    });
  });

  it('write() writes a sorted JSON array to disk', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    p.transform('const a = process.env.ZEBRA; const b = process.env.ALPHA;');
    await collector.write();

    expect(readJson(out)).toEqual(['ALPHA', 'ZEBRA']);
  });

  it('write() deduplicates vars seen multiple times', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    p.transform('const a = process.env.FOO; const b = process.env.FOO;');
    await collector.write();

    expect(readJson(out)).toEqual(['FOO']);
  });

  it('collects from multiple transform calls', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    p.transform('const a = process.env.SENTRY_DSN;');
    p.transform('const b = process.env.GA_TRACKING_ID;');
    await collector.write();

    expect(readJson(out)).toEqual(['GA_TRACKING_ID', 'SENTRY_DSN']);
  });

  it('two plugin instances from the same collector share the Set', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const view = collector.plugin();
    const kiln = collector.plugin();

    view.transform('const a = process.env.RECAPTCHA_SITE_KEY;');
    kiln.transform('const b = process.env.CORAL_HOST_URL;');
    await collector.write();

    expect(readJson(out)).toEqual(['CORAL_HOST_URL', 'RECAPTCHA_SITE_KEY']);
  });

  it('does not collect process.env references without uppercase var name', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    // lowercase / mixed-case identifiers do not match the [A-Z_][A-Z0-9_]* pattern
    p.transform("process.env.lowercase; process.env['quoted'];");
    await collector.write();

    expect(readJson(out)).toEqual([]);
  });

  it('write() returns the sorted list of vars', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    p.transform('process.env.B_VAR; process.env.A_VAR;');

    const result = await collector.write();

    expect(result).toEqual(['A_VAR', 'B_VAR']);
  });

  it('write() produces an empty array when no vars were seen', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);

    await collector.write();

    expect(readJson(out)).toEqual([]);
  });

  it('handles code with no process.env references', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    p.transform('const x = 1 + 2; function foo() { return x; }');
    await collector.write();

    expect(readJson(out)).toEqual([]);
  });

  it('multiple write() calls produce consistent output', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    p.transform('process.env.STABLE_VAR;');
    await collector.write();
    await collector.write();

    expect(readJson(out)).toEqual(['STABLE_VAR']);
  });

  it('accumulates across write() calls (Set is never cleared)', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    p.transform('process.env.FIRST;');
    await collector.write();

    p.transform('process.env.SECOND;');
    await collector.write();

    // Both vars present because the Set is append-only
    expect(readJson(out)).toEqual(['FIRST', 'SECOND']);
  });

  it('collectors are independent — separate instances do not share vars', async () => {
    const out1 = tmpOutputPath();
    const out2 = tmpOutputPath();
    const c1 = createClientEnvCollector(out1);
    const c2 = createClientEnvCollector(out2);

    c1.plugin().transform('process.env.ONLY_IN_C1;');
    c2.plugin().transform('process.env.ONLY_IN_C2;');

    await c1.write();
    await c2.write();

    expect(readJson(out1)).toEqual(['ONLY_IN_C1']);
    expect(readJson(out2)).toEqual(['ONLY_IN_C2']);
  });

  it('handles multiline code with multiple vars', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    p.transform([
      'const dsn = process.env.SENTRY_DSN;',
      'const env = process.env.NODE_ENV;',
      'const key = process.env.GOOGLE_PLACES_API_KEY;',
    ].join('\n'));
    await collector.write();

    expect(readJson(out)).toEqual(['GOOGLE_PLACES_API_KEY', 'NODE_ENV', 'SENTRY_DSN']);
  });

  it('collects vars from process.env destructuring', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    p.transform('const { CORAL_GRAPHQL_TOKEN, CORAL_HOST_URL } = process.env;');
    await collector.write();

    expect(readJson(out)).toEqual(['CORAL_GRAPHQL_TOKEN', 'CORAL_HOST_URL']);
  });

  it('collects destructured vars with aliases and defaults', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    p.transform("const { SWIFTYPE_API_KEY: token, SWIFTYPE_HOST = 'https://x' } = process.env;");
    await collector.write();

    expect(readJson(out)).toEqual(['SWIFTYPE_API_KEY', 'SWIFTYPE_HOST']);
  });

  it('ignores non-uppercase tokens in destructuring', async () => {
    const out = tmpOutputPath();
    const collector = createClientEnvCollector(out);
    const p = collector.plugin();

    p.transform('const { not_env, lowerCaseVar, GOOD_ENV } = process.env;');
    await collector.write();

    expect(readJson(out)).toEqual(['GOOD_ENV']);
  });
});

describe('collectDestructuredEnvNames', () => {
  it('returns names from simple destructuring', () => {
    const code = 'const { FOO, BAR } = process.env;';

    expect(collectDestructuredEnvNames(code)).toEqual(['FOO', 'BAR']);
  });

  it('handles aliases, defaults and rest syntax', () => {
    const code = 'const { FOO: fooAlias, BAR = \'x\', ...REST } = process.env;';

    expect(collectDestructuredEnvNames(code)).toEqual(['FOO', 'BAR', 'REST']);
  });
});
