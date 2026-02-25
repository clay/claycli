'use strict';

/* eslint-env jest */

const path = require('path'),
  fs = require('fs-extra'),
  styles = require('./styles');

describe('compile/styles', () => {
  const cwd = process.cwd(),
    destPath = path.join(cwd, 'public', 'css');

  describe('transformPath', () => {
    const fn = styles.transformPath;

    it('transforms component CSS path to dest path', () => {
      var filepath = path.join(cwd, 'styleguides', 'default', 'components', 'article.css');

      expect(fn(filepath)).toBe(path.join(destPath, 'article.default.css'));
    });

    it('includes styleguide name in output filename', () => {
      var filepath = path.join(cwd, 'styleguides', 'nymag', 'components', 'header.css');

      expect(fn(filepath)).toBe(path.join(destPath, 'header.nymag.css'));
    });

    it('handles layout CSS paths', () => {
      var filepath = path.join(cwd, 'styleguides', 'default', 'layouts', 'two-column.css');

      expect(fn(filepath)).toBe(path.join(destPath, 'two-column.default.css'));
    });

    it('handles CSS files with variations in name', () => {
      var filepath = path.join(cwd, 'styleguides', 'vulture', 'components', 'article--feature.css');

      expect(fn(filepath)).toBe(path.join(destPath, 'article--feature.vulture.css'));
    });

    it('output is under public/css', () => {
      var filepath = path.join(cwd, 'styleguides', 'default', 'components', 'test.css');

      expect(fn(filepath)).toContain(path.join('public', 'css'));
    });
  });

  describe('renameFile', () => {
    const fn = styles.renameFile;

    it('renames component file to <component>.<styleguide> format', () => {
      var filepath = {
        dirname: 'default/components',
        basename: 'article',
        extname: '.css'
      };

      fn(filepath);
      expect(filepath.dirname).toBe('');
      expect(filepath.basename).toBe('article.default');
    });

    it('extracts styleguide from first directory segment', () => {
      var filepath = {
        dirname: 'nymag/components',
        basename: 'header',
        extname: '.css'
      };

      fn(filepath);
      expect(filepath.basename).toBe('header.nymag');
    });

    it('handles layout files', () => {
      var filepath = {
        dirname: 'vulture/layouts',
        basename: 'two-column',
        extname: '.css'
      };

      fn(filepath);
      expect(filepath.dirname).toBe('');
      expect(filepath.basename).toBe('two-column.vulture');
    });

    it('clears dirname so file goes to root of dest', () => {
      var filepath = {
        dirname: 'default/components',
        basename: 'test',
        extname: '.css'
      };

      fn(filepath);
      expect(filepath.dirname).toBe('');
    });
  });

  describe('hasChanged', () => {
    const fn = styles.hasChanged;

    var tmpDir, targetDir;

    beforeEach(() => {
      tmpDir = path.join(cwd, 'styleguides');
      targetDir = path.join(cwd, 'public', 'css');
      fs.ensureDirSync(tmpDir);
      fs.ensureDirSync(targetDir);
    });

    afterEach(() => {
      // Clean up created test files
      fs.removeSync(path.join(cwd, 'public', 'css', '_test-target.css'));
      fs.removeSync(path.join(tmpDir, 'test-dep.css'));
    });

    it('pushes to stream when target does not exist', () => {
      var stream = { push: jest.fn() },
        sourceFile = {
          contents: Buffer.from('/* no imports */'),
          stat: { ctime: new Date() }
        },
        targetPath = path.join(targetDir, '_nonexistent-target.css');

      return fn(stream, sourceFile, targetPath).then(() => {
        expect(stream.push).toHaveBeenCalledWith(sourceFile);
      });
    });

    it('pushes to stream when source is newer than target', () => {
      var targetPath = path.join(targetDir, '_test-target.css');

      // Create target file first
      fs.writeFileSync(targetPath, '');

      var stream = { push: jest.fn() },
        sourceFile = {
          contents: Buffer.from('/* no imports */'),
          stat: { ctime: new Date(Date.now() + 10000) } // much newer than target
        };

      return fn(stream, sourceFile, targetPath).then(() => {
        expect(stream.push).toHaveBeenCalledWith(sourceFile);
      });
    });

    it('does not push to stream when source is older than target and no changed deps', () => {
      var targetPath = path.join(targetDir, '_test-target.css');

      // Create target file
      fs.writeFileSync(targetPath, '');

      var stream = { push: jest.fn() },
        sourceFile = {
          contents: Buffer.from('/* no imports */'),
          stat: { ctime: new Date(0) } // very old
        };

      return fn(stream, sourceFile, targetPath).then(() => {
        expect(stream.push).not.toHaveBeenCalled();
      });
    });

    it('handles CSS that detective-postcss cannot parse', () => {
      var targetPath = path.join(targetDir, '_test-target.css');

      fs.writeFileSync(targetPath, '');

      var stream = { push: jest.fn() },
        sourceFile = {
          contents: Buffer.from('$$$not-valid-css{{{'),
          stat: { ctime: new Date(0) }
        };

      // Should not throw, should gracefully handle
      return fn(stream, sourceFile, targetPath).then(() => {
        expect(stream.push).not.toHaveBeenCalled();
      });
    });
  });

  describe('compile (main export)', () => {
    it('is a function', () => {
      expect(typeof styles).toBe('function');
    });
  });

  describe('destination paths', () => {
    it('uses public/css as the CSS destination', () => {
      expect(styles._destPath).toBe(path.join(cwd, 'public', 'css'));
    });
  });

  describe('variables', () => {
    it('has asset-host variable', () => {
      expect(styles._variables).toHaveProperty('asset-host');
    });

    it('has asset-path variable', () => {
      expect(styles._variables).toHaveProperty('asset-path');
    });

    it('has minify variable', () => {
      expect(styles._variables).toHaveProperty('minify');
    });
  });
});
