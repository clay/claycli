import _ from 'lodash';

const dots = require('./dots');
const pretty = require('./pretty');
const json = require('./json');
const nyan = require('./nyan');

const reporters: Record<string, Record<string, (...args: unknown[]) => void>> = {
  dots, pretty, json, nyan
};

interface Summary {
  success: boolean;
  message: string;
}

/**
 * reporter is passed in via argument, or env variable, or defaults to 'dots'
 */
function getReporter(reporter?: string): string {
  return reporter || process.env.CLAYCLI_REPORTER || 'dots';
}

/**
 * simple log passthrough
 */
function log(reporter: string | undefined, command: string): (message: string) => void {
  const resolved = getReporter(reporter);

  return (message) => {
    if (_.has(reporters, `${resolved}.log`)) {
      reporters[resolved].log(message, command);
    }
  };
}

/**
 * log individual actions
 */
function logAction(reporter: string | undefined, command: string): (action: unknown) => unknown {
  const resolved = getReporter(reporter);

  return (action) => {
    // only log actions, not data
    if (_.isObject(action) && _.has(action, 'type') && _.has(reporters, `${resolved}.logAction`)) {
      reporters[resolved].logAction(action, command);
    }
    return action; // pass it on
  };
}

/**
 * log summary of results
 */
function logSummary(
  reporter: string | undefined,
  command: string,
  summary: (successes: number, errors: number) => Summary
): (results: unknown[]) => void {
  const resolved = getReporter(reporter);

  return (results) => {
    if (_.has(reporters, `${resolved}.logSummary`)) {
      reporters[resolved].logSummary(summary, results, command);
    }
  };
}

export { log, logAction, logSummary };
