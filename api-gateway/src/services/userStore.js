'use strict';

const fs = require('fs');
const bcrypt = require('bcrypt');
const config = require('../config');

let cache;

function clearCache() {
  cache = undefined;
}

function loadUsers() {
  if (!fs.existsSync(config.usersFilePath)) {
    throw new Error(
      `Users file missing: ${config.usersFilePath} (run: npm run seed-users)`
    );
  }
  const raw = fs.readFileSync(config.usersFilePath, 'utf8');
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) {
    throw new Error('users.json must be a JSON array');
  }
  return list;
}

function getUsers() {
  if (!cache) {
    cache = loadUsers();
  }
  return cache;
}

function findByUsername(username) {
  const u = String(username || '').trim();
  if (!u) {
    return null;
  }
  return getUsers().find((row) => row.username === u) || null;
}

async function verifyPassword(user, password) {
  if (!user || !user.passwordHash) {
    return false;
  }
  return bcrypt.compare(String(password || ''), user.passwordHash);
}

/** @returns {Promise<object|null>} public user fields if password matches, else null */
async function verifyCredentials(username, password) {
  const user = findByUsername(username);
  if (!user) {
    return null;
  }
  const ok = await verifyPassword(user, password);
  if (!ok) {
    return null;
  }
  const { passwordHash: _h, ...rest } = user;
  return rest;
}

module.exports = {
  clearCache,
  findByUsername,
  verifyPassword,
  verifyCredentials
};
