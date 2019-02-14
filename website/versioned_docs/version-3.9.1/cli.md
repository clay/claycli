---
id: version-3.9.1-cli
title: Claycli
original_id: cli
---
This is the `Clay` command line utility. Using `claycli` you will have some useful options for your site. Here we will provide you with documentation and examples that will help you to run all the functionalities that you need.

## Installation

To install `claycli` you just need to type the following command:
```bash
$ npm install -g claycli
```
> Note: You will need to install node or yarns >= 8.10

## Usage

If installed globally, call `clay` from the command line with the [command](#commands) and `options` that you need.
```bash
$ clay <command> [options]
```

Much like `git`; `claycli` is configured using a [dotfile](https://medium.com/@webprolific/getting-started-with-dotfiles-43c3602fd789) (`.clayconfig`) in your home folder. In it, you may specify references to api keys and `urls / site prefixes` that you use frequently. For `urls` and `site prefixes`, it will assume `http://` and port `80` unless you specify otherwise.

Note that a `_site prefix_` is everything before the api route, e.g. `http://domain.com/site1` in `http://domain.com/site1/_components/article`.

```
[keys]
  local = ha8yds9a8shdf98asdf
  qa = 8quwqwer09ewr0w9uer
  prod = bj34b6345k634jnk63n4
[urls]
  local-site1 = https://localhost.site1.com:3001
  local-site2 = site2.com/site-2 # http and port 80
```

For smaller `Clay` installations (or, ironically, for very large teams where devs spend most of their time on individual sites), you may specify a default api key and `url / site prefix` by using the `CLAYCLI_DEFAULT_KEY` and `CLAYCLI_DEFAULT_URL` environment variables.

## Commands

* [`config`](#config)
* [`lint`](#lint)
* [`import`](#import)
* [`export`](#export)
* [`compile`](#compile)

## Common Arguments

`claycli` uses some common arguments across many commands.

* `-v, --version` will print the `claycli` version and exit
* `-h, --help` will print helpful info about `claycli` and exit
* `-r, --reporter` allows specifying how results should be logged
* `-c, --concurrency` allows setting the concurrency of api calls (defaults to 10)
* `-k, --key` allows specifying an api key or alias

### Logging

When running `claycli` programmatically (i.e., `import { someMethod } from 'claycli'`), most commands will return a stream of objects with `{ type, message, details }`. The `type` may be:
 * `success` Signals that an operation succeeded
 * `error` Signals that an operation was unsuccessful
 * `warning` Shows a potentially undesired situation
 * `info` Gives the progress information of the current operation
 * `debug` Shows information of the current operation
 
 As you can see, most of those correspond directly to log levels. Here you can check how to programmatically get the `claycli` methods on the [Programmatic API](#programmatic-api) section.

When running `claycli` from the command line, you may specify a `reporter` argument to output logs in different formats. The default is `dots`, which will print out green and red dots showing operation success / failure. There is also `pretty` (which prints more detailed messages on each line), `json` (which prints newline-separated json logs in a format that can be passed to ELK), and `nyan` (which is mostly just for fun).

```bash
$ clay lint --reporter pretty domain.com/_components/article
```

You may also specify which reporter to use by setting the `CLAYCLI_REPORTER` environment variable. If you add a `reporter` argument, it will be used instead of the env variable.

```
export CLAYCLI_REPORTER=json
```

`claycli` pipes to `stderr`. If you want to pipe the logs to a file, you may use `2>`.

```bash
$ clay lint --reporter json domain.com/_components/article 2> article-log.json
```

## Handling Files

### Dispatch

Many `claycli` commands allow you to pipe in the contents of files to `stdin` or pipe data out from `stdout`. The format that `claycli` uses to represent data (similar to a database dump) is called a _dispatch_, and it consists of newline-separated JSON without site prefixes.

```
{"/_components/article/instances/123":{"title":"My Article","content":[{"_ref":"/_components/paragraph/instances/234","text":"Four score and seven years ago..."}]}}
{"/_components/meta-title/instances/345":{"title":"My Article","ogTitle":"My Longer Titled Article","twitterTitle":"Article"}}
```

Each line of a _dispatch_ contains [composed data for a component](https://github.com/clay/amphora/blob/master/lib/routes/readme.md#component-data) (or page, user, list, etc), including any data for its child components. This means that each line is able to be sent as a [cascading PUT](https://github.com/clay/amphora/pull/73) to the Clay server, which is a highly efficient way of importing large amounts of data. Note that a _dispatch_ is not meant to be human-readable, and manually editing it is a very easy way to introduce data errors.

A _dispatch_ may be piped into or out of commands such as `clay import` and `clay export`. Because _dispatches_ are a special format (rather than regular JSON files), the convention is to use the `.clay` extension, but this isn't required.

```bash
$ clay export domain.com > article_dump.clay
$ clay import domain.com < article_dump.clay
$ clay export domain.com | clay import localhost
```

### Bootstrap

For working with human-readable data, we use a format called a _bootstrap_. These are human-readable [yaml](http://docs.ansible.com/ansible/latest/YAMLSyntax.html) files that divide components (pages, users, lists, etc) by type. [This is the same format that is used by the `bootstrap.yml` files in your Clay install](http://clay.github.io/amphora/docs/lifecycle/startup/bootstrap.html).

```yaml
_components:
  article:
    instances:
      123:
        title: My Article
        content:
          - _ref: /_components/paragraph/instances/234
  paragraph:
    instances:
      234:
        text: Four score and seven years ago...
  meta-title:
    instances:
      345:
        title: My Article
        ogTitle: My Longer Titled Article
        twitterTitle: Article
```

A _bootstrap_ may be piped into and out of any `claycli` commands that accept _dispatches_. To tell `claycli` that you're dealing with _bootstraps_, please use the `--yaml` argument.

```bash
$ clay export --yaml domain.com > article_dump.yml
$ clay import --yaml domain.com < article_dump.yml
```

If you're a backend developer or database architect, it may be helpful to think of _dispatches_ and _bootstraps_ as [denormalized and normalized data](https://medium.com/@katedoesdev/normalized-vs-denormalized-databases-210e1d67927d). You'll notice that the two examples above contain the same data. The denormalized _dispatches_ allow a single API call per line and use less memory because they're streamable, while the normalized _bootstraps_ are better for hand-coding data because components are not duplicated if referenced multiple times. Generally speaking, use _dispatches_ for transporting and storing data and _bootstraps_ for hand-coding.

## Config

```bash
$ clay config --key <alias> [value]
$ clay config --url <alias> [value]
```

Show or set configuration options. These are saved to `~/.clayconfig`. As specified above, sites will assume `http` and port `80` if you do not write the protocol and port.

### Arguments

* `-k, --key` allows viewing or saving an api key
* `-u, --url` allows viewing or saving a url / site prefix
* `-r, --reporter` allows specifying how results should be logged (note: all reporters except `json` report `clay config` the same)

### Examples

```bash
# view all configuration options
$ clay config

# view 'local' api key
$ clay config --key local

# set 'local' api key
$ clay config --key local ab27s9d

# view 'qa' site prefix
$ clay config --url qa

# set 'qa' site prefix
$ clay config --url qa https://qa.domain.com:3001

# set a specific url
$ clay config --url my-cool-article domain.com/_components/article/instances/123
```

## Lint

```bash
clay lint [--concurrency <number>] [url]
```

Verify Clay data against standardized conventions and make sure all child components exist.

Linting a page, component, or user url will verify that the data for that url exists, and (for pages and components) will (recursively) verify that all references to child components exist. The url must be a raw url, an alias specified via `clay config`, or omitted in favor of `CLAYCLI_DEFAULT_URL`. Linting a public url (or a page/component url that has a `.html` extension) will attempt to render that url with the extension and, if that fails, try to figure out which component isn't rendering correctly. You may lint other renderers by providing their extensions, e.g. `.amp` or `.rss`.

Instead of linting a url, you may pipe in a component's `schema.yml` to lint. It will go through the schema and verify that it conforms to [Kiln's schema rules](https://claycms.gitbooks.io/kiln/editing-components.html).

### Arguments

* `-r, --reporter` allows specifying how results should be logged
* `-c, --concurrency` allows setting the concurrency of api calls

### Examples

```bash
# lint all components on a page
$ clay lint domain.com/_pages/123

# lint a page via public url
$ clay lint domain.com/2018/02/some-slug.html

# lint a component and its html
$ clay lint domain.com/_components/article/instances/abc.html

# lint a component specified via config alias
$ clay lint my-cool-article

# lint single schema
$ clay lint < components/article/schema.yml
```

## Import

```bash
clay import [--key <api key>] [--concurrency <number>] [--publish] [--yaml] [site prefix]
```

Imports data into Clay from `stdin`. Data may be in _dispatch_ or _bootstrap_ format. Site prefix must be a raw url, an alias specified via `clay config`, or omitted in favor of `CLAYCLI_DEFAULT_URL`. Key must be an alias specified via `clay config`, or omitted in favor of `CLAYCLI_DEFAULT_KEY`.

The `publish` argument will trigger a publish of the pages and/or components you're importing. Note that the generated url of an imported page might be different than its original url, depending on your Clay url generation / publishing logic.

### Arguments

* `-k, --key` allows specifying an api key or alias
* `-r, --reporter` allows specifying how results should be logged
* `-c, --concurrency` allows setting the concurrency of api calls
* `-p, --publish` triggers publishing of imported pages
* `-y, --yaml` specifies that input is _bootstrap_ format

### Examples

```bash
# import a dispatch
$ clay import --key local localhost:3001 < db_dump.clay

# import and publish pages in a bootstrap
$ clay import --key qa --publish --yaml < bootstrap.yml

# pipe from 3rd party exporter
$ wordpress-export domain.com/blog | clay import --key local localhost.domain.com

# pipe from clay exporter
$ clay export --key prod domain.com/_components/article/instances/123 | clay import --key local localhost.domain.com

# import multiple dispatches
$ cat *.clay | clay import --key local localhost:3001

# import multiple bootstraps
$ tail -n +1 *.yml | clay import --key local --yaml localhost:3001

# recursively import multiple bootstraps
$ find . -name '*.yml' -exec cat "{}" \; | clay import --key local --yaml localhost:3001

# recursively import multiple bootstraps (bash v4+ & zsh)
$ cat **/*.yml | clay import --key local --yaml localhost:3001
```

## Export

```bash
clay export [--key <api key>] [--concurrency <number>] [--size <number>] [--layout] [--yaml] [url]
```

Exports data from Clay to `stdout`. Data may be in _dispatch_ or _bootstrap_ format. The url must be a raw url, an alias specified via `clay config`, or omitted in favor of `CLAYCLI_DEFAULT_URL`.

If the url points to a site prefix (i.e. it does not point to a specific type of data (a specific page, public url, component, user, list, etc)), `claycli` will query the built-in `pages` index to pull the latest 10 pages from the site. When querying the `pages` index, you must specify a `key` or have the `CLAYCLI_DEFAULT_KEY` set. The api key is only required when exporting multiple pages (by querying the `pages` index or by running custom queries, below).

Instead of fetching the latest pages, you may pipe in a yaml-formatted [elasticsearch query](https://www.elastic.co/guide/en/elasticsearch/reference/6.6/query-dsl.html). Use this to set custom offsets (for batching and chunking exports), export non-page content from other indices or filter exported data via certain properties. Note that if you pipe in a query that includes `size`, it will take precedence over the CLI `size` argument.

```yaml
index: pages
size: 100
body:
  sort:
    updateTime:
        order: desc # sort by latest updated
  query:
    bool:
      must:
        -
          terms:
            siteSlug:
              - intelligencer # show only pages for a specific site
        -
          match:
            published: true # show only published pages

```

You may also query other elastic indices, but please make sure that each document returned has a clay uri (e.g. `domain.com/_components/foo/instances/bar` or `domain.com/_pages/foo`) as its `_id`.

```yaml
index: published-products
size: 5
from: 10
sort:
  - price
body:
  query:
    match_all: {}
```

By default, layouts are not exported when exporting pages. This allows you to easily copy individual pages between sites and environments. To trigger layout exporting, please use the `layout` argument.

### Arguments

* `-k, --key` allows specifying an api key or alias
* `-r, --reporter` allows specifying how results should be logged
* `-c, --concurrency` allows setting the concurrency of api calls
* `-s, --size` specifies the number of pages to export (defaults to 10)
* `-l, --layout` triggers exporting of layouts
* `-y, --yaml` specifies that output is _bootstrap_ format

### Examples

```bash
# export individual component
$ clay export domain.com/_components/article/instances/123 > article_dump.clay

# export individual page
$ clay export --yaml domain.com/_pages/123 > page_bootstrap.yml

# export page with layout
$ clay export --layout --yaml domain.com/_pages/123 > page_bootstrap.yml

# copy page to local environment
$ clay export domain.com/_pages/123 | clay import --key local local.domain.com

# export latest updated page
$ clay export --key prod --size 1 domain.com > recent_page.clay

# export custom query to dispatch
$ cat query.yml | clay export --key prod domain.com > db_dump.clay

# export custom query to bootstrap
$ clay export --yaml --key prod domain.com/sub-site < query.yml > pages.yml

# note that 'cat query.yml | clay export' and 'clay export < query.yml' are equivalent ways
# to pipe from a file into claycli in most operating systems

#
# other things you may export
#

# export single user
$ clay export domain.com/_users/abs8a7s8d --yaml > my_user.yml

# export all users
$ clay export domain.com/_users --yaml > users.yml

# export single list
$ clay export domain.com/_lists/tags > tags.clay

# export all lists
$ clay export domain.com/_lists > lists.clay

# export published page via public url
$ clay export domain.com/2017/02/some-slug.html

# export built-in 'New Page Templates' list (page uris will be unprefixed)
$ clay export domnain.com/_lists/new-pages
```

## Compile

```bash
clay compile [--watch] [--minify] [--inlined] [--linked] [--plugins <space-separated list of postcss plugins>] [--globs <space-separated glob strings>] [--reporter <reporter>]
```

Compile assets based on standardized Clay conventions. Assets are compiled to a `public` folder at the root of your Clay install (the directory where you run the `clay compile` command), with scripts (including templates), styles (including fonts), and media output to the `js`, `css`, and `media` folders. You may run `clay compile` to compile _all_ assets or run any of its subcommands (`media`, `fonts`, `styles`, `templates`, `scripts`) to compile a specific type of asset.

Specifying `--watch` on `claycli compile` or any of its subcommands will compile assets once, then watch source files (and their dependencies) for changes. Specifying `--minify` (or setting `CLAYCLI_COMPILE_MINIFIED`) will run assets through minification and bundling if applicable. The `CLAYCLI_COMPILE_ASSET_HOST` and `CLAYCLI_COMPILE_ASSET_PATH` variables are used by the `styles` and `fonts` subcommands to generate links to media and font files in the compiled CSS.

A project specific clay config file is also supported, [read more here](#project-specific-config-file).

#### Arguments

* `-w, --watch` enables watching of source files after compilation
* `-m, --minify` enables minification and bundling of source files
* `-i, --inlined` enables the generation of base64 inlined font CSS
* `-l, --linked` enables the generation of linked font CSS
* `-p, --plugins` allows running additional postcss plugins when compiling styles
* `-g, --globs` allows compiling additional JavaScript to `public/js/_global.js`
* `-r, --reporter` allows specifying how results should be logged

#### Examples

```bash
# compile all assets once
$ clay compile

# compile and watch all assets
$ clay compile --watch

# compile all assets once for production environments
$ clay compile --minify

# compile all assets, creating both inlined and linked font CSS
$ clay compile --inlined --linked
```

### Media

```bash
clay compile media [--watch] [--reporter <reporter>]
```

Copy component, layout, style guide, and site-specific media files from their source folders to the `public` directory. Media files are images (`jpg`, `jpeg`, `png`, `gif`), `svgs`, and favicons (`ico`).

* `components/<name>/media/` are referenced by component templates and get copied to `public/media/components/<name>/`
* `layouts/<name>/media/` are referenced by layout templates and get copied to `public/media/layouts/<name>/`
* `styleguides/<name>/media/` are referenced by that styleguide's CSS and get copied to `public/media/stylesguides/<name>/`
* `sites/<name>/media/` are favicons and other site-specific icons that are referenced by particular components in the `<head>` of pages. They get copied to `public/media/sites/<name>/`

#### Arguments

* `-w, --watch` enables watching of source files after compilation
* `-r, --reporter` allows specifying how results should be logged

#### Examples

```bash
# compile media files once
$ clay compile media

# compile and watch media files
$ clay compile media --watch
```

### Fonts

```bash
clay compile fonts [--watch] [--minify] [--inlined] [--linked] [--reporter <reporter>]
```

Compile fonts from `styleguides/<name>/fonts/` to the `public` directory. By default (and if `--linked` is specified or `CLAYCLI_COMPILE_LINKED_FONTS` is set), this will generate a `public/css/_linked-fonts.<name>.css` file with `@font-face` declarations and copy the original font file to `public/fonts/`. Note that naming collisions are possible when using fonts of the same filename across different styleguides. If `--inlined` is specified (or `CLAYCLI_COMPILE_INLINED_FONTS` is set), this will generate a `public/css/_inlined-fonts.<name>.css` file with `@font-face` declarations that include a base64-encoded copy of the font.

`@font-face` declarations are generated based on the filename of the original font file, with a simple convention to support various weights and styles.

* `<name>.<ext>` font with normal weight and style
* `<name>-<weight>.<ext>` or `<name>-<style>.<ext>` specify a font weight _or_ style
* `<name>-<weight>-<style>.<ext>` specify a font weight _and_ style

All named and numbered font weights are supported, as well as the `italic` and `oblique` font styles. When referencing fonts in your CSS, use the (case-insensitive) `<name>` for your `font-family` rule so the `font-weight` and `font-style` rules will work as expected. Supported font extensions are `woff`, `woff2`, `otf`, and `ttf`.

Specifying `--minify` (or using `CLAYCLI_COMPILE_MINIFIED` or more specifically `CLAYCLI_COMPILE_MINIFIED_FONTS`) will run the generated font CSS through [`clean-css`](https://github.com/jakubpawlowicz/clean-css).

#### Arguments

* `-w, --watch` enables watching of source files after compilation
* `-m, --minify` enables minification of font CSS
* `-i, --inlined` enables the generation of base64 inlined font CSS
* `-l, --linked` enables the generation of linked font CSS
* `-r, --reporter` allows specifying how results should be logged

#### Examples

```bash
# compile linked fonts
$ clay compile fonts

# compile inlined fonts
$ clay compile fonts --inlined

# compile linked and inline fonts
$ clay compile fonts --inline --linked

# compile fonts once for production environments
$ clay compile fonts --minify
```

### Styles

```bash
clay compile styles [--watch] [--minify] [--plugins <space-separated list of postcss plugins>] [--reporter <reporter>]
```

Compile styleguide CSS files with PostCSS. Source files from `styleguides/<styleguide name>/components/<component name>.css` (and `styleguides/<styleguide name>/layouts/<layout name>.css`) will be compiled to `public/css/<component or layout name>.<styleguide name>.css`.

By default, styles will be compiled using the [`import`](https://github.com/postcss/postcss-import), [`autoprefixer`](https://github.com/postcss/autoprefixer), [`mixins`](https://github.com/postcss/postcss-mixins), [`nested`](https://github.com/postcss/postcss-nested), and [`simple-vars`](https://github.com/postcss/postcss-simple-vars) PostCSS plugins, but you may specify additional plugins (that you have installed with `npm`) into the `--plugins` argument.

Setting `CLAYCLI_COMPILE_ASSET_HOST` and `CLAYCLI_COMPILE_ASSET_PATH` will set the `$asset-host` and `$asset-path` variables, which allows linking to media hosted on other static file servers.

```scss
/* styleguides/example/components/example-component.css */
.some-twitter-icon {
  background-image: url('$asset-host/media/styleguides/example/twitter.svg');
  background-size: 22px 18px;
}
```

Specifying `--minify` (or using `CLAYCLI_COMPILE_MINIFIED` or more specifically `CLAYCLI_COMPILE_MINIFIED_STYLES`) will run the compiled CSS through [`clean-css`](https://github.com/jakubpawlowicz/clean-css).

#### Arguments

* `-w, --watch` enables watching of source files and their dependencies after compilation
* `-m, --minify` enables minification of CSS
* `-p, --plugins` allows running additional postcss plugins
* `-r, --reporter` allows specifying how results should be logged

#### Examples

```bash
# compile css
$ clay compile styles

# compile and watch css and any @import'ed css files
$ clay compile styles --watch

# compile css with additional postcss plugins
$ clay compile styles --plugins postcss-preset-env stylelint

# compile styles once for production environments
$ clay compile styles --minify
```

### Templates

```bash
clay compile templates [--watch] [--minify] [--reporter <reporter>]
```

Precompile handlebars template so they can be used by Kiln to re-render components (and layouts) on the client side. Note that it is strongly encouraged to enable minification even in dev environments, as specifying `--minify` (or using `CLAYCLI_COMPILE_MINIFIED` or more specifically `CLAYCLI_COMPILE_MINIFIED_TEMPLATES`) will minify the compiled templates with [UglifyJS](https://github.com/mishoo/UglifyJS) and bundle them into six files based on the component/layout name. Minifying the templates provides the best balance between file size and the number of files Kiln has to fetch on page load.

* `public/js/_templates-a-d.js`
* `public/js/_templates-e-h.js`
* `public/js/_templates-i-l.js`
* `public/js/_templates-m-p.js`
* `public/js/_templates-q-t.js`
* `public/js/_templates-u-z.js`

Templates will also be compiled to `public/js/<name>.template.js`.

#### Arguments

* `-w, --watch` enables watching of source files after compilation
* `-m, --minify` enables bundling of precompiled templates
* `-r, --reporter` allows specifying how results should be logged

#### Examples

```bash
# precompile handlebars templates
$ clay compile templates

# precompile and bundle templates
$ clay compile templates --minify

# precompile, bundle, and watch templates
$ clay compile templates --minify --watch
```

### Scripts

```bash
clay compile scripts [--watch] [--minify] [--globs <space-separated glob strings>] [--reporter <reporter>]
```

Compile component `client.js` and `model.js` files, kiln plugins, and legacy global JavaScript, while intelligently calculating and deduplicating dependencies. This generates a number of different types of files:

* `public/js/<name>.client.js` from compiled `client.js`
* `public/js/<name>.model.js` from compiled `model.js`
* `public/js/_models-<letter>-<letter>.js` from compiled and _bundled_ `model.js`
* `public/js/_kiln-plugins.js` from compiled kiln plugins in `services/kiln/`
* `public/css/_kiln-plugins.css` from compiled kiln plugin styles in their `.vue` components
* `public/js/_global.js` from compiled legacy scripts specified by the `--globs` argument
* `public/js/<number>.js` from compiled dependencies of `client.js`, `model.js`, kiln plugin, or global scripts
* `public/js/_deps-<letter>-<letter>.js` from compiled and bundled dependencies

This also creates a number of files that are used for instantiating component controllers, serving scripts, and speeding up incremental builds:

* `public/js/_client-init.js` script that instantiates `client.js` [component controllers which export a default function](https://claycms.gitbook.io/kiln/kiln-fundamentals/components#model-and-controller)
* `public/js/_prelude.js` dynamic bundler initialization script
* `public/js/_postlude.js` dynamic bundler access script, adds `window.require()` which enables loading of bundled dependencies
* `public/js/_ids.json` cache of module IDs, used when serving bundles
* `public/js/_registry.json` cache of module dependencies, used when serving bundles
* `client-env.json` environment variables in `model.js` and dependencies, must be added to `.gitignore` (values for these variables are [passed to Amphora via `env`](https://claycms.gitbook.io/amphora/startup/instantiation#instantiation-arguments) on server start)
* `browserify-cache.json` local cache for fast incremental builds, must be added to `.gitignore`

Specifying `--minify` (or using `CLAYCLI_COMPILE_MINIFIED` or more specifically `CLAYCLI_COMPILE_MINIFIED_SCRIPTS`) will run all compiled scripts through [`terser`](https://github.com/fabiosantoscode/terser).

This will also copy `clay-kiln-edit.js` and `clay-kiln-view.js` to `public/js` if you have Kiln installed. When you specify `--watch`, Kiln scripts will also be watched for changes.

#### Dependency Management

Any files you `require()` or `import` in your `client.js`, `model.js`, kiln plugins, or legacy global JavaScript are compiled to `<number>.js` and `_deps-<letter>-<letter>.js`, based on their name (for example, `lodash` might be compiled to `283.js` and `_deps-i-l.js`). When resolving media, call `claycli.compile.scripts.getDependencies()` in your Clay install's `resolveMedia` function to dynamically load necessary dependencies for view (`client.js` and legacy `_global.js`) and edit (`model.js` and kiln plugins) modes.

```js
// in your resolve-media service
const getDependencies = require('claycli').compile.scripts.getDependencies;

/**
 * Figure out what scripts and styles should be loaded on each page
 * @param  {object} media
 * @param  {array} media.scripts array of filenames from amphora
 * @param  {array} media.styles array of filenames from amphora
 * @param  {object} locals site info, edit mode info, etc from amphora
 */
function resolveMedia(media, locals) {
  const assetPath = locals.site.assetPath; // from site config

  // note: for this example, we're only dealing with scripts.
  // your own media resolution must also take into account styles, fonts, and templates
  if (locals.edit) {
    // edit mode, get script dependencies for linking (so, bundled / minified files)
    media.scripts = getDependencies(media.scripts, assetPath, { edit: true, minify: true });
  } else {
    // view mode, get script dependencies for inlining (so, individual dependency files)
    media.scripts = getDependencies(media.scripts, assetPath);
  }
}
```

By convention, internal services are specified in a `services/` directory at the root of your Clay install. Services that work in both the client and server live in `services/universal/` (or `services/isomorphic/` if you prefer). If you have `services/client/` and `services/server/` directories, `claycli` will automatically substitute server-side dependencies with their client-side equivalents when compiling. This is useful for database / API calls and wrappers around 3rd party libraries that have wildly different Node.js vs browser implementations.

#### Kiln Plugins

This will look for kiln plugins in `services/kiln/index.js`. You may specify vuex plugins, custom inputs, toolbar buttons, and pre-publish validators, [among other things](https://claycms.gitbook.io/kiln/api-documentation/api). For example, you might have one validator, one input, and one vuex plugin:

```js
// services/kiln/index.js
module.exports = () => {
  // add globals if they don't already exist
  window.kiln = window.kiln || {};
  window.kiln.validators = window.kiln.validators || {};
  window.kiln.inputs = window.kiln.inputs || {};
  window.kiln.plugins = window.kiln.plugins || {};
  // add your plugins into the globals
  window.kiln.validators['unique-url'] = require('./validate-unique-url');
  window.kiln.inputs['content-picker-button'] = require('./content-picker-button.vue');
  window.kiln.plugins['kiln-error-tracking'] = require('./kiln-tracking-plugin');
};
```

Any styles (denoted with `<style lang="postcss">` sections in your `.vue` components) will be extracted and bundled into `public/css/_kiln-plugins.css`, so please make sure to include it in your `resolveMedia` function in edit mode.

#### Legacy Global Scripts

If you have any legacy scripts that are not `require()`'d or `import`'d by your `client.js` or their dependencies, you may specify `--globs` to include them. They will be compiled and have their dependencies dynamically deduplicated in the same way as your other scripts, but will be served in view mode on _every page_.

#### Arguments

* `-w, --watch` enables watching of scripts and their dependencies after compilation
* `-m, --minify` enables minification of scripts
* `-g, --globs` allows compiling additional JavaScript
* `-r, --reporter` allows specifying how results should be logged

#### Examples

```bash
# compile scripts once
$ clay compile scripts

# compile and watch scripts and dependencies
$ clay compile scripts --watch

# compile scripts once for production environments
$ clay compile scripts --minify

# compile scripts, including legacy js
# note: this glob will match all '.js' files in 'global/js/' unless they end in '.test.js',
# which is a common unit testing convention
$ clay compile scripts --globs 'global/js/!(*.test).js'
```

### Project Specific Config File

Not all projects are the same, and for project specific compilation changes you can add a `claycli.config.js` file to your project's root. This file must simply export an Object whose contains key/value pairs are read during compilation. Good use cases for this file include:

* Adding PostCSS plugins to [`styles`](#styles) compilation
* Updating options passed into Autoprefixer
* Changing Babel browser target to meet your env support requirements

#### Arguments

The `claycli.config.js` file currently supports the following arguments:

* `plugins` (_Array_): list of PostCSS plugins that will be concatenated to the end of the list already supported by the `styles` compilation command
* `babelTargets` (_Object_): the value of this property is passed to the [Babel `targets` option](https://babeljs.io/docs/en/babel-preset-env#targets) to describe the environments your compiled scripts support
* `autoprefixerOptions` (_Object_): an Object which is [passed directly to `autoprefixer`](https://www.npmjs.com/package/autoprefixer#options) for style and Kiln plugin compilation
* `customTasks` (_Array_): an Array of Gulp tasks to execute with the `clay compile custom-tasks` command.

#### Example

```js
'use strict';

module.exports = {
  plugins: [
    require('postcss-functions')({
      functions: {
        em: function (pixels, browserContext) {
          var browserContext = parseInt(browserContext, 10) || 16,
            pixels = parseFloat(pixels);

          return pixels / browserContext + 'em';
        }
      }
    })
  ],
  babelTargets:  { browsers: ['> 2%'] },
  autoprefixerOptions: { browsers: ['last 2 versions', 'ie >= 9', 'ios >= 7', 'android >= 4.4.2'] },
  customTasks: [{
    name: 'foobar',
    fn: (cb) => {
      // A gulp task to execute
      cb();
    }
  }]
};
```

### Custom Gulp Tasks

Because not every implementation of Clay is the same, not all compilation will be the same. By adding custom Gulp tasks to your `claycli.config.js` file you can execute additional compilation/processing steps with claycli. Declare a `customTasks` array in your config file with each task being an object with two properties: `name` and `fn`. The `name` property will be the name of the step to execute and the `fn` property is the actual step to execute.

#### Example

For example, given the following `claycli.config.js` file:

```js
'use strict';

var { gulp } = require('claycli'),
  concat = require('gulp-concat'),
  uglify = require('gulp-uglify'),
  gutil = require('gulp-util'),
  argv = require('yargs').argv,
  gulpif = require('gulp-if');

module.exports = {
  customTasks: [
    {
      name: 'polyfill',
      fn: () => {
        return gulp.src([
          'global/polyfills.js',
          'global/modernizr.js'
        ])
        .pipe(concat('polyfills.js'))
        .pipe(gulpif(!argv.debug, uglify())).on('error', gutil.log)
        .pipe(gulp.dest('public/js'));
      }
    }
  ]
};
```
**Important Notes:**

1. Claycli exposes the instance of `gulp` that it uses to make sure there is consistency between internal tasks and external ones
2. This example of a custom task is all done inline, but the objects can be organized and managed in different files
3. When executing commands you have access to `argv` and can test options inside your custom functions.
4. Each task is executed in isolation. This is not a replacement for a complete Gulp pipeline, rather it is meant to patch small tasks that fall outside normal Clay compilation.

Executing `clay compile custom-tasks` will execute this task to produce a `polyfills.js` file.

## Programmatic API

The core `claycli` functionality is exposed as an api, allowing you to use it in Node.js. All main commands are properties of the exported `claycli` object.

```js
const { config, lint, import, export, compile } = require('claycli');
```

### Config

Get `key` or `url` from config

```js
config.get(type, alias);
```

Set `key` or `url` in config

```js
config.set(type, alias, value);
```

Get full configuration object

```js
config.getAll();
```

### Lint

Lint a url

```js
lint.lintUrl(url, { concurrency });
```

Lint a schema (passed in as a string of yaml)

```js
lint.lintSchema(yaml);
```

### Import

Import a string of dispatches or bootstraps to the specified (site prefix) url

```js
import(string, url, { key, concurrency, publish, yaml });
```

Parse a string of bootstrap data into a stream of prefixed dispatches. _Note: does NOT do http calls_

```js
import.parseBootstrap(string, url);
```

Parse an object of bootstrap data into a stream of prefixes dispatches. This method is good if you want to handle converting Yaml to JSON in your own application where you might need memoization. _Note: does NOT do http calls_

```js
import.parseBootstrapObject(obj, url);
```

Parse a string of dispatches into a stream of prefixed dispatches. _Note: does NOT do http calls_

```js
import.parseDispatch(string, url);
```

### Export

Export a single url, e.g. `domain.com/_components/foo` or `domain.com/_pages`

```js
export.fromURL(url, { concurrency, layout, yaml });
```

Export the results of a query (passed in as a string of yaml)

```js
export.fromQuery(url, query, { key, concurrency, layout, yaml, size });
```

Clear the layouts cache. When exporting pages with layouts, they'll be cached so they don't need to be exported for every page

```js
export.clearLayouts();
```

### Compile

_Note:_ There is currently no single `require('claycli').compile` method that will compile all assets. Please use the individual `media`, `fonts`, `styles`, `templates`, and `scripts` methods as needed.

Compile media files

```js
compile.media({ watch });
```

Compile fonts

```js
compile.fonts({ minify, watch, inlined, linked });
```

Compile styles

```js
compile.styles({ minify, watch, plugins });
```

Compile templates

```js
compile.templates({ minify, watch });
```

Compile scripts

```js
compile.scripts({ minify, watch, globs });
```

Calculate script dependencies. _Note:_ when calling this from `resolveMedia`, the first argument is `media.scripts`

```js
compile.scripts.getDependencies(scripts, assetPath, { edit, minify });
```
