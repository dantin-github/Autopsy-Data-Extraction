'use strict';

/**
 * Routes that require any established login session (police or judge).
 */
function requireAnySession(req, res, next) {
  const s = req.session;
  if (!s || !s.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (s.role === 'judge') {
    req.judgeUserId = s.userId;
    return next();
  }
  if (s.role === 'police') {
    req.policeUserId = s.userId;
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = requireAnySession;
