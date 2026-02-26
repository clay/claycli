const h = require('highland'),
  config = require('../../config-file-helpers');

/**
 * Runs custom Gulp tasks defined in the claycli.config.js
 * file inside the project
 */
function compile(): { build: unknown } {
  const tasks = config.getConfigValue('customTasks') || [],
    stream = h(tasks)
      .map((task: { fn: () => unknown; name: string }) => {
        return h(task.fn())
          .map(() => ({ type: 'success', name: task.name }));
      })
      .merge();

  return {
    build: stream
  };
}

export = compile;
