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

If installed globally, call `clay` from the command line. Much like `git`, `claycli` is configured using a [dotfile](https://medium.com/@webprolific/getting-started-with-dotfiles-43c3602fd789) (`.clayconfig`) in your home folder. In it you may specify references to api keys and urls / site prefixes that you use frequently. For urls and site prefixes, it will assume `http://` and port `80` unless you specify otherwise.

Note that a _site prefix_ is everything before the api route, e.g. `http://domain.com/site1` in `http://domain.com/site1/_components/article`.

```
[keys]
  local = ha8yds9a8shdf98asdf
  qa = 8quwqwer09ewr0w9uer
  prod = bj34b6345k634jnk63n4
[urls]
  local-site1 = https://localhost.site1.com:3001
  local-site2 = site2.com/site-2 # http and port 80
```

For smaller Clay installations (or, ironically, for very large teams where devs spend most of their time on individual sites), you may specify a default api key and url / site prefix by using the `CLAYCLI_DEFAULT_KEY` and `CLAYCLI_DEFAULT_URL` environment variables.

# Commands

* [`config`](https://github.com/clay/claycli#config)
* [`lint`](https://github.com/clay/claycli#lint)
* [`import`](https://github.com/clay/claycli#import)
* [`export`](https://github.com/clay/claycli#export)

## Common Arguments

`claycli` uses some common arguments across many commands.

* `-v, --version` will print the `claycli` version and exit
* `-h, --help` will print helpful info about `claycli` and exit
* `-r, --reporter` allows specifying how results should be logged
* `-c, --concurrency` allows setting the concurrency of api calls (defaults to 10)
* `-k, --key` allows specifying an api key or alias

### Logging

When running `claycli` programmatically (i.e., `import { someMethod } from 'claycli'`), most commands will return a stream of objects with `{ type, message, details }`. The `type` may be `success` (signalling that an operation succeeded), `error`, `warning`, `info`, or `debug`. As you can see, most of those correspond directly to log levels.

When running `claycli` from the command line, you may specify a `reporter` argument to output logs in different formats. The default is `dots`, which will print out green and red dots showing operation success / failure. There is also `pretty` (which prints more detailed messages on each line), `json` (which prints newline-separated json logs in a format that can be passed to ELK), and `nyan` (which is mostly just for fun).

```bash
clay lint --reporter pretty domain.com/_components/article
```

You may also specify with reporter to use by setting the `CLAYCLI_REPORTER` environment variable. If you add a `reporter` argument, it will be used instead of the env variable.

```bash
export CLAYCLI_REPORTER=json
```

`claycli` pipes to `stderr`. If you want to pipe the logs to a file, you may use `2>`.

```bash
`clay lint --reporter json domain.com/_components/article 2> article-log.json`
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
clay export domain.com > article_dump.clay
clay import domain.com < article_dump.clay
clay export domain.com | clay import localhost
```

### Bootstrap

For working with human-readable data, we use a format called a _bootstrap_. These are human-readable [yaml](http://docs.ansible.com/ansible/latest/YAMLSyntax.html) files that divide components (and pages, users, lists, etc) by type. [This is the same format that is used by the `bootstrap.yml` files in your Clay install](http://clay.github.io/amphora/docs/lifecycle/startup/bootstrap.html).

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
clay export --yaml domain.com > article_dump.yml
clay import --yaml domain.com < article_dump.yml
```

If you're a backend developer or database architect, it may be helpful to think of _dispatches_ and _bootstraps_ as [denormalized and normalized data](https://medium.com/@katedoesdev/normalized-vs-denormalized-databases-210e1d67927d). You'll notice that the two examples above contain the same data. The denormalized _dispatches_ allow a single API call per line and use less memory because they're streamable, while the normalized _bootstraps_ are better for hand-coding data because components are not duplicated if referenced multiple times. Generally speaking, use _dispatches_ for transporting and storing data and _bootstraps_ for hand-coding.

## Config

```bash
clay config --key <alias> [value]
clay config --url <alias> [value]
```

Show or set configuration options. These are saved to `~/.clayconfig`. As specified above, sites will assume `http` and port `80` if you do not write the protocol and port.

### Arguments

* `-k, --key` allows viewing or saving an api key
* `-u, --url` allows viewing or saving a url / site prefix
* `-r, --reporter` allows specifying how results should be logged (note: all reporters except `json` report `clay config` the same)

### Examples

```bash
clay config # view all configuration options
clay config --key local # view 'local' api key
clay config --key local ab27s9d # set 'local' api key
clay config --url qa # view 'qa' site prefix
clay config --url qa https://qa.domain.com:3001 # set 'qa' site prefix
clay config --url my-cool-article domain.com/_components/article/instances/123 # set a specific url
```

## Lint

```bash
clay lint [--concurrency <number>] [url]
```

Verify Clay data against standardized conventions and make sure all child components exist.

Linting a page, component, or user url will verify that the data for that url exists, and (for pages and components) will (recursively) verify that all references to child components exist. The url must be a raw url, an alias specified via `clay config`, or omitted in favor of `CLAYCLI_DEFAULT_URL`.

Instead of linting a url, you may pipe in a component's `schema.yml` to lint. It will go through the schema and verify that it conforms to [Kiln's schema rules](https://claycms.gitbooks.io/kiln/editing-components.html).

### Arguments

* `-r, --reporter` allows specifying how results should be logged
* `-c, --concurrency` allows setting the concurrency of api calls

### Examples

```bash
clay lint domain.com/_pages/123 # lint all components on a page
clay lint domain.com/2018/02/some-slug.html # lint a page via public url
clay lint my-cool-article # lint a component specified via config alias
clay lint < components/article/schema.yml # lint single schema
```

## Import

```bash
clay import [--key <api key>] [--concurrency <number>] [--publish] [--yaml] [site prefix]
```

Imports data into Clay from `stdin`. Data may be in _dispatch_ or _bootstrap_ format. Site prefix must be a raw url, an alias specified via `clay config`, or omitted in favor of `CLAYCLI_DEFAULT_URL`. Key must be an alias specified via `clay config`, or omitted in favor of `CLAYCLI_DEFAULT_KEY`.

The `publish` argument will trigger a publish of the pages and / or components you're importing. Note that the generated url of an imported page might be different than its original url, depending on your Clay url generation / publishing logic.

### Arguments

* `-k, --key` allows specifying an api key or alias
* `-r, --reporter` allows specifying how results should be logged
* `-c, --concurrency` allows setting the concurrency of api calls
* `-p, --publish` triggers publishing of imported pages
* `-y, --yaml` specifies that input is _bootstrap_ format

### Examples

```bash
clay import --key local localhost:3001 < db_dump.clay # import a dispatch
clay import --key qa --publish --yaml < bootstrap.yml # import and publish pages in a bootstrap
wordpress-export domain.com/blog | clay import --key local localhost.domain.com # pipe from 3rd party exporter
clay export --key prod domain.com/_components/article/instances/123 | clay import --key local localhost.domain.com # pipe from clay exporter
cat *.clay | clay import --key local localhost:3001 # import multiple dispatches
tail -n +1 *.yml | clay import --key local --yaml localhost:3001 # import multiple bootstraps
find . -name '*.yml' -exec cat "{}" \; | clay import --key local --yaml localhost:3001 # recursively import multiple bootstraps
cat **/*.yml | clay import --key local --yaml localhost:3001 # recursively import multiple bootstraps (bash v4+ & zsh)
```

## Export

```bash
clay export [--key <api key>] [--concurrency <number>] [--size <number>] [--layout] [--yaml] [url]
```

Exports data from Clay to `stdout`. Data may be in _dispatch_ or _bootstrap_ format. The url must be a raw url, an alias specified via `clay config`, or omitted in favor of `CLAYCLI_DEFAULT_URL`.

If the url points to a site prefix (i.e. it does not point to a specific type of data (a specific page, public url, component, user, list, etc)), `claycli` will query the built-in `pages` index to pull the latest 10 pages from the site. When querying the `pages` index, you must specify a `key` or have the `CLAYCLI_DEFAULT_KEY` set. The api key is only required when exporting multiple pages (by querying the `pages` index or by running custom queries, below).

Instead of fetching the latest pages, you may pipe in a yaml-formatted [elasticsearch query](https://www.elastic.co/guide/en/elasticsearch/reference/current/_introducing_the_query_language.html). Use this to set custom offsets (for batching and chunking exports), export non-page content from other indices, or filter exported data via certain properties. Note that if you pipe in a query that includes `size`, it will take precedence over the CLI `size` argument.

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
          prefix:
            uri: domain.com/site-path # show only pages for a specific site
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
clay export domain.com/_components/article/instances/123 > article_dump.clay # export individual component
clay export --yaml domain.com/_pages/123 > page_bootstrap.yml # export individual page
clay export --layout --yaml domain.com/_pages/123 > page_bootstrap.yml # export page with layout
clay export domain.com/_pages/123 | clay import --key local local.domain.com # copy page to local environment
clay export --key prod --size 1 domain.com > recent_page.clay # export latest updated page
cat query.yml | clay export --key prod domain.com > db_dump.clay # export custom query to dispatch
clay export --yaml --key prod domain.com/sub-site < query.yml > pages.yml # export custom query to bootstrap

# note that 'cat query.yml | clay export' and 'clay export < query.yml' are equivalent ways
# to pipe from a file into claycli in most operating systems

# other things you may export

clay export domain.com/_users/abs8a7s8d --yaml > my_user.yml # export single user
clay export domain.com/_users --yaml > users.yml # export all users
clay export domain.com/_lists/tags > tags.clay # export single list
clay export domain.com/_lists > lists.clay # export all lists
clay export domain.com/2017/02/some-slug.html # export published page via public url
clay export domnain.com/_lists/new-pages # export built-in 'New Page Templates' list (page uris will be unprefixed)
```

# Contributing

Pull requests and stars are always welcome. For bugs and feature requests, [please create an issue](https://github.com/clay/claycli/issues/new).

This project is released under the [MIT license](https://github.com/clay/claycli/blob/master/LICENSE).
