'use strict';

const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: config.nodeEnv === 'test' ? 'silent' : process.env.LOG_LEVEL || 'info'
});

module.exports = { logger };
