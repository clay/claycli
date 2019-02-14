You will need to to have `Node >= 8.x` and `Yarn >= 1.5`.

# Run the local server

1. Make sure all the dependencies for the website are installed:

```sh
$ yarn
```
or
```sh
$ npm install
```

2. Go to the `website` directory and run your dev server:

```sh
$ yarn start
```
or
```sh
$ npm run start
```

## Directory Structure

Your project file structure should look something like this

```
my-docusaurus/
  docs/
    cli.md
  website/
    blog/
    core/
    node_modules/
    pages/
    static/
      css/
      img/
    versioned_docs/
    versioned_sidebars/
    README.md
    package.json
    sidebar.json
    siteConfig.js
    versions.json
```

# Publish the website
The Claycli website will live on GitHub page. You just need to run the following commands:
```
$ yarn build
```
or
```
$ npm run build
```

Then you just need to deploy the static files generated. These files will be pushed to the `gh-page` branch.
```
$ yarn deploy
```
or
```
$ npm run deploy
```
