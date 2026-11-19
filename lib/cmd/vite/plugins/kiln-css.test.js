/* eslint-env jest */
'use strict';

const fs = require('fs-extra');
const os = require('os');
const path = require('path');

let tmpDir, cwdSpy, kilnCss;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claycli-kiln-css-'));
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  jest.resetModules();
  kilnCss = require('./kiln-css');
});

afterEach(async () => {
  cwdSpy.mockRestore();
  await fs.remove(tmpDir);
  jest.resetModules();
});

const id = file => path.join(tmpDir, file);

describe('kiln-css', () => {
  it('writes _kiln-plugins.css under public/css', () => {
    expect(kilnCss.KILN_CSS_DEST).toBe(path.join(tmpDir, 'public', 'css', '_kiln-plugins.css'));
  });

  describe('render', () => {
    it('has every block, files in path order whatever order they were recorded in', () => {
      kilnCss.setBlocks(id('services/kiln/b.vue'), ['.b1{}', '.b2{}']);
      kilnCss.setBlocks(id('components/a/a.vue'), ['.a{}']);

      expect(kilnCss.render()).toEqual({ css: '.a{}\n.b1{}\n.b2{}', blocks: 3 });
    });

    it('is empty when nothing was recorded', () => {
      expect(kilnCss.render()).toEqual({ css: '', blocks: 0 });
    });
  });

  describe('setBlocks', () => {
    it('replaces a file\'s blocks, and drops the entry when it has none left', () => {
      kilnCss.setBlocks(id('a.vue'), ['.old{}']);
      kilnCss.setBlocks(id('a.vue'), ['.new{}']);
      expect(kilnCss.render().css).toBe('.new{}');
      kilnCss.setBlocks(id('a.vue'), []);
      expect(kilnCss.render()).toEqual({ css: '', blocks: 0 });
    });
  });

  describe('collectedFor', () => {
    it('returns the blocks of the .vue files among the ids, keyed by relative path', () => {
      kilnCss.setBlocks(id('components/a/a.vue'), ['.a{}']);
      kilnCss.setBlocks(id('services/kiln/b.vue'), ['.b{}']);

      expect(kilnCss.collectedFor([id('components/a/a.vue'), id('components/a/client.js'), '\0virtual'])).toEqual({
        'components/a/a.vue': ['.a{}'],
      });
    });
  });

  describe('seed', () => {
    it('puts back blocks from an earlier build, which a rebuilt file then replaces', () => {
      kilnCss.seed({ 'components/a/a.vue': ['.old-a{}'], 'services/kiln/b.vue': ['.old-b{}'] });
      expect(kilnCss.render().css).toBe('.old-a{}\n.old-b{}');

      kilnCss.setBlocks(id('components/a/a.vue'), ['.new-a{}']);
      expect(kilnCss.render().css).toBe('.new-a{}\n.old-b{}');
    });
  });
});
