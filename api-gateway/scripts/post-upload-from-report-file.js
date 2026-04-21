'use strict';

/**
 * S1.4 manual smoke helper: POST an Autopsy Case Data Extract JSON to /api/upload.
 *
 * Prerequisite: api-gateway running; police OTP issued (see gateway logs or admin flow).
 *
 * Usage (PowerShell, from api-gateway directory):
 *   $env:AUTH_TOKEN="<paste-otp>"
 *   node scripts/post-upload-from-report-file.js "C:\path\to\case_data_extract.json"
 *
 * Optional:
 *   Second arg: base URL (default http://localhost:3000 or GATEWAY_URL)
 *   $env:SIGNING_PASSWORD="..." when gateway uses contract / CaseRegistry signing
 *   $env:GENERATED_AT="2026-04-21T12:00:00.000Z" (default: current time ISO-8601)
 */

const fs = require('fs');
const path = require('path');

const integrity = require('../src/services/integrity');

function usage() {
  console.error(`Usage:
  AUTH_TOKEN=<police OTP> node scripts/post-upload-from-report-file.js <case_data_extract.json> [baseUrl]

Optional env:
  GATEWAY_URL          Default base if second arg omitted (default http://localhost:3000)
  SIGNING_PASSWORD     Required when gateway runs in contract mode with keystore signing
  GENERATED_AT         ISO-8601 timestamp for record hash (default: now)`);
  process.exit(1);
}

async function main() {
  const file = process.argv[2];
  const baseUrl = (
    process.argv[3] ||
    process.env.GATEWAY_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
  const token = process.env.AUTH_TOKEN;
  if (!file || !token) {
    usage();
  }

  const abs = path.resolve(file);
  const caseJson = fs.readFileSync(abs, 'utf8');
  let doc;
  try {
    doc = JSON.parse(caseJson);
  } catch (e) {
    console.error('Invalid JSON:', e.message);
    process.exit(1);
  }

  const caseId = doc.caseId;
  const examiner = doc.examiner;
  const aggregateHash = doc.aggregateHash;
  if (caseId == null || String(caseId).trim() === '') {
    console.error('Report missing caseId');
    process.exit(1);
  }
  if (examiner == null || String(examiner).trim() === '') {
    console.error('Report missing examiner');
    process.exit(1);
  }
  if (aggregateHash == null || String(aggregateHash).trim() === '') {
    console.error('Report missing aggregateHash (finish report generation in Autopsy)');
    process.exit(1);
  }

  if (!integrity.verify(caseJson)) {
    console.error(
      'integrity.verify failed: aggregateHash does not match canonical body.\n' +
        'Regenerate the report with the plugin that uses CanonicalJson (S1.3+), or fix the file.'
    );
    process.exit(1);
  }

  const generatedAt = process.env.GENERATED_AT || new Date().toISOString();

  const payload = {
    caseId: String(caseId).trim(),
    examiner: String(examiner).trim(),
    aggregateHash: String(aggregateHash).trim(),
    generatedAt,
    caseJson
  };
  const sp = process.env.SIGNING_PASSWORD;
  if (sp != null && String(sp) !== '') {
    payload.signingPassword = sp;
  }

  const url = `${baseUrl}/api/upload`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Auth-Token': String(token).trim()
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!res.ok) {
    console.error('HTTP', res.status, body);
    process.exit(1);
  }
  console.log('POST /api/upload OK', res.status);
  console.log(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
