'use strict';

/**
 * Judge-only routes: valid express-session with role judge.
 */
function requireJudgeSession(req, res, next) {
  const s = req.session;
  if (s && s.role === 'judge' && s.userId) {
    req.judgeUserId = s.userId;
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = requireJudgeSession;
