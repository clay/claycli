const spiff = require('spiff'),
  fs = require('fs-extra'),
  path = require('path'),
  _ = require('lodash'),
  bluebird = require('bluebird'),
  globby = require('globby'),
  postcss = require('postcss'),
  syntax = require('postcss-scss'),
  importer = require('postcss-import'),
  inlineVariables = require('postcss-inline-variables'),
  getVariables = require('postcss-get-sass-variables'),
  stripComments = require('postcss-strip-inline-comments'),
  nested = require('postcss-nested'),
  cssnano = require('cssnano'),
  logger = require('../utils/logger'),
  defaultAssetDir = 'public'; // todo: maybe we want to allow users to configure this?

/**
 * get child directories of a directory
 * @param  {string} cwd
 * @return {array}
 */
function getDirectories(cwd) {
  try {
    return fs.readdirSync(cwd).filter((file) => fs.lstatSync(path.join(cwd, file)).isDirectory());
  } catch (e) {
    return [];
  }
}

/**
 * get list of components
 * @param  {string} basePath to search in
 * @return {array} of site slugs
 */
function getComponentsList(basePath) {
  const cwd = path.join(basePath, 'components');

  return getDirectories(cwd);
}

/**
 * get list of sites
 * @param  {string} basePath to search in
 * @return {array} of site slugs
 */
function getSitesList(basePath) {
  const cwd = path.join(basePath, 'sites');

  return getDirectories(cwd);
}

/**
 * get variables in styleguide
 * @param  {string} site     slug
 * @param  {string} basePath
 * @return {object}
 */
function getStyleguide(site, basePath) {
  return spiff.read(`sites/${site}/styleguide/*.css`, { cwd: basePath })
    .map((file) => {
      const variables = {};

      return postcss([
        importer(),
        stripComments,
        getVariables((obj) => {
          _.assign(variables, obj);
        })
      ]).process(file.contents, { from: file.path, parser: syntax }).then(() => {
        return variables;
      });
    }).then((variableList) => _.reduce(variableList, (result, variables) => _.assign(result, variables), {}));
}

/**
 * compile component base styles for a site
 * @param  {string} component name
 * @param  {string} site      slug
 * @param {object} styleguide
 * @param  {string} basePath
 * @param {boolean} isProduction
 * @return {Promise}
 */
function compileBaseStyles(component, site, { styleguide, basePath, isProduction }) {
  const componentPath = `${basePath}/components/${component}/styles.css`;

  return fs.readFile(componentPath, 'utf8')
    .then((contents) => {
      const plugins = [
        importer(), // allow importing npm styles
        stripComments,
        nested,
        inlineVariables(styleguide, { requirePrefix: 'folder', requireDefault: 'flag' })
      ];

      if (isProduction) {
        plugins.push(cssnano({ preset: 'default' }));
      }

      return postcss(plugins)
        .process(contents, { from: componentPath, parser: syntax })
        .then((result) => fs.outputFile(`${basePath}/${defaultAssetDir}/css/${component}.${site}.css`, result.css));
    });
}

/**
 * compile component site-specific styles
 * @param  {string} component name
 * @param  {string} site      slug
 * @param {object} styleguide
 * @param  {string} basePath
 * @param {boolean} isProduction
 * @return {Promise}
 */
function compileSiteStyles(component, site, { styleguide, basePath, isProduction }) {
  const componentPath = `${basePath}/sites/${site}/components/${component}.css`;

  return fs.readFile(componentPath, 'utf8')
    .then((contents) => {
      const plugins = [
        importer({
          path: [basePath] // allow importing base styles e.g. '@import components/foo/styles.css'
        }),
        stripComments,
        nested,
        inlineVariables(styleguide, { requirePrefix: 'file', requireDefault: 'flag' })
      ];

      if (isProduction) {
        plugins.push(cssnano({ preset: 'default' }));
      }

      return postcss(plugins)
        .process(contents, { from: componentPath, parser: syntax })
        .then((result) => fs.outputFile(`${basePath}/public/css/${component}.${site}.css`, result.css));
    });
}

/**
 * compile all component styles for a site
 * @param  {string} site           slug
 * @param  {array} componentSlugs
 * @param {string} basePath
 * @param {boolean} isProduction
 * @return {Promise}
 */
function compileStyles(site, { componentSlugs, basePath, isProduction }) {
  // first, grab all variables from the styleguide
  return getStyleguide(site, basePath)
    .then((styleguide) => {
      const siteSpecificComponents = [];

      // then compile site-specific styles (if they exist)
      return globby(`sites/${site}/components/*.css`)
        .then((paths) => {
          return bluebird.all(_.map(paths, (componentPath) => {
            const name = path.basename(componentPath, path.extname(componentPath));

            // push the component name into the list of site-specific components we've found,
            // so we don't try to compile their base styles
            siteSpecificComponents.push(name);
            return compileSiteStyles(name, site, { styleguide, basePath, isProduction });
          }));
        })
        .then(() => {
          // finally, compile the base styles for components that don't have site-specific styles
          return bluebird.all(_.map(_.difference(componentSlugs, siteSpecificComponents), (component) => compileBaseStyles(component, site, { styleguide, basePath, isProduction })));
        });
    });
}

function compile(filepath, argv) {
  const isWatching = argv.watch,
    isProduction = argv.production,
    siteSlugs = getSitesList(filepath),
    componentSlugs = getComponentsList(filepath);

  // if we don't find any sites in filepath + /sites/, we can't compile any styles (so exit early)
  if (!siteSlugs.length) {
    logger.error('No sites found! Cannot compile styles.', filepath);
    process.exit(1);
  } else if (!componentSlugs.length) { // same thing if we don't find any components
    logger.error('No components found! Cannot compile styles.', filepath);
    process.exit(1);
  }

  logger.info(`Compiling ${isProduction && 'and minifying ' || isWatching && 'and watching ' || ''}styles!`, filepath);
  if (isProduction) {
    // compile and minify for production. never watch
    return bluebird.all(_.map(siteSlugs, (site) => compileStyles(site, { componentSlugs, basePath: filepath, isProduction: true })));
  } else if (isWatching) {
    // compile and watch, without minifying
    logger.error('Watch not supported yet!');
  } else {
    // compile once, without minifying
    return bluebird.all(_.map(siteSlugs, (site) => compileStyles(site, { componentSlugs, basePath: filepath })));
  }
}

module.exports = compile;
