'use strict';

const compile = require('../../lib/cmd/compile'),
  options = require('../cli-options'),
  term = require('terminal-logger')('pretty');

term.level = 'debug';

function builder(yargs) {
  return yargs
    .usage('Usage: $0 custom-tasks')
    .example('$0 custom-tasks', 'run custom tasks defined in the claycli.config.js file `customTasks` property')
    .option('r', options.reporter);
}

function handler() {
  const tasks = compile.customTasks();

  return tasks.build // This is a highland stream
    .errors((error, push) => {
      // Push the error back into the stream in a format we can use
      push(null, { type: 'error', error });
    })
    .toArray(arr => {
      // Print the status of each task
      arr.forEach(task => {
        if (task.type === 'success') {
          term.status.ok(`Successfully ran task: ${task.name}`);
        } else {
          term.cross(`Error running task: ${task.error.stack}`);
        }
      });
    });
}

module.exports = {
  command: 'custom-tasks',
  describe: 'Run any custom tasks. Each task will be wrapped by Gulp',
  builder,
  handler
};
