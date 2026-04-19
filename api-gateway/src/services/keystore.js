'use strict';

/**
 * Password-wrapped secp256k1 private keys for gateway-side signing (§11.5 plan A).
 * scrypt(password, salt) → AES-256-GCM key; random salt + IV per encrypt.
 */

const crypto = require('crypto');

const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};

const KEYSTORE_VERSION = 1;

class BadPassword extends Error {
  constructor(message = 'incorrect password or corrupted keystore') {
    super(message);
    this.name = 'BadPassword';
    this.code = 'BAD_PASSWORD';
  }
}

function normalizePrivateKeyHex(privateKeyHex) {
  const s = String(privateKeyHex || '')
    .trim()
    .replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    throw new Error('privateKey must be 32 bytes as 64 hex characters');
  }
  return s.toLowerCase();
}

/**
 * @param {string} privateKeyHex 64 hex chars (no 0x required)
 * @param {string} password user login password
 * @returns {{ version: number, salt: string, iv: string, tag: string, ciphertext: string }} JSON-serializable blob
 */
function encrypt(privateKeyHex, password) {
  const pk = normalizePrivateKeyHex(privateKeyHex);
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 32, SCRYPT_PARAMS);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(pk, 'hex');
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: KEYSTORE_VERSION,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: ciphertext.toString('hex')
  };
}

/**
 * @param {object|string} payload object from {@link encrypt} or JSON string of it
 * @param {string} password
 * @returns {string} 64-char lowercase hex private key
 */
function decrypt(payload, password) {
  const obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!obj || obj.version !== KEYSTORE_VERSION) {
    throw new BadPassword();
  }
  const salt = Buffer.from(String(obj.salt), 'hex');
  const iv = Buffer.from(String(obj.iv), 'hex');
  const tag = Buffer.from(String(obj.tag), 'hex');
  const ciphertext = Buffer.from(String(obj.ciphertext), 'hex');
  if (salt.length === 0 || iv.length !== 12 || tag.length === 0 || ciphertext.length === 0) {
    throw new BadPassword();
  }
  const key = crypto.scryptSync(String(password), salt, 32, SCRYPT_PARAMS);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const hex = plain.toString('hex');
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      throw new BadPassword();
    }
    return hex;
  } catch {
    throw new BadPassword();
  }
}

/**
 * Random secp256k1 keypair (ethers.js, same dependency tree as fisco-bcos).
 * @returns {{ privateKey: string, address: string }} lowercase hex pk (64 chars) and checksummed address
 */
function generateKeypair() {
  const ethers = require('ethers');
  const w = ethers.Wallet.createRandom();
  return {
    privateKey: w.privateKey.replace(/^0x/i, '').toLowerCase(),
    address: w.address
  };
}

module.exports = {
  BadPassword,
  encrypt,
  decrypt,
  generateKeypair,
  generate: generateKeypair,
  SCRYPT_PARAMS: Object.freeze({ ...SCRYPT_PARAMS }),
  KEYSTORE_VERSION
};
