'use strict';

/**
 * In-process gateway supertest helpers: reusable police OTP (peek mode), upload/query/case-exists.
 * Call configurePerfEnv() before any gateway require if overriding RECORD_STORE_PATH.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const request = require('supertest');

/** api-gateway/ (three levels up from scripts/perf/lib/) */
const apiRoot = path.join(__dirname, '..', '..', '..');

function clearSrcModuleCache() {
  const norm = path.normalize(`${path.sep}api-gateway${path.sep}`);
  for (const k of Object.keys(require.cache)) {
    if (
      k.includes(`${path.sep}src${path.sep}`) ||
      k.includes(norm) ||
      k.includes(`api-gateway${path.sep}src`)
    ) {
      delete require.cache[k];
    }
  }
}

/**
 * @param {string} modAbsPath absolute path under api-gateway/src (or resolved module id)
 */
function requireFresh(modPath) {
  const resolved = path.isAbsolute(modPath) ? modPath : require.resolve(modPath);
  delete require.cache[resolved];
  return require(resolved);
}

/**
 * Prepare process.env before gateway modules resolve config (esp. RECORD_STORE_PATH).
 */
function configurePerfEnv(overrides = {}) {
  require('dotenv').config({ path: path.join(apiRoot, '.env') });
  if (!process.env.SESSION_SECRET || String(process.env.SESSION_SECRET).trim() === '') {
    process.env.SESSION_SECRET = 'perf-harness-session';
  }
  process.env.MAIL_DRY_RUN = '1';
  if (process.env.X_AUTH_TOKEN_SINGLE_USE == null || String(process.env.X_AUTH_TOKEN_SINGLE_USE).trim() === '') {
    process.env.X_AUTH_TOKEN_SINGLE_USE =
      overrides.X_AUTH_TOKEN_SINGLE_USE != null ? String(overrides.X_AUTH_TOKEN_SINGLE_USE) : '0';
  }
  const ttl = Number(process.env.OTP_TTL_MS);
  if (!Number.isFinite(ttl) || ttl < 3600000) {
    process.env.OTP_TTL_MS = String(7200000);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v != null && k !== 'X_AUTH_TOKEN_SINGLE_USE') {
      process.env[k] = String(v);
    }
  }
}

let mailerBackup = null;
let appInstance = null;
let otpCapture = '';
let policeTokenCache = null;

function patchMailerOnce() {
  if (mailerBackup !== null) {
    return;
  }
  const mailer = require(path.join(apiRoot, 'src', 'services', 'mailer'));
  mailerBackup = mailer.send;
  otpCapture = '';
  mailer.send = async function perfMailWrapped(opts) {
    const match = opts && opts.text && opts.text.match(/\n\n([0-9a-f]{16})\n\n/);
    if (match) {
      otpCapture = match[1];
    }
    return mailerBackup.call(mailer, opts);
  };
}

function getApp() {
  patchMailerOnce();
  if (!appInstance) {
    const { createApp } = require(path.join(apiRoot, 'src', 'app'));
    appInstance = createApp();
  }
  return appInstance;
}

function invalidatePoliceToken() {
  policeTokenCache = null;
}

const perfPoliceUserId = () =>
  process.env.PERF_POLICE_USER_ID != null && String(process.env.PERF_POLICE_USER_ID).trim() !== ''
    ? String(process.env.PERF_POLICE_USER_ID).trim()
    : 'u-police-1';

/**
 * Perf-only: register a 16-hex OTP in the in-memory tokenStore — no `/login`, no mailer hook.
 * Use with `PERF_INJECT_POLICE_OTP=1` or call directly after `getApp()`.
 */
function seedPoliceOtpIntoTokenStore() {
  const tokenStore = require(path.join(apiRoot, 'src', 'services', 'tokenStore'));
  const token = crypto.randomBytes(8).toString('hex');
  const ttlRaw = Number(process.env.OTP_TTL_MS);
  const ttl = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 7200000;
  tokenStore.issue(perfPoliceUserId(), token, ttl);
  policeTokenCache = token;
  return { token, userId: perfPoliceUserId() };
}

/**
 * One OTP for the whole test process (peek mode): first call logs in police; reuse until refresh/invalidate.
 * @param {{ role?: string, password?: string, refresh?: boolean }} opts
 */
