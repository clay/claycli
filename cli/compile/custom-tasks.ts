const compile = require('../../lib/cmd/compile'),
  options = require('../cli-options'),
  term = require('terminal-logger')('pretty');

term.level = 'debug';

function builder(yargs: any) {
  return yargs
    .usage('Usage: $0 custom-tasks')
    .example('$0 custom-tasks', 'run custom tasks defined in the claycli.config.js file `customTasks` property')
    .option('r', options.reporter);
}

function handler() {
  const tasks = compile.customTasks();

  return tasks.build // This is a highland stream
    .errors((error: any, push: any) => {
      // Push the error back into the stream in a format we can use
      push(null, { type: 'error', error });
    })
    .toArray((arr: any) => {
      // Print the status of each task
      arr.forEach((task: any) => {
        if (task.type === 'success') {
          term.status.ok(`Successfully ran task: ${task.name}`);
        } else {
          term.cross(`Error running task: ${task.error.stack}`);
        }
      });
    });
}

export = {
  command: 'custom-tasks',
  describe: 'Run any custom tasks. Each task will be wrapped by Gulp',
  builder,
  handler
};
