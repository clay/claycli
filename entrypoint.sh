#!/bin/sh

set -e

cd $BUILD_DIR

echo "#################################################"
echo "Now deploying to GitHub Pages..."
npm install && \
npm run build && \
REMOTE_REPO="https://${GH_PAT}@github.com/clay/claycli" && \
git init && \
git config --global user.name "${GITHUB_ACTOR}" && \
git config --global user.email "${GITHUB_ACTOR}@users.noreply.github.com" && \
git remote add origin "${REMOTE_REPO}" && \
npm run deploy && \
rm -rf .git && \
echo "Deployed"
