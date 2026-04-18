'use strict';

const express = require('express');
const config = require('./config');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  if (config.nodeEnv !== 'production') {
    app.get('/__throw', (req, res, next) => {
      next(new Error('deliberate test error'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
