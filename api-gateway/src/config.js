'use strict';

const os = require('os');
const path = require('path');

require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const enableDebugRoutes =
  nodeEnv !== 'production' ||
  ['1', 'true', 'yes'].includes(String(process.env.ENABLE_DEBUG_ROUTES || '').toLowerCase());
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

/** Police OTP → X-Auth-Token TTL. Default 2h: integrations (e.g. forensics export) often exceed 10 min. */
const otpTtlMsRaw = Number(process.env.OTP_TTL_MS);
const otpTtlMs =
  Number.isFinite(otpTtlMsRaw) && otpTtlMsRaw > 0 ? otpTtlMsRaw : 2 * 60 * 60 * 1000;

function resolveRecordStorePath() {
  const raw = process.env.RECORD_STORE_PATH;
  if (raw != null && String(raw).trim() !== '') {
    const s = String(raw).trim();
    if (s === '~' || s.startsWith('~/')) {
      return s === '~' ? os.homedir() : path.join(os.homedir(), s.slice(2));
    }
    return path.resolve(process.cwd(), s);
  }
  return path.join(os.homedir(), '.case_record_store.json');
}

const recordStorePath = resolveRecordStorePath();

function resolveFiscoConfigPath() {
  const raw = process.env.FISCO_CONFIG;
  if (raw != null && String(raw).trim() !== '') {
    const s = String(raw).trim();
    if (s === '~' || s.startsWith('~/')) {
      return s === '~' ? os.homedir() : path.join(os.homedir(), s.slice(2));
    }
    return path.resolve(process.cwd(), s);
  }
  return path.join(__dirname, '..', 'conf', 'fisco-config.json');
}

const fiscoConfigPath = resolveFiscoConfigPath();

/** On-chain user table for hash-only storage (see blockchain-setup/HASH-ONLY-CHAIN.md). */
const caseHashTableName =
  process.env.CASE_HASH_TABLE != null && String(process.env.CASE_HASH_TABLE).trim() !== ''
    ? String(process.env.CASE_HASH_TABLE).trim()
    : 't_case_hash';

const caseRegistryAddrRaw = process.env.CASE_REGISTRY_ADDR;
const caseRegistryAddr =
  caseRegistryAddrRaw != null && String(caseRegistryAddrRaw).trim() !== ''
    ? String(caseRegistryAddrRaw).trim()
    : '';

/** When true and CASE_REGISTRY_ADDR is set, POST /api/upload also calls CaseRegistry.createRecord signed with the police user keystore (requires signingPassword). */
const uploadUseCaseRegistry = ['1', 'true', 'yes'].includes(
  String(process.env.UPLOAD_USE_CASE_REGISTRY || '').toLowerCase()
);

/** `crud` (default): only `t_case_hash` CRUD insert. `contract`: also `CaseRegistry.createRecord` after CRUD when `CASE_REGISTRY_ADDR` is set (S6.1). Legacy: `UPLOAD_USE_CASE_REGISTRY=1` still enables contract path when `CHAIN_MODE` is not `contract`. */
const chainModeRaw = String(process.env.CHAIN_MODE || 'crud').trim().toLowerCase();
const chainMode = chainModeRaw === 'contract' ? 'contract' : 'crud';

function uploadContractEnabled() {
  if (!caseRegistryAddr) {
    return false;
  }
  if (chainMode === 'contract') {
    return true;
  }
  return uploadUseCaseRegistry;
}

const auditLogPath =
  process.env.AUDIT_LOG_PATH != null && String(process.env.AUDIT_LOG_PATH).trim() !== ''
    ? path.resolve(process.cwd(), String(process.env.AUDIT_LOG_PATH).trim())
    : path.join(__dirname, '..', 'data', 'audit.jsonl');

const auditStatePath =
  process.env.AUDIT_STATE_PATH != null && String(process.env.AUDIT_STATE_PATH).trim() !== ''
    ? path.resolve(process.cwd(), String(process.env.AUDIT_STATE_PATH).trim())
    : path.join(__dirname, '..', 'data', 'audit-state.json');

/** P8: poll CaseRegistry logs every N ms (default 5000). */
const eventListenerPollMsRaw = Number(process.env.EVENT_LISTENER_POLL_MS);
const eventListenerPollMs =
  Number.isFinite(eventListenerPollMsRaw) && eventListenerPollMsRaw >= 1000
    ? eventListenerPollMsRaw
    : 5000;

const eventListenerEnabled = !['0', 'false', 'no'].includes(
  String(process.env.ENABLE_EVENT_LISTENER || '1').toLowerCase()
);

module.exports = {
  nodeEnv,
  enableDebugRoutes,
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
  otpTtlMs,
  recordStorePath,
  fiscoConfigPath,
  caseHashTableName,
  caseRegistryAddr,
  uploadUseCaseRegistry,
  chainMode,
  uploadContractEnabled,
  auditLogPath,
  auditStatePath,
  eventListenerPollMs,
  eventListenerEnabled
};
