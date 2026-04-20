'use strict';

const { logger } = require('../logger');

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not Found' });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const status = Number(err.status || err.statusCode) || 500;

  if (status >= 500) {
    logger.error(
      { err: { message: err.message, code: err.code, stack: err.stack }, path: req.path },
      'request failed'
    );
  } else {
    logger.warn(
      { err: { message: err.message, code: err.code }, path: req.path },
      'request error'
    );
  }

  const body =
    status >= 500
      ? { error: 'Internal Server Error' }
      : { error: err.message || 'Bad Request' };

  if (status < 500 && err.chainError) {
    body.chainError = err.chainError;
  }

  res.status(status).json(body);
}

module.exports = { notFoundHandler, errorHandler };
