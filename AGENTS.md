# Clay CLI

A command-line interface for Clay CMS. Provides commands for importing, exporting, compiling, linting, configuring, and packing Clay components. Published as an npm package (`claycli`) with both CLI (`clay`) and programmatic API entry points.

## Non-Negotiables

- Never commit secrets, API keys, or `.npmrc` credentials
- Do not modify `.circleci/` config without approval
- Do not modify `package.json` publish/release scripts without approval
- All code must use `'use strict';` at the top of every file
- CommonJS modules only (`require`/`module.exports`) — do NOT use ESM (`import`/`export`)

## Development Commands

### Essential Commands
- `npm install` - Install dependencies
- `npm test` - Run lint + all tests (Jest)
- `npm run lint` - Lint code (ESLint)
- `npm run watch` - Run tests in watch mode (Jest --watch)

### Single Test File
- `npx jest path/to/file.test.js` - Run a specific test file

### Release
- `npm run release` - Release via CircleCI script (do not run locally without approval)

## Architecture Overview

The project has two entry points: a CLI (`cli/index.js`) invoked via `clay <command>` and a programmatic API (`index.js`) that exports command modules.

### Key Directories
- `cli/` - Yargs-based CLI entry points; each command is a yargs module
- `lib/` - Core library code shared between CLI and programmatic API
- `lib/cmd/` - Command implementations (compile, config, export, import, lint, pack)
- `lib/cmd/compile/` - Template/CSS/JS compilation pipeline using Webpack 5, Gulp 4, Babel, PostCSS 8
- `lib/cmd/pack/` - Webpack-based component packing
- `lib/reporters/` - Output formatters
- `lib/gulp-plugins/` - Custom Gulp plugins
- `website/` - Docusaurus documentation site (separate build system, see `website/AGENTS.md`)
- `docs/` - Documentation source files consumed by the website

### Technology Stack
- **Runtime:** Node.js >=20 (CommonJS modules, tested on Node 20/22)
- **CLI framework:** yargs
- **Build tooling:** Webpack 5, Gulp 4, Babel, PostCSS 8
- **Testing:** Jest 29 with jest-fetch-mock, mock-fs, jest-mock-console
- **Linting:** ESLint 9 (flat config: `eslint.config.js`)
- **CI:** CircleCI (test on Node 20/22, deploy docs, publish to npm)

## Code Conventions

### Style
- 2-space indentation
- Single quotes (`'avoid-escape'`)
- Semicolons required
- `1tbs` brace style (one true brace style)
- `vars-on-top` — declare variables at top of scope
- `newline-after-var` — blank line after variable declarations
- Named functions: no space before parens; anonymous functions: space before parens

### Patterns
- CommonJS `require`/`module.exports` throughout (NOT ESM)
- Lodash for utilities (babel-plugin-lodash optimizes imports)
- Native `fetch` for HTTP requests (Node 20+; mocked in tests via `jest-fetch-mock`)
- `async`/`await` and Promises for async control flow
- Highland.js streams retained in compile pipeline only (`lib/cmd/compile/`)
- Native `Buffer` for base64 encoding/decoding

### Complexity Limits (enforced by ESLint)
- Max cyclomatic complexity: 8
- Max nesting depth: 4
- Max function parameters: 4
- Max nested callbacks: 4

## Testing

- Tests are co-located with source: `foo.js` has `foo.test.js` in the same directory
- Global test setup in `setup-jest.js`: mocks `home-config` and sets up `jest-fetch-mock` globally
- Use `jest-fetch-mock` for HTTP request mocking (globally available as `fetch`)
- Use `mock-fs` for filesystem mocking
- Use `jest-mock-console` for console output assertions
- Coverage is collected automatically (configured in package.json)

## Definition of Done

- [ ] Tests pass (`npm test`)
- [ ] Lint clean (`npm run lint`)
- [ ] No debug logs or temporary code left in source
- [ ] New features include co-located test files
