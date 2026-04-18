'use strict';

/**
 * Prints sdk.crt validity window using Node's crypto.X509Certificate (no openssl on PATH required).
 * Run from api-gateway: npm run verify:chain-certs
 */

const fs = require('fs');
const path = require('path');
const { X509Certificate } = require('crypto');

const crtPath = path.join(__dirname, '..', 'conf', 'sdk.crt');

function main() {
  if (!fs.existsSync(crtPath)) {
    console.error('Missing', path.relative(process.cwd(), crtPath));
    console.error('Run: npm run copy-chain-certs');
    process.exit(1);
  }
  const pem = fs.readFileSync(crtPath);
  let cert;
  try {
    cert = new X509Certificate(pem);
  } catch (e) {
    console.error('Invalid PEM in sdk.crt:', e.message);
    process.exit(1);
  }
  // Same labels as `openssl x509 -noout -dates` for familiarity
  console.log(`notBefore=${cert.validFrom}`);
  console.log(`notAfter=${cert.validTo}`);
}

main();
