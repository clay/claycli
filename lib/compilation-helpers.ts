import _ from 'lodash';
import path from 'path';

const format = require('date-fns/format');
const chalk = require('chalk');
const fs = require('fs-extra');
const amphoraFs = require('amphora-fs');
const configFile = require('./config-file-helpers');

interface BrowserslistConfig {
  overrideBrowserslist: string[];
}

/**
 * determine how long a compilation task took
 */
function time(t2: number, t1: number): string {
  const diff = t2 - t1;

  if (diff > 1000 * 60) {
    // more than a minute (60,000ms)
    return format(new Date(diff), "m'm' s.SS's'");
  } else {
    // less than a minute
    return format(new Date(diff), "s.SS's'");
  }
}

/**
 * set up a watcher that logs when a file has changed
 * used by all scripts
 */
function watcher(e: string, filepath: string): void {
  if (!_.includes(filepath, '.DS_Store')) {
    console.log(chalk.green('\u2713 ') + chalk.grey(filepath.replace(process.cwd(), '')));
  }
}

/**
 * determine what bucket of the alphabet the first letter of a name falls into
 * note: six buckets is the sweet spot for filesize / file bundling on http 1.1 and http2/spdy
 * note: non-alphabetic stuff goes in the last bucket, because statistically it will be the smallest
 */
function bucket(name: string): string {
  if (name.match(/^[a-d]/i)) {
    return 'a-d';
  } else if (name.match(/^[e-h]/i)) {
    return 'e-h';
  } else if (name.match(/^[i-l]/i)) {
    return 'i-l';
  } else if (name.match(/^[m-p]/i)) {
    return 'm-p';
  } else if (name.match(/^[q-t]/i)) {
    return 'q-t';
  } else {
    return 'u-z';
  }
}

/**
 * find the matcher for a bucket
 */
function unbucket(name: string): string | undefined {
  return _.find(['a-d', 'e-h', 'i-l', 'm-p', 'q-t', 'u-z'], (matcher) => _.includes(name, matcher));
}

/**
 * generate bundles for gulp-group-concat, based on the buckets above
 */
function generateBundles(prefix: string, ext: string): Record<string, string> {
  return _.reduce(['a-d', 'e-h', 'i-l', 'm-p', 'q-t', 'u-z'], (bundles: Record<string, string>, matcher) => {
    bundles[`${prefix}-${matcher}.${ext}`] = `**/[${matcher}]*.${ext}`;
    return bundles;
  }, {});
}


/**
 * determine if a file has changed based on ctimes
 */
/* istanbul ignore next */
function hasChanged(stream: { push: (file: unknown) => void }, sourceFile: { stat?: { ctime: Date } }, targetPath: string): Promise<void> {
  return fs.stat(targetPath).then((targetStat: { ctime: Date }) => {
    if (sourceFile.stat && sourceFile.stat.ctime > targetStat.ctime) {
      stream.push(sourceFile);
    }
  }).catch(() => {
    // targetPath doesn't exist! gotta compile the source
    stream.push(sourceFile);
  });
}

/**
 * transform the filepath if we're minifying the files and putting them into bundles
 */
function transformPath(prefix: string, destPath: string, shouldMinify: boolean): (filepath: string) => string {
  return (filepath) => {
    if (shouldMinify) {
      // bundle into one of six bundle files based on the first letter of the component/template
      const name = _.head(path.basename(filepath).toLowerCase().split('.')) as string;

      return path.join(destPath, `${prefix}-${bucket(name)}.js`);
    } else {
      // no changes, use the path from rename()
      return filepath;
    }
  };
}

/**
 * Find the additional plugins to use in PostCSS
 * compilation. Either accept the values from command
 * arguments and require them in or use the config file
 */
function determinePostCSSPlugins(argv: { plugins?: string[] }): unknown[] {
  const configPlugins = configFile.getConfigValue('plugins');

  if (configPlugins) {
    if (!Array.isArray(configPlugins)) {
      console.error(`${chalk.red('Error: Plugins supplied in config file is not an array')}`);
    }

    // Return the array of plugins defined in the config file
    return configPlugins as unknown[];
  } else {
    return _.map(argv.plugins, (pluginName: string) => {
      const plugin = amphoraFs.tryRequire(pluginName);

      // If no plugin, log it can't be found
      if (!plugin) throw new Error(`${chalk.red(`Error: Cannot find plugin "${pluginName}"`)}`);

      try { // if plugin, invoke it
        return plugin();
      } catch (e: unknown) { // or log when it fails
        console.error(`${chalk.red(`Error: Cannot init plugin "${pluginName}"`)}\n${chalk.grey((e as Error).message)}`);
      }
    });
  }
}

/**
 * Given an key, grab the value from the config file
 * or pull from the browserlist that's supported
 */
function getConfigFileOrBrowsersList(key: string): unknown {
  const configFileValue = configFile.getConfigValue(key);

  return configFileValue ? configFileValue : browserslist;
}

/**
 * Given an key, grab the value from the config file
 */
function getConfigFileValue(key: string): unknown {
  return configFile.getConfigValue(key);
}

const browserslist: BrowserslistConfig = {
  overrideBrowserslist: ['Chrome >= 89', 'Safari >= 14', 'Firefox >= 90', 'Edge >= 89']
}; // used by styles, scripts, and babel/preset-env

export {
  time,
  bucket,
  unbucket,
  generateBundles,
  hasChanged,
  transformPath,
  browserslist,
  determinePostCSSPlugins,
  getConfigFileOrBrowsersList,
  getConfigFileValue,
  watcher
};

export const debouncedWatcher = _.debounce(watcher, 200);
