/* eslint-env jest */
'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');

let tmpDir, cwdSpy;

async function setupTmp(prefix) {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  jest.resetModules();
}

async function cleanupTmp() {
  if (cwdSpy) cwdSpy.mockRestore();
  if (tmpDir) await fs.remove(tmpDir);
  cwdSpy = null;
  tmpDir = null;
  jest.resetModules();
}

describe('vite vue2 plugin', () => {
  afterEach(async () => {
    await cleanupTmp();
    jest.dontMock('@vue/component-compiler-utils');
    jest.dontMock('vue-template-compiler');
  });

  it('returns null for non-vue files', async () => {
    await setupTmp('claycli-vue2-nonvue-');

    const pluginFactory = require('./vue2');
    const plugin = pluginFactory();
    const result = await plugin.transform.call({ warn: jest.fn(), error: jest.fn() }, 'const x = 1;', '/tmp/a.js');

    expect(result).toBeNull();
  });

  it('transforms vue SFC and writes kiln css on closeBundle', async () => {
    await setupTmp('claycli-vue2-transform-');

    const vuePath = path.join(tmpDir, 'components', 'foo', 'client.vue');

    await fs.ensureDir(path.dirname(vuePath));
    await fs.writeFile(vuePath, [
      '<template><div class="foo">hello</div></template>',
      '<script>export default { name: "Foo" };</script>',
      '<style scoped>.foo { color: red; }</style>',
    ].join('\n'));

    const pluginFactory = require('./vue2');
    const plugin = pluginFactory();
    const ctx = {
      warn: jest.fn(),
      error: jest.fn((msg) => {
        throw new Error(msg);
      }),
    };

    const out = await plugin.transform.call(ctx, '', vuePath);

    expect(out).toBeTruthy();
    expect(out.code).toContain('const __sfc__ =');
    expect(out.code).toContain('__sfc__.render = render;');
    expect(out.code).toContain('__sfc__._scopeId');
    expect(out.code).toContain('document.createElement("style")');
    expect(out.code).toContain('export default __sfc__;');

    await plugin.closeBundle();

    const kilnCssPath = path.join(tmpDir, 'public', 'css', '_kiln-plugins.css');
    const kilnCss = await fs.readFile(kilnCssPath, 'utf8');

    expect(kilnCss).toContain('.foo');
  });

  it('warns and returns null if vue file cannot be read', async () => {
    await setupTmp('claycli-vue2-missing-file-');

    const pluginFactory = require('./vue2');
    const plugin = pluginFactory();
    const ctx = {
      warn: jest.fn(),
      error: jest.fn((msg) => {
        throw new Error(msg);
      }),
    };

    const result = await plugin.transform.call(ctx, '', path.join(tmpDir, 'missing.vue'));

    expect(result).toBeNull();
    expect(ctx.warn).toHaveBeenCalled();
  });

  it('errors with install guidance when vue compilers are unavailable', async () => {
    await setupTmp('claycli-vue2-missing-compiler-');

    await fs.ensureDir(path.join(tmpDir, 'components', 'foo'));
    const vuePath = path.join(tmpDir, 'components', 'foo', 'client.vue');

    await fs.writeFile(vuePath, '<template><div/></template><script>export default {};</script>');

    jest.doMock('@vue/component-compiler-utils', () => {
      throw new Error('module missing');
    });

    const pluginFactory = require('./vue2');
    const plugin = pluginFactory();
    const ctx = {
      warn: jest.fn(),
      error: jest.fn((msg) => {
        throw new Error(msg);
      }),
    };

    await expect(plugin.transform.call(ctx, '', vuePath)).rejects.toThrow(
      /Vue 2 SFC support requires @vue\/component-compiler-utils and vue-template-compiler/
    );
  });
});
