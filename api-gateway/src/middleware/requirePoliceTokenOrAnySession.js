'use strict';

const requirePoliceToken = require('./requirePoliceToken');
const requireAnySession = require('./requireAnySession');

/**
 * Police `X-Auth-Token` (requirePoliceToken) or an established police/judge session (requireAnySession).
 */
function requirePoliceTokenOrAnySession(req, res, next) {
  const raw = req.get('X-Auth-Token');
  if (raw != null && String(raw).trim() !== '') {
    return requirePoliceToken(req, res, next);
  }
  return requireAnySession(req, res, next);
}

module.exports = requirePoliceTokenOrAnySession;
