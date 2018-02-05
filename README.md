# claycli
A CLI For Clay!

[![CircleCI](https://circleci.com/gh/clay/claycli.svg?style=svg)](https://circleci.com/gh/clay/claycli) [![Coverage Status](https://coveralls.io/repos/github/clay/claycli/badge.svg?branch=master)](https://coveralls.io/github/clay/claycli?branch=master)

# Installation

```
npm install -g claycli
```

# Usage

```
clay <command> [options]
```

If installed globally, you can simply call `clay` from the command line. Much like `git`, `claycli` can be configured using a `.clayconfig` file in your home folder. In it you can specify references to api keys, site prefixes, and files (or directories) that you use frequently. You'll reference them with the `--key`, `--site`, and `--file` options when using applicable `claycli` commands. For sites, it'll assume `http://` and port `80` unless you specify otherwise.

```
[keys]
  local = ha8yds9a8shdf98asdf
  qa = 8quwqwer09ewr0w9uer
  prod = bj34b6345k634jnk63n4
[sites]
  local-site1 = https://localhost.site1.com:3001
  local-site2 = localhost.site1.com/site-2 # http and port 80
[files]
  site1-bootstraps = ~/projects/clay/bootstraps
  users = ~/Desktop/users.json
```

For smaller Clay installations (or, ironically, for very large teams where devs spend most of their time on individual sites), you can specify a default api key and site by using the `CLAY_DEFAULT_KEY` and `CLAY_DEFAULT_SITE` environment variables.

## Commands

* [`config`](https://github.com/clay/claycli#config)
* [`touch`](https://github.com/clay/claycli#touch)
* [`import`](https://github.com/clay/claycli#import)
* [`export`](https://github.com/clay/claycli#export)
* [`lint`](https://github.com/clay/claycli#lint)
* [`create`](https://github.com/clay/claycli#create)
* [`clone`](https://github.com/clay/claycli#clone)
* `users` _(Coming Soon!)_
* `log` _(Coming Soon!)_

## Common Options

`claycli` uses some common options across many commands.

* `-v, --version` will print the `claycli` version and exit.
* `-h, --help` will print helpful info about `claycli` and various commands.
* `-V, --verbose` will print out helpful debugging messages as it runs commands.
* `-s, --site` allows a site url, uri (no protocol or port), or alias to a site specified in your `.clayconfig`. If this argument is not provided, `claycli` will use the value of the `CLAY_DEFAULT_SITE` environment variable.
* `-k, --key` allows an api key or an alias to a key specified in your `.clayconfig`. If this argument is not provided, `claycli` will use the value of the `CLAY_DEFAULT_KEY` environment variable.
* `-f, --file` imports or exports from a JSON or YAML file, and will recursively parse a folder of said files. Note that this may be slow when run against large folders.

## Config

```
clay config (keys|sites|files).<alias> <value>
```

Show or set configuration options, specifying either `keys`, `sites`, or `files` with an alias and value. As noted above, sites can be specified as urls or uris (with no protocol or port, it'll assume `http` and port `80`).

```
clay config sites.foo # prints url for site 'foo'

clay config keys.bar s8df7sd8 # sets apikey 'bar = s8df7sd8'

clay config files.foo bar.yaml # sets file shortcut 'foo = <current directory>/bar.yaml'
```

## Touch

```
clay touch <component> [--site] [--dry-run]
```

Do GET requests against every instance of a specific component to trigger component upgrades.

* `-n, --dry-run` will print the number of instances that'll be requested
* otherwise, it will run GET requests against all instances of the specified component

```
clay touch domain.com/components/article # GET all instances of 'article' on domain.com

clay touch article -s my-site # GET all instances of 'article' on my site
```

## Import

```
clay import [--site, --file, --page, --component] [--key] [--users, --lists] [--limit, --offset, --query] <site>
```

Imports data into Clay. You can import from:

* `stdin` (pipe to `clay import` from another cli tool, such as a 3rd party importer)
* `-s, --site <site>` a Clay site
* `-f, --file <path>` a YAML/JSON file (or directory of files)
* `-c, --component <uri>` a specific component url
* `--page <uri or url>` a specific page url

You can specify the site to import into with the same syntax as the `--site` option, e.g. alias or url. If you don't specify a site to import into, it'll use the `CLAY_DEFAULT_SITE` environment variable. If you don't specify a `--key` to use, it'll use the `CLAY_DEFAULT_KEY` environment variable.

When importing a `--site`, it will iterate through the most recently updated pages, importing each one. You can specify a `--limit` (defaults to 100) and `--offset` to import older or newer pages, or specity a `--query` pointing to a JSON/YAML file with an elasticsearch query. This query will be run against the built-in `pages` index in amphora.

By default, importing a site will import the latest pages and publish them if necessary. If you add the `--lists` option, it will import the `new-pages` list (and the pages specified therein) and any other lists on the origin site. If you add the `--users` option, it will import users.

If you specify a specific component or page url, `claycli` will import that item _and its child components_. It will not automatically publish an individually-imported page.

Importing from file(s) will import everything in those files, including lists, uris, users, components, and pages.

When writing importers that pipe to `claycli`, make sure you export your data in the form of `{ <uri minus site prefix>: data }`, e.g. `{ '/components/foo': { a: 'b' }}`. Importing from `stdin` will parse newline/EOF-delineated streams of those objects.

_Note that importing data may overwrite data on the site you're importing into!_

```
my-wordpress-to-clay-exporter | clay import # pipe from an importer to your CLAY_DEFAULT_SITE

clay import -s my-prod-site my-local-site # import 100 latest pages from production to a local dev environment

clay import -s stg.domain.com qa.domain.com -k qa # import from staging server to qa, providing the apikey for the qa server

clay import -f path/to/bootstraps/ my-local-site # import from a directory of yaml files

clay import -f ~/users.yaml qa.domain.com/my-site -k qa # import users from a file into a qa server

clay import -c domain.com/components/article/instances/a8d6s # only import this specific article into your CLAY_DEFAULT_SITE

clay import --page domain.com/pages/g7d6f8 qa -k qa # import a specific page into a qa server

clay import -s my-site -l 10 -o 100 my-local-site # import the latest 10 pages (offset by 100) into a local dev environment

clay import -s my-site -l 0 -u other-site # import only users (no pages, components, or lists)
```

## Export

```
clay export [--site, --page, --component] [--users, --lists] [--limit, --offset, --query] [file]
```

Exports data from Clay. You can export from:

* `-s, --site <site>` a Clay site
* `-c, --component <uri>` a specific component url
* `--page <uri or url>` a specific page url

You can specify either a YAML or JSON file to export to (by typing e.g. `path/to/file.json`), or export to `stdout` (in the same format that importing from `stdin` uses). If you specify a file path but no extension, it will default to `.yml`.

When exporting a `--site`, it will iterate through the most recently updated pages, exporting each one. You can specify a `--limit` (defaults to 100) and `--offset` to export older or newer pages, or specity a `--query` pointing to a JSON/YAML file with an elasticsearch query. This query will be run against the built-in `pages` index in amphora.

By default, exporting a site will export the latest pages. If you add the `--lists` option, it will export the `new-pages` list (and the pages specified therein) and any other lists on the origin site. If you add the `--users` option, it will export users.

If you specify a specific component or page url, `claycli` will export that item _and its child components_.

_Note that exporting data may overwrite files!_

```
clay export -s my-site | my-clay-to-wordpress-importer  # pipe from a site into an external importer

clay export -s my-prod-site # export 100 latest pages to stdout (good for sampling data)

clay export -s my-site backup.json # export site to json

clay export -s my-site ~/backups/my-site # export site to yaml

clay export -s my-site -l 0 -u users.yaml # export only users

clay export -c domain.com/components/article/instances/a8d6s article.json # export specific article

clay export --page domain.com/pages/g7d6f8 | clay import local-site # roundabout way to import from Clay to Clay
```

























Exports data from Clay. You can export to a YAML/JSON file by specifying a file path (it'll default to YAML if no extension is specified), or `stdout` (useful for exporting Clay data into non-Clay systems, and for linting). You can specify the site to export from _or a specific page/component_. If you don't specify a site, page, or component to export from, it'll use the `CLAY_DEFAULT_SITE` environment variable. Exporting pages and components will also export their children.

* `-n, --dry-run` will tell you the total number of components, pages, uris, and lists (but not users) that will be exported
* normally, if you export to a file, it'll warn you if the file already exists
* `--force` will suppress that warnings and overwrite the file
* `-u, --users` will export users as well as other site data
* `-l, --limit <number>` will limit a site export to the specified number of most recent pages

```
clay export # export CLAY_DEFAULT_SITE to stdout

clay export -s my-prod-site path/to/backup.json # export site data to json file

clay export -c domain.com/components/article/instances/g76s8d path/to/article-backup.yml # export specific article to yaml

clay export --page https://domain.com/2017-some-slug.html path/to/page-backup.yaml # export specific page (via public url) to yaml

clay export --page domain.com/pages/df6sf8 # export specific page (via page uri) to stdout

clay export -s my-site -l 10 path/to/cool-ten-articles.json # export latest ten pages to json

clay export # if no CLAY_DEFAULT_SITE is set, it'll interactively prompt for exporting
```

## Lint

```
clay lint [<url> or --file] [--site] [--recursive]
```

Lints Clay data and schemas against standardized conventions. Specify either a url or a `--file` option.

Linting against a component or page url (e.g. `domain.com/components/article/instances/s8d7h`) will check to see if that component references other components which don't exist on that clay instance, and will check the data against that component's schema. It will print warnings if it sees either issue.

Linting against a public url (if you specify the `--site` option) will check to see if that url exists in that site's `/uris/`. You can recursively (`--recursive`) lint _all_ components in a component, page, or public url.

Linting against a file or directory will do different things, depending on what path you specify:

* `clay lint -f path/to/schema.yml` (or `schema.yaml`) will lint the schema, checking for `_description` and printing a warning if it is not defined (once component versioning is added to Clay, it will check for `_version` as well)
* `clay lint -f path/to/some/other.yml` (or `*.yaml`, or `*.json`) will lint bootstrap data, checking to see if component references exist (similar to linting against a component url, but only looking at data in that bootstrap file)
* `clay lint path/to/directory` will do both of these actions, checking for component references in _any_ of the bootstrap files
* `-r, --recursive` will lint directories (or component urls) recursively

```
clay lint domain.com/components/layout/instances/article # lint a component

clay lint -f components/foo # lint the schema and bootstrap in a directory

clay lint -f www/my-project -r # lint schemas and bootstraps recursively

clay lint domain.com/components/layout/instances/article -r # lint everything in the layout AND its children
```

## Create

```
clay create component <component> [--dry-run, --force] [--description, --tag, --client, --model]
```

```
clay create site <site> [--dry-run, --force] [--name, --host, --path]
```

Interactively create components and sites. Most interactive options (`description`, `tag`, etc) can be passed in as cli options.

* `-n, --dry-run` will give info about the component or site that will be generated
* normally, it will warn you if the component or site already exists
* `--force` will suppress that warning and override the existing thing

For components, it will ask for description (which goes in the schema), html tag (defaults to `div`), and whether or not it should generate `client.js` and `model.js` files. Note: [Until `server.js` is fully removed from Amphora](https://github.com/nymag/amphora/tree/master/lib/routes#legacy-server-logic), it will generate passthrough `model.js` files regardless of what you specify.

* `-d, --description, "<text>"` is a human-readable description for the component, which should be wrapped in quotes
* `-t, --tag <tagname>` is the tag a component should use, or "layout" (for creating a layout) or "comment" (for creating head components)
* `-c, --client` will create a `client.js` file in the component
* `-m, --model` will create a `model.js` file in a component

For sites, it will ask for a display name, host, and path. Specify an empty path (or `/`) for sites at the root of the specified domain/host. It will generate a site with `config.yml`, `bootstrap.yml`, and `index.js` files.

* `-n, --name "<site name>"` is the human-readable display name of your site
* `-h, --host <hostname>` is the domain/host it should run on
* `--path <path>` is the path it should run on, if any

## Clone

```
clay clone component <component> [--dry-run, --force] [--description]
```

```
clay clone site <site> [--dry-run, --force] [--name, --host, --path]
```

Cloning components and sites works similarly to creating them, though the `component` subcommand only allows `description`. It will copy _all_ files from the original component/site into the cloned one, and update references in the `template.hbs`, `schema.yml`, `bootstrap.yml`, and `styles.scss` if they exist. Note that you may need to manually update your `client.js` or `model.js` to re-enable component logic.
