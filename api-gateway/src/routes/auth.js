'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const config = require('../config');
const mailer = require('../services/mailer');
const tokenStore = require('../services/tokenStore');
const userStore = require('../services/userStore');

const router = express.Router();

/** IANA reserved / documentation domains — cannot receive real mail. */
function looksLikePlaceholderInbox(email) {
  return /@example\.(com|org|net)$/i.test(String(email));
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

router.get('/login', (req, res) => {
  res.type('html');
  res.sendFile(path.join(__dirname, '..', 'views', 'login.html'));
});

router.post('/login', async (req, res, next) => {
  const username = req.body.username ?? req.body.user;
  const password = req.body.password;

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  let user;
  try {
    user = await userStore.verifyCredentials(String(username).trim(), password);
  } catch (err) {
    return next(err);
  }

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.role === 'judge') {
    try {
      await regenerateSession(req);
      req.session.role = 'judge';
      req.session.userId = user.userId;
      req.session.username = user.username;

      const target = new URL(config.judgeDashboardUrl);
      target.searchParams.set('sid', req.sessionID);
      const location = target.href;

      // Browser fetch cannot read cross-origin 302 Location reliably (opaque redirect).
      // JSON clients send Accept: application/json — return explicit URL for client-side navigation.
      const accept = String(req.get('Accept') || '');
      if (accept.includes('application/json')) {
        return res.status(200).json({
          status: 'redirect',
          location,
          role: 'judge',
          userId: user.userId,
          username: user.username
        });
      }

      return res.redirect(302, location);
    } catch (err) {
      return next(err);
    }
  }

  if (user.role === 'police') {
    const email = user.email != null ? String(user.email).trim() : '';
    if (!email) {
      return res.status(400).json({ error: 'user account has no email configured' });
    }

    if (!config.mailDryRun && looksLikePlaceholderInbox(email)) {
      return res.status(400).json({
        error:
          'Police user email cannot be @example.com (domain does not accept mail). Update email in data/users.json, or edit data/users.example.json and run npm run seed-users.'
      });
    }

    const otp = crypto.randomBytes(8).toString('hex');
    const ttl = config.otpTtlMs;
    const expiresAt = new Date(Date.now() + ttl).toISOString();

    tokenStore.issue(user.userId, otp, ttl);

    try {
      await mailer.send({
        to: email,
        subject: 'Case Gateway — one-time code',
        text: [
          'Your Case Gateway one-time code (OTP) is:',
          '',
          otp,
          '',
          `This code expires at ${expiresAt} (${Math.round(ttl / 60000)} minutes).`,
          'Do not share this code.'
        ].join('\n')
      });
    } catch (err) {
      return next(err);
    }

    return res.status(200).json({
      status: 'otp_sent',
      expiresAt,
      userId: user.userId,
      username: user.username,
      role: user.role
    });
  }

  return res.status(403).json({ error: 'unsupported role' });
});

/**
 * Exchange one-time OTP for a police browser session (§8 S7.1「警察会话」).
 * Body: { username, otp } — OTP must match a token issued for that police userId.
 */
router.post('/api/auth/police-otp', async (req, res, next) => {
  const username = req.body.username ?? req.body.user;
  const otp = req.body.otp;
  if (!username || !otp) {
    return res.status(400).json({ error: 'username and otp are required' });
  }

  const user = userStore.findByUsername(String(username).trim());
  if (!user || String(user.role || '').toLowerCase() !== 'police') {
    return res.status(403).json({ error: 'police only' });
  }

  const out = tokenStore.consume(String(otp).trim());
  if (!out || out.userId !== user.userId) {
    return res.status(401).json({ error: 'invalid or expired otp' });
  }

  try {
    await regenerateSession(req);
    req.session.role = 'police';
    req.session.userId = user.userId;
    req.session.username = user.username;
    return res.status(200).json({
      status: 'session_ok',
      userId: user.userId,
      username: user.username,
      role: 'police'
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
