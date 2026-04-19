'use strict';

/**
 * Police-only routes that require an established login session (§8 S7.1「警察会话」).
 * Session is created via POST /api/auth/police-otp after OTP from POST /login.
 */
function requirePoliceSession(req, res, next) {
  if (req.session && req.session.role === 'police' && req.session.userId) {
    req.policeUserId = req.session.userId;
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = requirePoliceSession;
