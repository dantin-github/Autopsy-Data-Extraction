'use strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-health-session-secret';

const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

test('GET /health returns status, uptime, and gateway capabilities', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const res = await request(app).get('/health').expect(200);
  assert.strictEqual(res.body.status, 'ok');
  assert.ok(typeof res.body.uptime === 'number');
  const gw = res.body.gateway;
  assert.ok(gw && typeof gw === 'object');
  assert.ok(gw.chainMode === 'crud' || gw.chainMode === 'contract');
  assert.strictEqual(typeof gw.chainConfigured, 'boolean');
  assert.strictEqual(typeof gw.caseRegistryConfigured, 'boolean');
  assert.strictEqual(typeof gw.uploadContractPathEnabled, 'boolean');
  if (gw.caseRegistryAddrTail != null) {
    assert.match(String(gw.caseRegistryAddrTail), /^[0-9a-f]{6}$/);
  }
});
