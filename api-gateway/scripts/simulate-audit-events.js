'use strict';

/**
 * Appends a simulated CaseRegistry event flow to audit.jsonl (same JSON shape as eventListener).
 * Does not require a live chain — for local inspection of GET /api/audit and data/audit.jsonl.
 *
 * Usage (from api-gateway):
 *   npm run simulate-audit
 *   node scripts/simulate-audit-events.js --reset   # truncate audit log first
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'simulate-audit-placeholder';
}

const config = require('../src/config');

function b32hex() {
  return `0x${crypto.randomBytes(32).toString('hex')}`;
}

function addrHex() {
  return `0x${crypto.randomBytes(20).toString('hex')}`;
}

function main() {
  const reset = process.argv.includes('--reset');
  const auditPath = config.auditLogPath;

  const proposalId = b32hex();
  const indexHash = b32hex();
  const oldRecordHash = b32hex();
  const newRecordHash = b32hex();
  const police = addrHex();
  const judge = addrHex();

  const baseBlock = 100000 + Math.floor(Math.random() * 1000);

  const rows = [
    {
      ts: new Date().toISOString(),
      blockNumber: baseBlock,
      txHash: b32hex(),
      logIndex: 0,
      event: 'RecordCreated',
      args: {
        indexHash,
        recordHash: oldRecordHash,
        creator: police
      }
    },
    {
      ts: new Date().toISOString(),
      blockNumber: baseBlock + 1,
      txHash: b32hex(),
      logIndex: 0,
      event: 'ProposalCreated',
      args: {
        proposalId,
        indexHash,
        proposer: police
      }
    },
    {
      ts: new Date().toISOString(),
      blockNumber: baseBlock + 2,
      txHash: b32hex(),
      logIndex: 0,
      event: 'ProposalApproved',
      args: {
        proposalId,
        approver: judge
      }
    },
    {
      ts: new Date().toISOString(),
      blockNumber: baseBlock + 3,
      txHash: b32hex(),
      logIndex: 0,
      event: 'ProposalExecuted',
      args: {
        proposalId,
        oldHash: oldRecordHash,
        newHash: newRecordHash
      }
    }
  ];

  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  if (reset && fs.existsSync(auditPath)) {
    fs.unlinkSync(auditPath);
  }
  const fd = fs.openSync(auditPath, 'a');
  try {
    for (const row of rows) {
      fs.writeSync(fd, `${JSON.stringify(row)}\n`);
    }
  } finally {
    fs.closeSync(fd);
  }

  console.log(`Wrote ${rows.length} lines to ${auditPath}`);
  console.log('Events: RecordCreated → ProposalCreated → ProposalApproved → ProposalExecuted');
  console.log(`Sample proposalId: ${proposalId}`);
  console.log('View: GET /api/audit (judge session) or: type .\\data\\audit.jsonl');
}

main();
