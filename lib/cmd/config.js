const config = require('../utils/config'),
  logger = require('../utils/logger');

function builder(yargs) {
  return yargs
    .usage('Usage: $0 config <alias> [value]')
    .example('$0 config keys.local', 'View local api key')
    .example('$0 config sites.local localhost:3001', 'Set localhost site alias')
    .option('site');
}

function handler(argv) {
  if (argv.alias && !argv.value) {
    // get value from .clayconfig
    try {
      let val = config.get(argv.alias);

      if (val) {
        logger.log(val);
      } else {
        logger.warn(`No value defined for "${argv.alias}"`);
      }
    } catch (e) {
      logger.error(e.message);
    }
  } else if (argv.alias && argv.value) {
    // set value in .clayconfig
    try {
      config.set(argv.alias, argv.value);
      logger.log(`Saved ${argv.alias.split('.')[0]} ${argv.alias.split('.')[1]} = ${argv.value}`);
    } catch (e) {
      logger.fatal(e.message);
    }
  }
}

module.exports = {
  command: 'config <alias> [value]',
  describe: 'View or set config variables',
  aliases: ['configure', 'cfg'],
  builder,
  handler
};
