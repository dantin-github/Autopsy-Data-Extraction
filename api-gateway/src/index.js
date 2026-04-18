'use strict';

const config = require('./config');
const { createApp } = require('./app');
const { logger } = require('./logger');

const app = createApp();

app.listen(config.port, () => {
  logger.info({ port: config.port, nodeEnv: config.nodeEnv }, 'api-gateway listening');
});
