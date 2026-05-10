'use strict';

/**
 * Perf env sanity: chain, CASE_REGISTRY_ADDR, seeded users + keystores,
 * OTP reuse mode (peek), MAIL_DRY_RUN, OTP_TTL_MS >= 3600000.
 *
 * Usage (from api-gateway): node scripts/perf/precheck.js
 * CRUD-only upload perf (skip CaseRegistry / contract-upload checks):
 *   npm run perf:precheck:upload-crud   or   PERF_PRECHECK_UPLOAD_CRUD_ONLY=1 node scripts/perf/precheck.js
 */

const fs = require('fs');
const path = require('path');

const apiRoot = path.join(__dirname, '..', '..');

require('dotenv').config({ path: path.join(apiRoot, '.env') });

function fail(reason) {
  console.error(`FAIL · ${reason}`);
  process.exit(1);
}

if (!process.env.SESSION_SECRET || String(process.env.SESSION_SECRET).trim() === '') {
  process.env.SESSION_SECRET = 'perf-precheck-placeholder';
}

/** OTP is captured from mail hooks; `.env` may set MAIL_DRY_RUN=off for prod — perf forces dry run here. */
{
  const raw = process.env.MAIL_DRY_RUN != null ? String(process.env.MAIL_DRY_RUN).trim() : '';
  const on = raw !== '' && ['1', 'true', 'yes'].includes(raw.toLowerCase());
  const explicitOff =
    raw !== '' && ['0', 'false', 'no', 'off'].includes(raw.toLowerCase());

  if (on) {
    /* keep user's .env */
  } else if (raw === '' || explicitOff) {
    if (explicitOff) {
      console.warn(
        `[perf-precheck] MAIL_DRY_RUN was "${raw}" → forcing MAIL_DRY_RUN=1 for OTP-hook capture ` +
          '(no real SMTP in perf).'
      );
    }
    process.env.MAIL_DRY_RUN = '1';
  } else {
    fail(
      `MAIL_DRY_RUN must be 1/true/yes for perf OTP capture (unsupported value: ${JSON.stringify(raw)})`
    );
  }
}

process.env.X_AUTH_TOKEN_SINGLE_USE = process.env.X_AUTH_TOKEN_SINGLE_USE || '0';
const singleUseDisabled = ['0', 'false', 'no'].includes(
  String(process.env.X_AUTH_TOKEN_SINGLE_USE).toLowerCase().trim()
);
if (!singleUseDisabled) {
  fail('X_AUTH_TOKEN_SINGLE_USE must be 0/false/no for perf (OTP peek / reuse)');
}

const ttlRaw = Number(process.env.OTP_TTL_MS);
const otpTtl = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 2 * 60 * 60 * 1000;
if (otpTtl < 3600000) {
  fail(`OTP_TTL_MS must be >= 3600000 (got ${otpTtl})`);
}

/** When set, validates chain + seeded users/keystores only (no CaseRegistry address / contract-upload path). Use before E3 CRUD-only arm. */
const precheckUploadCrudOnly = ['1', 'true', 'yes'].includes(
  String(process.env.PERF_PRECHECK_UPLOAD_CRUD_ONLY || '').trim().toLowerCase()
);

delete require.cache[require.resolve(path.join(apiRoot, 'src/config.js'))];

const config = require('../../src/config');
if (config.xAuthTokenSingleUse) {
  fail(
    'config says xAuthTokenSingleUse=true; set X_AUTH_TOKEN_SINGLE_USE=0 (OTP peek/reuse mode for perf)'
  );
}

let addr = '';
if (!precheckUploadCrudOnly) {
  if (!config.caseRegistryAddr || !/^0x[0-9a-fA-F]{40}$/i.test(config.caseRegistryAddr.trim())) {
    fail('CASE_REGISTRY_ADDR must be set to a valid 0x…40 hex contract address');
  }
  if (!config.uploadContractEnabled()) {
    fail(
      'Contract upload path disabled: ensure CASE_REGISTRY_ADDR is set and CHAIN_MODE allows CaseRegistry upload'
    );
  }
  addr = config.caseRegistryAddr.trim();
}

try {
  const chain = require('../../src/services/chain');
  if (!chain.isChainConfigured()) {
    fail(chain.getChainConfigGaps().join('; ') || 'Chain not configured');
  }
  chain.getBlockNumber().then(
    async (bn) => {
      const block = Number(bn);
      if (!Number.isFinite(block) || block < 0) {
        fail(`getBlockNumber returned invalid value: ${bn}`);
      }

      let userStore;
      let keystore;
      try {
        userStore = require('../../src/services/userStore');
      } catch (e) {
        fail(`userStore load: ${e.message}`);
      }
      try {
        keystore = require('../../src/services/keystore');
      } catch (e) {
        fail(`keystore load: ${e.message}`);
      }

      const uPol = userStore.findByUserId('u-police-1');
      const uJud = userStore.findByUserId('u-judge-1');
      if (!uPol) {
        fail('users missing u-police-1 (npm run seed-users)');
      }
      if (!uJud) {
        fail('users missing u-judge-1 (npm run seed-users)');
      }

      const pwd = process.env.PERF_KEYSTORE_PASSWORD || '1';

      async function unlock(userId, label) {
        const encPath = path.join(apiRoot, 'data', 'keystore', `${userId}.enc`);
        if (!fs.existsSync(encPath)) {
          fail(`keystore missing: ${encPath} (npm run seed-roles -- --keystore-only)`);
        }
        const blob = fs.readFileSync(encPath, 'utf8');
        try {
          keystore.decrypt(blob, pwd);
        } catch {
          fail(`keystore decrypt failed for ${label} (${userId}); try PERF_KEYSTORE_PASSWORD`);
        }
      }

      await unlock('u-police-1', 'police');
      await unlock('u-judge-1', 'judge');

      const suffix = addr
        ? ` · registry=${addr.slice(0, 10)}…${addr.slice(-4)}`
        : ` · PERF_PRECHECK_UPLOAD_CRUD_ONLY=1 (contract path not validated)`;
      console.log(`OK · block=${block} · users=2 · keystore=ok · otp_mode=reusable · ttl=${config.otpTtlMs}${suffix}`);
      process.exit(0);
    },
    (e) => {
      fail(`chain unreachable: ${e && e.message ? e.message : e}`);
    }
  );
} catch (e) {
  fail(e && e.message ? e.message : String(e));
}
