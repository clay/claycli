'use strict';

const { Transform } = require('stream');
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const PluginError = require('plugin-error');

const PLUGIN_NAME = 'gulp-newer';

class Newer extends Transform {
  constructor(options) {
    super({ objectMode: true });

    if (!options) {
      throw new PluginError(
        PLUGIN_NAME,
        'Requires a dest string or options object'
      );
    }

    if (typeof options === 'string') {
      options = { dest: options };
    } else if (options.dest && typeof options.dest !== 'string') {
      throw new PluginError(PLUGIN_NAME, 'Requires a dest string');
    }

    if (options.ext && typeof options.ext !== 'string') {
      throw new PluginError(PLUGIN_NAME, 'Requires ext to be a string');
    }

    if (options.map && typeof options.map !== 'function') {
      throw new PluginError(PLUGIN_NAME, 'Requires map to be a function');
    }

    if (!options.dest && !options.map) {
      throw new PluginError(
        PLUGIN_NAME,
        'Requires either options.dest or options.map or both'
      );
    }

    if (options.extra) {
      if (typeof options.extra === 'string') {
        options.extra = [options.extra];
      } else if (!Array.isArray(options.extra)) {
        throw new PluginError(
          PLUGIN_NAME,
          'Requires options.extra to be a string or array'
        );
      }
    }

    /**
     * Path to destination directory or file.
     * @type {string}
     */
    this._dest = options.dest;

    /**
     * Optional extension for destination files.
     * @type {string}
     */
    this._ext = options.ext;

    /**
     * Optional function for mapping relative source files to destination files.
     * @type {function(string): string}
     */
    this._map = options.map;

    /**
     * Key for the timestamp in files' stats object
     * @type {string}
     */
    this._timestamp = options.ctime ? 'ctime' : 'mtime';

    /**
     * Promise for the dest file/directory stats.
     * @type {Promise}
     */
    // Catch ENOENT at construction time so Node 20's stricter unhandled-rejection
    // detection doesn't crash the process when the dest file doesn't exist yet
    // (first build on a clean container). Downstream code already handles null
    // to mean "dest missing, pass all files through".
    this._destStats = this._dest
      ? fs.promises.stat(this._dest).catch(err => err.code === 'ENOENT' ? null : Promise.reject(err))
      : Promise.resolve(null);

    /**
     * If the provided dest is a file, we want to pass through all files if any
     * one of the source files is newer than the dest.  To support this, source
     * files need to be buffered until a newer file is found.  When a newer file
     * is found, buffered source files are flushed (and the `_all` flag is set).
     * @type {Array|null}
     */
    this._bufferedFiles = null;

    /**
     * Indicates that all files should be passed through.  This is set when the
     * provided dest is a file and we have already encountered a newer source
     * file.  When true, all remaining source files should be passed through.
     * @type {boolean}
     */
    this._all = false;

    /**
     * Indicates that there are extra files (configuration files, etc.)
     * that are not to be fed into the stream, but that should force
     * all files to be rebuilt if *any* are older than one of the extra
     * files.
     */
    this._extraStats = null;

    if (options.extra) {
      const timestamp = this._timestamp;

      this._extraStats = Promise.all(options.extra.map((pattern) => glob(pattern)))
        .then((fileArrays) => {
          const allFiles = fileArrays.flat();

          return Promise.all(allFiles.map((f) => fs.promises.stat(f)));
        })
        .then((resolvedStats) => {
          let latestStat = resolvedStats[0];

          for (let j = 1; j < resolvedStats.length; j++) {
            if (resolvedStats[j][timestamp] > latestStat[timestamp]) {
              latestStat = resolvedStats[j];
            }
          }
          return latestStat;
        })
        .catch((error) => {
          if (error && error.path) {
            throw new PluginError(
              PLUGIN_NAME,
              'Failed to read stats for an extra file: ' + error.path
            );
          } else {
            throw new PluginError(
              PLUGIN_NAME,
              'Failed to stat extra files; unknown error: ' + error
            );
          }
        });
    }
  }

  /**
   * Pass through newer files only.
   * @param {File} srcFile A vinyl file.
   * @param {string} encoding Encoding (ignored).
   * @param {function(Error, File)} done Callback.
   */
  _transform(srcFile, encoding, done) {
    if (!srcFile || !srcFile.stat) {
      done(new PluginError(PLUGIN_NAME, 'Expected a source file with stats'));
      return;
    }

    Promise.all([this._destStats, this._extraStats])
      .then(([destStats, extraStats]) => {
        if ((destStats && destStats.isDirectory()) || this._ext || this._map) {
          const relative = srcFile.relative;
          const ext = path.extname(relative);
          let destFileRelative = this._ext
            ? relative.substr(0, relative.length - ext.length) + this._ext
            : relative;

          if (this._map) {
            destFileRelative = this._map(destFileRelative);
          }
          const destFileJoined = this._dest
            ? path.join(this._dest, destFileRelative)
            : destFileRelative;

          return Promise.all([fs.promises.stat(destFileJoined), extraStats]);
        } else {
          if (!this._bufferedFiles) {
            this._bufferedFiles = [];
          }
          return [destStats, extraStats];
        }
      })
      .catch((err) => {
        if (err.code === 'ENOENT') {
          // dest file or directory doesn't exist, pass through all
          return [null, null];
        }
        throw err;
      })
      .then(([destFileStats, extraFileStats]) => {
        const timestamp = this._timestamp;
        let newer =
          !destFileStats || srcFile.stat[timestamp] > destFileStats[timestamp];

        // If *any* extra file is newer than a destination file, then ALL are newer.
        if (
          extraFileStats &&
          destFileStats &&
          extraFileStats[timestamp] > destFileStats[timestamp]
        ) {
          newer = true;
        }
        if (this._all) {
          this.push(srcFile);
        } else if (!newer) {
          if (this._bufferedFiles) {
            this._bufferedFiles.push(srcFile);
          }
        } else {
          if (this._bufferedFiles) {
            // flush buffer
            this._bufferedFiles.forEach((file) => this.push(file));
            this._bufferedFiles.length = 0;
            // pass through all remaining files as well
            this._all = true;
          }
          this.push(srcFile);
        }
        done();
      })
      .catch(done);
  }

  /**
   * Remove references to buffered files.
   * @param {function(Error)} done Callback.
   */
  _flush(done) {
    this._bufferedFiles = null;
    done();
  }
}

/**
 * Only pass through source files that are newer than the provided destination.
 * @param {Object} options An options object or path to destination.
 * @return {Newer} A transform stream.
 */
module.exports = function(options) {
  return new Newer(options);
};
