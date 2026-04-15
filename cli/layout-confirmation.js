'use strict';
const readline = require('readline');

const LAYOUT_CONFIRM_TOKEN = 'LAYOUT';

/**
 * Require an explicit confirmation whenever --layout is enabled.
 * In non-interactive environments, users must pass --yes-layout.
 *
 * @param {object} argv
 * @param {string} commandName
 * @returns {Promise<void>}
 */
async function ensureLayoutConfirmation(argv, commandName) {
  if (!argv.layout) return;
  if (argv.yesLayout) return;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`--layout requires confirmation for ${commandName}. Re-run with --yes-layout.`);
  }

  const answer = await askQuestion(`--layout can modify layout references for ${commandName}. Type ${LAYOUT_CONFIRM_TOKEN} to continue: `);

  if (answer !== LAYOUT_CONFIRM_TOKEN) {
    throw new Error('Layout confirmation did not match. Aborting without changes.');
  }
}

/**
 * Ask a single stdin question and resolve with the response string.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
function askQuestion(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

module.exports.ensureLayoutConfirmation = ensureLayoutConfirmation;
