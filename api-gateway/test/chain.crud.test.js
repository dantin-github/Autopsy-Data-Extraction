'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const apiRoot = path.join(__dirname, '..');
const chainPath = path.join(apiRoot, 'src', 'services', 'chain.js');

test('chain insert/select round-trip when FISCO conf + gateway.pem exist (S3.3)', async () => {
  if (!fs.existsSync(path.join(apiRoot, 'conf', 'fisco-config.json'))) {
    console.log('skip: conf/fisco-config.json missing');
    return;
  }

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve(chainPath)];

  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = 'test-chain-crud-placeholder';
  }

  const chain = require(chainPath);
  if (!chain.isChainConfigured()) {
    console.log('skip: chain not configured (certs or gateway.pem)');
    return;
  }

  const crypto = require('crypto');
  const indexHash = crypto.randomBytes(32).toString('hex');
  const recordHash = crypto.randomBytes(32).toString('hex');

  const ins = await chain.insertRecord({ indexHash, recordHash });
  assert.match(ins.txHash, /^0x[0-9a-f]{64}$/i);
  assert.ok(Number.isFinite(ins.blockNumber));

  const sel = await chain.selectRecord(recordHash);
  assert.ok(sel.recordHash);
  const got = String(sel.recordHash).replace(/^0x/i, '').toLowerCase();
  assert.strictEqual(got, recordHash.toLowerCase());
});