async function acquireToken(opts = {}) {
  const role = opts.role != null ? String(opts.role) : 'police';
  const password =
    opts.password != null ? String(opts.password) : process.env.PERF_LOGIN_PASSWORD || '1';
  const refresh = Boolean(opts.refresh);

  if (role !== 'police') {
    throw new Error('Perf harness acquireToken supports only role=police (X-Auth-Token OTP)');
  }

  const injectOtp = ['1', 'true', 'yes'].includes(
    String(process.env.PERF_INJECT_POLICE_OTP || '').toLowerCase()
  );
  if (injectOtp) {
    getApp();
    if (!refresh && policeTokenCache && /^[0-9a-f]{16}$/.test(policeTokenCache)) {
      return { token: policeTokenCache, userId: perfPoliceUserId() };
    }
    return seedPoliceOtpIntoTokenStore();
  }

  if (!refresh && policeTokenCache && /^[0-9a-f]{16}$/.test(policeTokenCache)) {
    return { token: policeTokenCache, userId: perfPoliceUserId() };
  }

  otpCapture = '';
  const app = getApp();
  await request(app)
    .post('/login')
    .set('Accept', 'application/json')
    .send({ username: 'officer1', password })
    .expect(200);
  if (!/^[0-9a-f]{16}$/.test(otpCapture)) {
    throw new Error('OTP not captured from mailer (MAIL_DRY_RUN=1 + police login)');
  }
  policeTokenCache = otpCapture;
  return { token: policeTokenCache, userId: perfPoliceUserId() };
}

/** Legacy name: always same cache semantics as acquireToken({ refresh:false }) after first mint. */
async function acquirePoliceToken(loginPassword = '1') {
  const { token } = await acquireToken({
    password: loginPassword != null ? String(loginPassword) : '1'
  });
  return token;
}

function judgeAgent() {
  patchMailerOnce();
  const app = getApp();
  const agent = request.agent(app);
  return agent
    .post('/login')
    .set('Accept', 'application/json')
    .send({
      username: 'judge1',
      password: process.env.PERF_LOGIN_PASSWORD || '1'
    })
    .then((res) => {
      if (res.status !== 200) {
        throw new Error(`judge login failed: ${res.status} ${JSON.stringify(res.body)}`);
      }
      return agent;
    });
}

async function uploadOnce(
  policeToken,
  {
    caseId,
    examiner = 'officer1',
    aggregateHash,
    generatedAt,
    caseJson,
    signingPassword = process.env.PERF_SIGNING_PASSWORD || '1',
    blockSync = false
  }
) {
  const app = getApp();
  const t0 = process.hrtime.bigint();
  const req = request(app)
    .post('/api/upload')
    .set('X-Auth-Token', policeToken)
    .set('X-Debug-Timing', '1');
  if (blockSync) {
    req.set('X-Block-Sync-Before-Chain', '1');
  }
  const res = await req.send({
    caseId,
    examiner,
    aggregateHash,
    generatedAt,
    caseJson,
    signingPassword
  });
  const clientRoundTripMs = Number((process.hrtime.bigint() - t0) / 1000000n);
  return { httpStatus: res.status, body: res.body, clientRoundTripMs };
}

async function queryOnce(agent, caseId) {
  const t0 = process.hrtime.bigint();
  const res = await agent.post('/api/query').send({ caseId });
  const clientRoundTripMs = Number((process.hrtime.bigint() - t0) / 1000000n);
  return {
    httpStatus: res.status,
    body: res.body,
    clientRoundTripMs,
    recordHashMatch:
      res.body && res.body.integrity ? Boolean(res.body.integrity.recordHashMatch) : null
  };
}

async function caseExistsOnce(policeToken, caseId) {
  const app = getApp();
  const enc = encodeURIComponent(caseId);
  const t0 = process.hrtime.bigint();
  const res = await request(app).get(`/api/case-exists/${enc}`).set('X-Auth-Token', policeToken);
  const clientRoundTripMs = Number((process.hrtime.bigint() - t0) / 1000000n);
  return { httpStatus: res.status, body: res.body, clientRoundTripMs };
}

function writeJsonl(destPath, row) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.appendFileSync(destPath, `${JSON.stringify(row)}\n`, 'utf8');
}

module.exports = {
  apiRoot,
  clearSrcModuleCache,
  configurePerfEnv,
  requireFresh,
  getApp,
  seedPoliceOtpIntoTokenStore,
  acquireToken,
  acquirePoliceToken,
  invalidatePoliceToken,
  judgeAgent,
  uploadOnce,
  queryOnce,
  caseExistsOnce,
  writeJsonl
};
