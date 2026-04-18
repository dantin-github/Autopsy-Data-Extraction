'use strict';

/**
 * Copies Channel TLS certs from blockchain/conf into api-gateway/conf/ (same filenames).
 * Run from repo: npm run copy-chain-certs (cwd: api-gateway).
 *
 * After copy, copy a signing account PEM from FISCO console (e.g. accounts/0x*.pem) to
 * api-gateway/conf/accounts/gateway.pem — required before Node SDK can sign transactions.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const srcDir = path.join(repoRoot, 'blockchain', 'conf');
const dstDir = path.join(__dirname, '..', 'conf');
const files = ['ca.crt', 'sdk.crt', 'sdk.key'];
const exampleConfig = path.join(dstDir, 'fisco-config.example.json');
const targetConfig = path.join(dstDir, 'fisco-config.json');

function main() {
  for (const f of files) {
    const from = path.join(srcDir, f);
    if (!fs.existsSync(from)) {
      console.error('Missing source file:', from);
      console.error('Ensure blockchain/conf exists (FISCO SDK certs). blockchain/conf may be gitignored locally.');
      process.exit(1);
    }
  }

  fs.mkdirSync(path.join(dstDir, 'accounts'), { recursive: true });
  for (const f of files) {
    fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f));
    console.log('Copied', f, '→', path.join('api-gateway', 'conf', f));
  }

  if (!fs.existsSync(targetConfig) && fs.existsSync(exampleConfig)) {
    fs.copyFileSync(exampleConfig, targetConfig);
    console.log('Created', path.relative(repoRoot, targetConfig), 'from fisco-config.example.json');
  } else if (fs.existsSync(targetConfig)) {
    console.log('Kept existing', path.relative(repoRoot, targetConfig));
  }

  console.log('');
  console.log('Next: copy a console account PEM to conf/accounts/gateway.pem (see FISCO console accounts/).');
}

main();
