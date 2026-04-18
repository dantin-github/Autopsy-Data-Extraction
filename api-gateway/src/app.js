'use strict';

const cookieParser = require('cookie-parser');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const authRouter = require('./routes/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(
    session({
      name: 'gw.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        maxAge: 30 * 60 * 1000,
        sameSite: 'lax'
      }
    })
  );

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  if (config.nodeEnv !== 'production') {
    app.get('/__throw', (req, res, next) => {
      next(new Error('deliberate test error'));
    });
  }

  app.use(authRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
