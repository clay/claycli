# Explanation

The modules in this directory are meant to be Gulp plugins. Right now the `gulp-newer` package has changes we need to be released to NPM. Once that update happens we can go back to including in the package.json

There were issues with people npm installing claycli and having the package installed from github, so this is the workaround.

Need to delete the following packages once `gulp-newer` is released:

- glob
- kew
- plugin-error
