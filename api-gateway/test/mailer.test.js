'use strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-mailer-session-secret';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

beforeEach(() => {
  process.env.MAIL_DRY_RUN = '1';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/logger')];
  delete require.cache[require.resolve('../src/services/mailer')];
});

test('send in dry-run returns without SMTP and exposes OTP in log payload', async () => {
  const mailer = require('../src/services/mailer');
  const otp = 'abcdef0123456789';
  const r = await mailer.send({
    to: 'officer@example.com',
    subject: 'Case Gateway OTP',
    text: `Your one-time code: ${otp}`
  });
  assert.strictEqual(r.dryRun, true);
  assert.strictEqual(r.messageId, 'dry-run');
});

test('send requires to, subject, and text', async () => {
  const mailer = require('../src/services/mailer');
  await assert.rejects(() => mailer.send({ to: 'a@b.com', subject: 'x' }), /text/);
});
