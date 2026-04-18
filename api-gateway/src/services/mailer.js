'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const { logger } = require('../logger');

let transport;

function getTransport() {
  if (transport) {
    return transport;
  }
  if (!config.smtpHost) {
    throw new Error('SMTP_HOST is required when MAIL_DRY_RUN is not enabled');
  }
  transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth:
      config.smtpUser || config.smtpPass
        ? { user: config.smtpUser, pass: config.smtpPass }
        : undefined
  });
  return transport;
}

/**
 * Send an email, or log only when MAIL_DRY_RUN is set.
 * @param {{ to: string, subject: string, text: string, html?: string }} opts
 * @returns {Promise<{ dryRun: boolean, messageId: string }>}
 */
async function send(opts) {
  const { to, subject, text, html } = opts;
  if (!to || !subject || text == null) {
    throw new Error('send() requires to, subject, and text');
  }

  if (config.mailDryRun) {
    logger.info(
      {
        evt: 'mail_dry_run',
        to,
        subject,
        text
      },
      'mailer: dry-run (SMTP skipped); body contains one-time code for operators'
    );
    return { dryRun: true, messageId: 'dry-run' };
  }

  const info = await getTransport().sendMail({
    from: config.smtpFrom,
    to,
    subject,
    text,
    html
  });

  logger.info(
    { evt: 'mail_sent', to, subject, messageId: info.messageId },
    'mailer: message accepted by SMTP'
  );

  return { dryRun: false, messageId: String(info.messageId || '') };
}

module.exports = { send };
