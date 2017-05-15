'use strict';
const sinonChai = require('sinon-chai');

global.chai = require('chai');
global.expect = chai.expect;
global.sinon = require('sinon');
chai.use(sinonChai);
