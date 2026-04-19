'use strict';

const cookieParser = require('cookie-parser');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const authRouter = require('./routes/auth');
const uploadRouter = require('./routes/upload');
const queryRouter = require('./routes/query');
const modifyRouter = require('./routes/modify');
const requireJudgeSession = require('./middleware/requireJudgeSession');
const requirePoliceToken = require('./middleware/requirePoliceToken');
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

  if (config.enableDebugRoutes) {
    app.get('/__throw', (req, res, next) => {
      next(new Error('deliberate test error'));
    });

    app.get('/__police-only', requirePoliceToken, (req, res) => {
      res.json({ ok: true, userId: req.policeUserId });
    });

    app.get('/__judge-only', requireJudgeSession, (req, res) => {
      res.json({ ok: true, userId: req.judgeUserId });
    });
  }

  app.use(authRouter);
  app.use(uploadRouter);
  app.use(queryRouter);
  app.use(modifyRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
