'use strict';

const fs = require('fs');
const path = require('path');
const { X509Certificate } = require('crypto');
const { test } = require('node:test');
const assert = require('node:assert');

const examplePath = path.join(__dirname, '..', 'conf', 'fisco-config.example.json');

test('fisco-config.example.json is valid JSON with required keys', () => {
  const j = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  assert.strictEqual(j.encryptType, 'ECDSA');
  assert.ok(Array.isArray(j.nodes) && j.nodes.length >= 1);
  assert.ok(j.authentication && j.authentication.key && j.authentication.cert && j.authentication.ca);
  assert.strictEqual(typeof j.groupID, 'number');
});

test('sdk.crt parses as X.509 with validity when conf/sdk.crt exists (S3.1)', () => {
  const crt = path.join(__dirname, '..', 'conf', 'sdk.crt');
  if (!fs.existsSync(crt)) {
    console.log('skip: conf/sdk.crt missing — run npm run copy-chain-certs');
    return;
  }
  const cert = new X509Certificate(fs.readFileSync(crt));
  assert.ok(typeof cert.validFrom === 'string' && cert.validFrom.length > 0);
  assert.ok(typeof cert.validTo === 'string' && cert.validTo.length > 0);
});
