const path = require('path');

function compile(filepath, argv) {
  const kilnPath = path.resolve(filepath, 'node_modules', 'clay-kiln', 'dist', 'clay-kiln-edit.js');
}

module.exports = compile;
