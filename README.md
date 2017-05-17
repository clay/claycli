--dry-run# clay-cli
A CLI For Clay!

[![CircleCI](https://circleci.com/gh/nymag/clay-cli.svg?style=svg)](https://circleci.com/gh/nymag/clay-cli) [![Coverage Status](https://coveralls.io/repos/github/nymag/clay-cli/badge.svg?branch=master)](https://coveralls.io/github/nymag/clay-cli?branch=master)

# Installation

```
npm install -g clay-cli
```

# Usage

```
clay <command> [options]
```

If installed globally, you can simply call `clay` from the command line. Much like `git`, `clay-cli` can be configured using a `.clayconfig` file in your home folder. In it you can specify references to api keys, site prefixes, and files (or directories) that you use frequently. You'll reference them with the `--key`, `--site`, and `--file` options when using applicable `clay-cli` commands. For sites, it'll assume `http://` and port `80` unless you specify otherwise.

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

* [`config`](https://github.com/nymag/clay-cli#config)
* [`touch`](https://github.com/nymag/clay-cli#touch)
* [`import`](https://github.com/nymag/clay-cli#import)
* [`export`](https://github.com/nymag/clay-cli#export)
* [`lint`](https://github.com/nymag/clay-cli#lint)
* [`create`](https://github.com/nymag/clay-cli#create)
* [`clone`](https://github.com/nymag/clay-cli#clone)
* `users` _(Coming Soon!)_
* `log` _(Coming Soon!)_

## Common Options

`clay-cli` uses some common options across many commands.

* `-v, --version` will print the `clay-cli` version and exit.
* `-h, --help` will print helpful info about `clay-cli` and various commands.
* `-V, --verbose` will print out helpful debugging messages as it runs commands.
* `-s, --site` allows a site url, uri (no protocol or port), or alias to a site specified in your `.clayconfig`. If this argument is not provided, `clay-cli` will use the value of the `CLAY_DEFAULT_SITE` environment variable.
* `-k, --key` allows an api key or an alias to a key specified in your `.clayconfig`. If this argument is not provided, `clay-cli` will use the value of the `CLAY_DEFAULT_KEY` environment variable.
* `-f, --file` imports or exports from a JSON or YAML file, and will recursively parse a folder of said files. Note that this may be slow when run against large folders.
* `-n, --dry-run` allows you to preview the results of a command without executing it for real. The output will depend on the specific command.
* `--force` allows you to silence confirmations and warnings. Use at your own risk!

## Config

```
clay config (key|site).<alias> <value>
```

Show or set configuration options, specifying either `key` or `site` with an alias and value. As noted above, sites can be specified as urls or uris (with no protocol or port, it'll assume `http` and port `80`).

```
clay config # interactively edit the config

clay config site.foo # prints url for site 'foo'

clay config key.bar s8df7sd8 # sets apikey 'bar = s8df7sd8'
```

## Touch

```
clay touch <component> [--site] [--dry-run, --force]
```

Do GET requests against every instance of a specific component to trigger component upgrades.

* `-n, --dry-run` will print the number of instances that'll be requested
* normally, it will print the number of instances and ask for confirmation before requesting each instance
* `--force` will request those instances without asking for confirmation

```
clay touch # interactively specify component and site to touch

clay touch article -s my-site # GET all instances of 'article' on my site
# it will print 'This will affect 203 instances of article. Continue [Y/n]?'
```

## Import

```
clay import [--site, --file, --page, --component] [--dry-run, --force, --key] [--users, --limit] <site>
```

Imports data into Clay. You can import from:

* `stdin` (pipe to `clay import` from another cli tool, such as a 3rd party importer)
* `-s, --site <site>` a Clay site
* `-f, --file <path>` a YAML/JSON file (or directory of files)
* `-c, --component <uri>` a specific component instance url
* `--page <uri or url>` a specific page url

If you specify a specific component instance or page url, `clay-cli` will import that item _and its children_. You can specify the site to import into with the same syntax as the `--site` option, e.g. alias, url, or uri. If you don't specify a site to import into, it'll use the `CLAY_DEFAULT_SITE` environment variable.

* `-n, --dry-run` will tell you the total number of components, pages, uris, and lists that will be imported
* normally, it will warn you when it encounters things that already exist (components, pages, uris, and lists, but not users)
* `--force` will suppress those warnings and overwrite data without pausing
* `-u, --users` will import users as well as other site data. If you're importing from a "users" bootstrap file, make sure to specify this!
* `-l, --limit <number>` will limit a site import to the specified number of most recent pages

```
my-wordpress-to-clay-exporter | clay import # pipe from an importer to your CLAY_DEFAULT_SITE

clay import -s my-prod-site my-local-site # import from production to a local dev environment

clay import -s stg.domain.com qa.domain.com -k qa # import from staging server to qa, providing the apikey for the qa server

clay import -f path/to/bootstraps/ my-local-site # import from a directory of yaml files

clay import -f ~/users.yaml qa.domain.com/my-site -u -k qa # import users from a file into a qa server

clay import -c domain.com/components/article/instances/a8d6s # only import this specific article into your CLAY_DEFAULT_SITE

clay import --page domain.com/2017-some-slug.html # import a specific page (via public url) into your CLAY_DEFAULT_SITE

clay import --page domain.com/pages/g7d6f8 qa -k qa # import a specific page (via page uri) into a qa server

clay import -s my-site -l 10 my-local-site # import the latest 10 pages into a local dev environment

clay import # if no stdin or input specified, it'll prompt for interactive importing
```

## Export

```
clay export [--site, --page, --component] [file] [--dry-run, --force] [--users, --limit]
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
clay lint [<url> or --file]
```

Lints Clay data, templates, and schemas against standardized conventions. If you specify neither a url nor a `--file` option, it will lint all components it can find in `stdin`.

Linting against a component url (e.g. `domain.com/components/article/instances/s8d7h`) will check to see if that component references other components which don't exist, and will check the data against that component's schema. It will print warnings if it sees either issue.

Linting against a file or directory will do different things, depending on what path you specify:

* `clay lint -f path/to/template.hbs` (or `.handlebars`) will lint the component template against the Clay coding conventions and print an error if it doesn't match our template rules
* `clay lint -f path/to/schema.yml` (or `schema.yaml`) will lint the schema, checking for `_description` or `_version` and printing a warning if they are not defined
* `clay lint -f path/to/some/other.yml` (or `*.yaml`, or `*.json`) will lint bootstrap data, checking to see if component references exist (similar to linting against a component url, above)
* `clay lint path/to/directory` will do all three of these actions recursively

```
clay export domain.com | clay lint # export to stdout and lint all components in a site

clay lint domain.com/components/layout/instances/article # lint an instance of the layout, looking for undefined components that this layout references

clay lint domain.com/components/image/instances/a8d7s # lint an image, checking its data against the schema

clay lint -f components/foo # lint the template, schema, and bootstrap

clay lint # if no arguments, it'll prompt for interactive linting
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
