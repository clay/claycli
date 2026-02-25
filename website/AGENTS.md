# Clay CLI Documentation Site

Docusaurus 1.x documentation site for Clay CLI. Separate from the main CLI project — has its own package.json, build system, and deployment.

## Commands

- `npm install` - Install website dependencies (run from `website/` directory)
- `npm start` - Start local dev server (`docusaurus-start`)
- `npm run build` - Build static site (`docusaurus-build`)
- `npm run deploy` - Deploy to GitHub Pages (`gh-pages -d build/claycli`)

## Architecture

- `siteConfig.js` - Docusaurus site configuration
- `sidebars.json` - Documentation sidebar structure
- `../docs/` - Markdown source files (live in parent `docs/` directory)

### Technology Stack
- **Framework:** Docusaurus 1.x
- **Deployment:** GitHub Pages via `gh-pages`
- **CI:** Deployed by CircleCI on master branch after tests pass

## Conventions

- Documentation source files live in `../docs/`, not in this directory
- Do not modify deployment scripts without approval
- Site builds are triggered by CircleCI, not run locally in production

## Definition of Done

- [ ] Site builds without errors (`npm run build`)
- [ ] Links and sidebar structure are valid
