const rest = require('../utils/rest');

module.exports.getComponentInstances = (prefix, name) => {
  return rest.get(`${prefix}/components/${name}/instances`);
};
