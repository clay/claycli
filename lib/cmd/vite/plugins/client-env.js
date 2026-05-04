'use strict';

const fs = require('fs-extra');

const ENV_VAR_RE = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
const ENV_DESTRUCTURE_RE = /\{([\s\S]*?)\}\s*=\s*process\.env\b/g;

/**
 * Extract env var names from object-destructuring assignments on process.env.
 *
 * Supports forms like:
 *   const { FOO, BAR } = process.env;
 *   const { FOO: fooAlias, BAR = 'x' } = process.env;
 *
 * Any token that does not start with a valid all-caps env identifier
 * ([A-Z_][A-Z0-9_]*) is ignored.
 *
 * @param {string} code
 * @returns {string[]}
 */
function collectDestructuredEnvNames(code) {
  const names = [];

  for (const match of code.matchAll(ENV_DESTRUCTURE_RE)) {
    const rawFields = match[1]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    for (const rawField of rawFields) {
      const field = rawField
        .replace(/^\.\.\./, '')    // rest syntax
        .split(':')[0]             // alias syntax
        .split('=')[0]             // default-value syntax
        .trim();

      if (/^[A-Z_][A-Z0-9_]*$/.test(field)) {
        names.push(field);
      }
    }
  }

  return names;
}

/**
 * Factory for a shared process.env reference collector used across Rollup
 * build passes.
 *
 * ── Why this replaces the grep-based scan ───────────────────────────────────
 *
 * The previous approach (generateClientEnv) scanned the entire source tree
 * with a sequential fs.readFile loop on every build — O(N files), ~30s.
 * That scan also had no awareness of the module graph: it picked up
 * process.env references from server-only files (services/server/*, model.js
 * save hooks that call external APIs) and added them to client-env.json,
 * potentially leaking server secrets into the browser's window.process.env.
 *
 * With Vite + Rollup we already traverse every module in the graph during the
 * transform phase.  Collecting process.env references there adds only a regex
 * match to work Rollup is already doing — effectively free.
 *
 * ── Scope boundary (intentional) ────────────────────────────────────────────
 *
 * Only files that Rollup actually processes end up in the collected Set.
 * Files outside the module graph (pure server utilities, amphora route handlers,
 * anything not imported by vite-bootstrap.js or vite-kiln-edit-init.js) are
 * intentionally excluded.  Their process.env references are native Node.js
 * reads and should never be forwarded to the browser.
 *
 * ── Why both passes share one collector ─────────────────────────────────────
 *
 * The Vite pipeline runs two Rollup passes:
 *   Pass 1 (view)  — client.js + global/js files for public pages.
 *   Pass 2 (kiln)  — model.js + kiln.js for edit-mode saves in the browser.
 *
 * Both passes can reference process.env variables needed in the browser.
 * Sharing a single Set across both plugin instances ensures client-env.json
 * covers the full browser surface area in a single write.
 *
 * ── Watch mode note ──────────────────────────────────────────────────────────
 *
 * The collector's Set is append-only within a watch session.  If a developer
 * removes a process.env reference, the var stays in the Set until the next
 * full build.  This is intentional: stale entries in client-env.json are
 * harmless (the server injects undefined for missing vars), while a missing
 * entry silently breaks client-side code.
 *
 * @param {string} outputPath  Absolute path for the output client-env.json.
 * @returns {{ plugin: function(): object, write: function(): Promise<string[]> }}
 */
function createClientEnvCollector(outputPath) {
  const found = new Set();

  /**
   * Returns a Vite-compatible Rollup plugin instance that populates the
   * shared Set.
   *
   * Call once per build pass.  Each call returns a distinct plugin object but
   * all write to the same underlying Set.  The transform hook is purely
   * observational — it returns null so Rollup leaves the source unchanged.
   *
   * @returns {object}
   */
  function plugin() {
    return {
      name: 'clay-client-env',

      /**
       * Scan each module for process.env.VAR_NAME references and add the
       * variable name to the shared collector Set.
       *
       * Returning null signals to Rollup that no source transformation was
       * performed, preserving the original code exactly.
       *
       * @param {string} code
       * @returns {null}
       */
      transform(code) {
        for (const match of code.matchAll(ENV_VAR_RE)) {
          found.add(match[1]);
        }

        for (const varName of collectDestructuredEnvNames(code)) {
          found.add(varName);
        }
        return null;
      }
    };
  }

  /**
   * Write the accumulated env var names to client-env.json as a sorted array.
   *
   * Called once after all build passes complete so that a single atomic write
   * covers process.env references from both view-mode and kiln-mode modules.
   * Also called after each incremental rebuild in watch mode.
   *
   * amphora-html's addEnvVars() reads this file at server startup to determine
   * which process.env values to forward to the browser as window.process.env.
   *
   * @returns {Promise<string[]>} sorted list of var names written
   */
  async function write() {
    const vars = [...found].sort();

    await fs.outputJson(outputPath, vars, { spaces: 2 });
    return vars;
  }

  return { plugin, write };
}

module.exports = { createClientEnvCollector, collectDestructuredEnvNames };
