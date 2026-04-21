'use strict';

/**
 * For each row in data/users.json: decrypt data/keystore/<userId>.enc with passwordPlain
 * from users.example.json (matched by userId) and compare derived address to onchainAddress.
 *
 * Usage (from api-gateway): node scripts/verify-users-keystore.js
 * Exit 1 if any mismatch or missing keystore.
 */

const fs = require('fs');
const path = require('path');
const ethers = require('ethers');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const keystore = require('../src/services/keystore');

const apiRoot = path.join(__dirname, '..');

function usersPath() {
  const raw = process.env.USERS_FILE;
  if (raw != null && String(raw).trim() !== '') {
    return path.resolve(process.cwd(), String(raw).trim());
  }
  return path.join(apiRoot, 'data', 'users.json');
}

function examplePath() {
  const raw = process.env.USERS_EXAMPLE_FILE;
  if (raw != null && String(raw).trim() !== '') {
    return path.resolve(process.cwd(), String(raw).trim());
  }
  return path.join(apiRoot, 'data', 'users.example.json');
}

function main() {
  const up = usersPath();
  const ep = examplePath();
  if (!fs.existsSync(up) || !fs.existsSync(ep)) {
    console.error(`Missing ${up} or ${ep}`);
    process.exit(1);
  }
  const users = JSON.parse(fs.readFileSync(up, 'utf8'));
  const example = JSON.parse(fs.readFileSync(ep, 'utf8'));
  if (!Array.isArray(users) || !Array.isArray(example)) {
    console.error('users files must be JSON arrays');
    process.exit(1);
  }
  const pwdById = new Map();
  for (const row of example) {
    if (row.userId && row.passwordPlain != null && String(row.passwordPlain) !== '') {
      pwdById.set(String(row.userId), String(row.passwordPlain));
    }
  }

  let failed = false;
  for (const u of users) {
    const userId = String(u.userId || '').trim();
    const username = String(u.username || userId);
    const encPath = path.join(apiRoot, 'data', 'keystore', `${userId}.enc`);
    if (!fs.existsSync(encPath)) {
      console.error(`${username}: missing keystore ${encPath}`);
      failed = true;
      continue;
    }
    const pwd = pwdById.get(userId);
    if (!pwd) {
      console.error(`${username}: no passwordPlain in example for userId ${userId}`);
      failed = true;
      continue;
    }
    let pk;
    try {
      const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
      pk = keystore.decrypt(enc, pwd);
    } catch (e) {
      console.error(`${username}: decrypt failed (${e.message || e})`);
      failed = true;
      continue;
    }
    const fromKs = new ethers.Wallet(`0x${pk}`).address.toLowerCase();
    const fromJson = String(u.onchainAddress || '')
      .trim()
      .toLowerCase();
    if (fromKs !== fromJson) {
      console.error(
        `${username}: MISMATCH keystore=${fromKs} users.json onchainAddress=${fromJson}`
      );
      failed = true;
    } else {
      console.log(`${username}: OK ${fromKs}`);
    }
  }

  if (failed) {
    console.error('\nFix: re-run `npm run seed-roles` (see --ensure) or restore matching keystore + onchainAddress.');
    process.exit(1);
  }
}

main();
