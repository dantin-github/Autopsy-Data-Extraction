'use strict';

const path = require('path');

require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const port = Number(process.env.PORT) || 3000;
const rawSecret = process.env.SESSION_SECRET;
const sessionSecret = rawSecret != null ? String(rawSecret).trim() : '';

if (!sessionSecret) {
  const err = new Error(
    'SESSION_SECRET is required: set a strong random value in .env (see .env.example)'
  );
  err.code = 'CONFIG_SESSION_SECRET';
  throw err;
}

const usersFilePath = process.env.USERS_FILE
  ? path.resolve(process.cwd(), process.env.USERS_FILE)
  : path.join(__dirname, '..', 'data', 'users.json');

const judgeDashboardUrlRaw = process.env.JUDGE_DASHBOARD_URL || 'http://localhost:8501';
let judgeDashboardUrl;
try {
  judgeDashboardUrl = new URL(judgeDashboardUrlRaw).href;
} catch {
  throw new Error(
    `JUDGE_DASHBOARD_URL must be a valid URL (got: ${JSON.stringify(judgeDashboardUrlRaw)})`
  );
}

const mailDryRun = ['1', 'true', 'yes'].includes(
  String(process.env.MAIL_DRY_RUN || '').toLowerCase()
);

const smtpHost = process.env.SMTP_HOST || '';
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const smtpSecure =
  process.env.SMTP_SECURE === '1' ||
  process.env.SMTP_SECURE === 'true' ||
  smtpPort === 465;
const smtpUser = process.env.SMTP_USER || '';
const smtpPass = process.env.SMTP_PASS || '';
const smtpFrom =
  process.env.SMTP_FROM || '"Case Gateway" <no-reply@case-gateway.local>';

const otpTtlMsRaw = Number(process.env.OTP_TTL_MS);
const otpTtlMs =
  Number.isFinite(otpTtlMsRaw) && otpTtlMsRaw > 0 ? otpTtlMsRaw : 10 * 60 * 1000;

module.exports = {
  nodeEnv,
  port,
  sessionSecret,
  usersFilePath,
  judgeDashboardUrl,
  mailDryRun,
  smtpHost,
  smtpPort,
  smtpSecure,
  smtpUser,
  smtpPass,
  smtpFrom,
  otpTtlMs
};
