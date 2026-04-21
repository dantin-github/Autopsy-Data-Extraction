'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const config = require('./config');
const { createApp } = require('./app');
const { logger } = require('./logger');
const eventListener = require('./services/eventListener');
const userStore = require('./services/userStore');

if (config.autoSeedRoles) {
  const apiRoot = path.join(__dirname, '..');
  const script = path.join(apiRoot, 'scripts', 'seed-roles.js');
  logger.info('AUTO_SEED_ROLES: running scripts/seed-roles.js --ensure');
  const r = spawnSync(process.execPath, [script, '--ensure'], {
    cwd: apiRoot,
    stdio: 'inherit',
    env: process.env
  });
  if (r.error) {
    logger.warn({ err: r.error.message }, 'seed-roles spawn failed');
  } else if (r.status !== 0) {
    logger.warn(
      { exitCode: r.status },
      'seed-roles --ensure failed (chain offline, missing CASE_REGISTRY_ADDR, or users not ready); continuing startup'
    );
  } else {
    userStore.clearCache();
    logger.info('seed-roles --ensure ok; user store cache cleared');
  }
}

const app = createApp();

app.listen(config.port, () => {
  logger.info({ port: config.port, nodeEnv: config.nodeEnv }, 'api-gateway listening');
  eventListener.start();
});
