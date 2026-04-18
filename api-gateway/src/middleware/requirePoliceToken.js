'use strict';

const tokenStore = require('../services/tokenStore');

/**
 * Police API: one-time OTP in X-Auth-Token (consumed from tokenStore).
 */
function requirePoliceToken(req, res, next) {
  const raw = req.get('X-Auth-Token');
  const token = raw != null ? String(raw).trim() : '';

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const out = tokenStore.consume(token);
  if (!out) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.policeUserId = out.userId;
  return next();
}

module.exports = requirePoliceToken;
