# `lib/cmd/rollup` — Rollup + esbuild pipeline

Parallel to **`lib/cmd/build`** (esbuild bundler). **Do not modify `lib/cmd/build`** for Rollup-specific behavior; change files here only.

## CLI

- `clay rollup` — one-shot build  
- `clay rollup --watch` — watch mode  

## How it relates to esbuild (`clay build`)

| Concern | esbuild (`build/`) | Rollup (`rollup/`) |
|--------|-------------------|-------------------|
| JS bundling | esbuild `splitting` | Rollup + `manualChunks` |
| Transpile / define / minify on chunks | esbuild plugins | `@rollup/plugin-esbuild` transform plugin (esbuild) |
| `_view-init`, kiln edit, globals entries | Generated in `build/scripts.js` | **Reuses** those generators (read-only `require`) |
| Styles, fonts, templates, vendor, media | `build/*.js` | **Reuses** same modules |
| `_manifest.json` / resolve-media | `build/get-script-dependencies.js` | Same manifest format; `rollup/index.js` re-exports resolution helpers |

## Sites opt-in

Set `CLAYCLI_BUNDLER=rollup` and run `clay rollup` (or `npm run build:rollup`) so `public/js` + `_manifest.json` match what `resolve-media` expects.
