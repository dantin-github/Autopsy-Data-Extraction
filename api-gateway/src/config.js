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

/**
 * When true (default), `X-Auth-Token` is removed from the store on first successful use (`consume`).
 * When false, validation uses `peek` until `OTP_TTL_MS` — same OTP can be reused for routes using
 * `requirePoliceToken` (e.g. multiple POST /api/upload). `POST /api/auth/police-otp` always consumes.
 * Env: set `X_AUTH_TOKEN_SINGLE_USE=0` (or `false` / `no`) to allow reuse within TTL.
 */
const xAuthTokenSingleUseEnv = process.env.X_AUTH_TOKEN_SINGLE_USE;
let xAuthTokenSingleUse = true;
if (xAuthTokenSingleUseEnv != null && String(xAuthTokenSingleUseEnv).trim() !== '') {
  const s = String(xAuthTokenSingleUseEnv).toLowerCase().trim();
  xAuthTokenSingleUse = !['0', 'false', 'no'].includes(s);
}

/** Browser session cookie (`gw.sid`) lifetime for judge and police after login. Default 2h. */
const sessionCookieMaxAgeMsRaw = Number(process.env.SESSION_MAX_AGE_MS);
const sessionCookieMaxAgeMs =
  Number.isFinite(sessionCookieMaxAgeMsRaw) && sessionCookieMaxAgeMsRaw > 0
    ? sessionCookieMaxAgeMsRaw
    : 2 * 60 * 60 * 1000;

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

/**
 * `contract` (default): when `CASE_REGISTRY_ADDR` is set, `POST /api/upload` also calls
 * `CaseRegistry.createRecord` (needs `signingPassword`). `crud`: table insert only (tests / legacy).
 * Legacy: `UPLOAD_USE_CASE_REGISTRY=1` still enables the CaseRegistry upload path when `CHAIN_MODE` is `crud`.
 */
const chainModeRaw = String(process.env.CHAIN_MODE || 'contract').trim().toLowerCase();
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

/** Run `scripts/seed-roles.js --ensure` before listen so dev/test users get keystore + onchainAddress without a manual npm script. Off by default in production unless AUTO_SEED_ROLES=1. */
const autoSeedRolesEnv = process.env.AUTO_SEED_ROLES;
let autoSeedRoles;
if (autoSeedRolesEnv != null && String(autoSeedRolesEnv).trim() !== '') {
  autoSeedRoles = ['1', 'true', 'yes'].includes(String(autoSeedRolesEnv).toLowerCase());
} else {
  autoSeedRoles = nodeEnv !== 'production';
}

/** When true, POST /api/upload 200 includes requestId, timing, blockTimestampUtc (same as X-Debug-Timing: 1). Default off for production compatibility. */
const uploadTimingInResponse = ['1', 'true', 'yes'].includes(
  String(process.env.UPLOAD_TIMING_IN_RESPONSE || '').toLowerCase()
);

/** Max JSON body size (e.g. POST /api/upload with full case export). Express string like 100mb. */
const jsonBodyLimitRaw = String(process.env.JSON_BODY_LIMIT || '100mb').trim();
const jsonBodyLimit = jsonBodyLimitRaw !== '' ? jsonBodyLimitRaw : '100mb';

module.exports = {
  nodeEnv,
  enableDebugRoutes,
  port,
  sessionSecret,
  sessionCookieMaxAgeMs,
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
  xAuthTokenSingleUse,
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
  eventListenerEnabled,
  autoSeedRoles,
  uploadTimingInResponse,
  jsonBodyLimit
};
