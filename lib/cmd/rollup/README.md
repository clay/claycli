# Rollup + esbuild (distinct from `clay build`)

This pipeline is **not** a drop-in twin of `lib/cmd/build`. It is optimized for **Rollup chunking** + **esbuild transform/minify**.

## Bootstrap model

- **`.clay/rollup-bootstrap.js`** (generated) is the **only** view-mode JS entry.
- **First line:** `import './_globals-init.js'` so `window.DS` and globals run **before** any component code (ESM ordering — no multi-`<script>` race).
- **Then:** sticky events (from `stickyEvents` in `claycli.config.js`), dynamic `import()` map for every `components/**/client.js` and `layouts/**/client.js`, mount runtime.
- **Kiln** stays a separate pass (`_kiln-edit-init`) for edit mode only.

## Manifest

`_manifest.json` is **minimal**: `.clay/rollup-bootstrap`, `.clay/_kiln-edit-init`. There are **no per-component manifest keys** — components exist only as dynamic chunks.  
Anything that relied on `getDependenciesNext` + per-component manifest keys under Rollup will need a different code path.

## View mode scripts

**One** `<script type="module">` URL (the bootstrap file). The browser loads static dependency chunks (globals) via the module graph.

## Shared with `build/` (pragmatic)

- `generateKilnEditEntry`, `generateGlobalsInitEntry` (source for `_globals-init.js`)
- Styles, fonts, templates, vendor, media, `generateClientEnv`

## Commands

`clay rollup` / `clay rollup --watch`
