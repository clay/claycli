# clay-cli
A CLI For Clay!

[![CircleCI](https://circleci.com/gh/nymag/clay-cli.svg?style=svg)](https://circleci.com/gh/nymag/clay-cli) [![Coverage Status](https://coveralls.io/repos/github/nymag/clay-cli/badge.svg?branch=master)](https://coveralls.io/github/nymag/clay-cli?branch=master)

# Installation

```
npm install -g clay-cli
```

# Usage

```
clay <command> <argument> [options]
```

If installed locally, you can simply call `clay` from the command line. Arguments and options can be used in any order. Much like `git`, `clay-cli` can be configured using a `.clayconfig` file in your home folder. Keys and sites can be called anything, as you'll reference them with the `--key` and `--site` options when using `clay-cli`. For sites, it'll assume `http://` and port `80` unless you specify otherwise.

```
[keys]
  local = ha8yds9a8shdf98asdf
  qa = 8quwqwer09ewr0w9uer
  prod = bj34b6345k634jnk63n4
[sites]
  local-site1 = https://localhost.site1.com:3001
  local-site2 = localhost.site1.com/site-2 # http and port 80
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
* `-s, --site` allows a site url, uri (no protocol or port), or alias to a site specified in your `.clayconfig`. If this argument is not provided, `clay-cli` will use the value of the `CLAY_DEFAULT_SITE` environment variable.
* `-k, --key` allows an api key or an alias to a key specified in your `.clayconfig`. If this argument is not provided, `clay-cli` will use the value of the `CLAY_DEFAULT_KEY` environment variable.
* `-f, --file` imports or exports from a JSON or YAML file, and will recursively parse a folder of said files. Note that this may be slow when run against large folders.
* `-p, --preview` allows you to preview the results of a command without executing it for real. The output will depend on the specific command.
* `--force` allows you to silence confirmations and warnings. Use at your own risk!

## Config

```
clay config (key|site) <alias> <value>
```

Show or set configuration options, specifying either `key` or `site` with an alias and value. As noted above, sites can be specified as urls or uris (with no protocol or port, it'll assume `http` and port `80`).

```
clay config # prints full config

clay config site foo # prints url for site 'foo'

clay config key bar s8df7sd8 # sets apikey 'bar = s8df7sd8'
```

## Touch

```
clay touch <component> [--site, --key, --preview, --force]
```

Do GET requests against every instance of a specific component to trigger component upgrades.

* `-p, --preview` will print the number of instances that'll be requested
* normally, it will print the number of instances and ask for confirmation before requesting each instance
* `--force` will request those instances without asking for confirmation

```
clay touch article -s my-site # GET all instances of 'article' on my site
# it will print 'This will affect 203 instances of article. Continue [Y/n]?'
```

## Import

```
clay import [--site, --file, --preview, --force, --key, --users] <site>
```

Imports data into Clay. You can import from a Clay site (with `--site`), a YAML/JSON file (or directory of files) with `--file`, or `stdin` (useful for importing to Clay from non-Clay systems). You can specify the site to import into the same way you use the `--site` option, e.g. alias, url, or uri. If you don't specify a site to import into, it'll use the `CLAY_DEFAULT_SITE` environment variable.

* `-p, --preview` will tell you the total number of components, pages, uris, and lists that will be imported
* normally, it will warn you when it encounters things that already exist (components, pages, uris, and lists)
* `--force` will suppress those warnings and overwrite data without pausing
* `-u, --users` will import users as well as other site data. If you're importing from a "users" bootstrap file, make sure to specify this!

```
my-wordpress-to-clay-exporter | clay import # pipe from an importer to your CLAY_DEFAULT_SITE

clay import -s my-prod-site my-local-site # import from production to a local dev environment

clay import -f path/to/bootstraps/ my-local-site # import from a directory of yaml files
```

## Export

```
clay export <site> [--file, --preview, --force, --users]
```

Exports data from Clay. You can export to a YAML/JSON file with `--file` (it'll default to YAML if no extension is specified), or `stdout` (useful for exporting Clay data into non-Clay systems, and for linting). You can specify the site to export from the same way you use the `--site` option, e.g. alias, url, or uri. If you don't specify a site to export from, it'll use the `CLAY_DEFAULT_SITE` environment variable.

* `--preview` will tell you the total number of components, pages, uris, and lists that will be exported
* normally, if you export to a file, it'll warn you if the file already exists
* `--force` will suppress that warnings and overwrite the file
* `-u, --users` will export users as well as other site data

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
```

## Create



## Clone
