'use strict';

const config = require('../config');
const tokenStore = require('../services/tokenStore');

/**
 * Police API: `X-Auth-Token` matches email OTP in tokenStore.
 * Default (`xAuthTokenSingleUse`): `consume` — one successful use invalidates the token.
 * Reuse mode: `peek` — valid until `OTP_TTL_MS` (set `X_AUTH_TOKEN_SINGLE_USE=0`).
 * `POST /api/auth/police-otp` always `consume`s the OTP.
 */
function requirePoliceToken(req, res, next) {
  const raw = req.get('X-Auth-Token');
  const token = raw != null ? String(raw).trim() : '';

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const out = config.xAuthTokenSingleUse
    ? tokenStore.consume(token)
    : tokenStore.peek(token);
  if (!out) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.policeUserId = out.userId;
  return next();
}

module.exports = requirePoliceToken;
