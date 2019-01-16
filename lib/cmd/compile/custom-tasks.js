'use strict';

const h = require('highland'),
  config = require('../../config-file-helpers');

/**
 * Runs custom Gulp tasks defined in the claycli.config.js
 * file inside the project
 *
 * @return {Object} with build (Highland Stream)
 */
function compile() {
  const tasks = config.getConfigValue('customTasks') || [], // grab the tasks
    stream = h(tasks) // Wrap in highland
      .map(task => {
        return h(task.fn()) // Excute task and wrap in highland
          .map(() => ({ type: 'success', name: task.name })); // If successful return a formatted object
      })
      .merge(); // Flatten out the streams into one

  return {
    build: stream
  };
}

module.exports = compile;
