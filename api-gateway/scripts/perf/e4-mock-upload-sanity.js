'use strict';

/**
 * E4.2: With chainMock installed, uploadOnce 50KB returns stub CRUD tx; queryOnce recordHashMatch.
 *
 * Usage (api-gateway root): node scripts/perf/e4-mock-upload-sanity.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  configurePerfEnv,
  acquirePoliceToken,
  uploadOnce,
  judgeAgent,
  queryOnce
} = require('./lib/harness');
const payload = require('./lib/payload');
const mock = require('./lib/chainMock');

const STUB_INSERT_PREFIX = `0x${'aa'.repeat(4)}`; // stub starts with aa…

async function main() {
  const rsFile = path.join(os.tmpdir(), `perf-e4-mock-rs-${process.pid}-${Date.now()}.json`);
  configurePerfEnv({ RECORD_STORE_PATH: rsFile });

  mock.install(null);

  let gate = 0;
  try {
    const token = await acquirePoliceToken();
    const caseId = `perf-e4-mock-upload-sanity-${Date.now()}`;
    const generatedAt = new Date().toISOString();
    const { caseJson, aggregateHash } = payload.genAt(50 * 1024, caseId);

    const r = await uploadOnce(token, { caseId, examiner: 'officer1', aggregateHash, generatedAt, caseJson });

    if (r.httpStatus !== 200) {
      console.error(`FAIL · upload httpStatus=${r.httpStatus} ${JSON.stringify(r.body)}`);
      gate = 1;
    } else {
      const tx = String(r.body && r.body.txHash ? r.body.txHash : '').toLowerCase();
      if (!tx.startsWith(STUB_INSERT_PREFIX)) {
        console.error(`FAIL · expected stub insert tx prefix ${STUB_INSERT_PREFIX}, got ${JSON.stringify(tx)}`);
        gate = 2;
      } else {
        const agent = await judgeAgent();
        const q = await queryOnce(agent, caseId);
        if (q.httpStatus !== 200) {
          console.error(`FAIL · query httpStatus=${q.httpStatus}`);
          gate = 3;
        } else if (!q.recordHashMatch) {
          console.error('FAIL · recordHashMatch is not true');
          gate = 4;
        }
      }
    }
  } finally {
    mock.restore();
  }

  try {
    if (rsFile.startsWith(os.tmpdir()) && fs.existsSync(rsFile)) {
      fs.unlinkSync(rsFile);
    }
  } catch (_) {}

  if (gate !== 0) {
    process.exit(gate);
    return;
  }

  console.log('[E4 mock upload sanity] 200 stub-tx OK query recordHashMatch=true');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
