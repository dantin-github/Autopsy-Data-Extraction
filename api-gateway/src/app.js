'use strict';

const cookieParser = require('cookie-parser');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const chain = require('./services/chain');
const authRouter = require('./routes/auth');
const uploadRouter = require('./routes/upload');
const queryRouter = require('./routes/query');
const modifyRouter = require('./routes/modify');
const auditRouter = require('./routes/audit');
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
    const reg = String(config.caseRegistryAddr || '').trim();
    const regOk = /^0x[0-9a-fA-F]{40}$/i.test(reg);
    const addrTail =
      regOk && reg.length >= 8
        ? reg.replace(/^0x/i, '').toLowerCase().slice(-6)
        : null;
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      gateway: {
        chainMode: config.chainMode,
        chainConfigured: chain.isChainConfigured(),
        caseRegistryConfigured: regOk,
        caseRegistryAddrTail: addrTail,
        uploadContractPathEnabled: config.uploadContractEnabled()
      }
    });
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
  app.use(auditRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
