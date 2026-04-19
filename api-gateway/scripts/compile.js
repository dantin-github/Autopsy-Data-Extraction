'use strict';

/**
 * Compile a Solidity file with bundled solc@0.5.x (standard JSON).
 *
 * Usage (from api-gateway):
 *   node scripts/compile.js contracts/HelloWorld.sol
 *
 * Writes build/<ContractName>.abi and build/<ContractName>.bin (runtime bytecode hex, 0x-prefixed).
 */

const fs = require('fs');
const path = require('path');
const solc = require('solc');

const inputFile = process.argv[2];
if (!inputFile || !inputFile.endsWith('.sol')) {
  console.error('Usage: node scripts/compile.js <path/to/Contract.sol>');
  process.exit(1);
}

const cwd = process.cwd();
const absSol = path.resolve(cwd, inputFile);
if (!fs.existsSync(absSol)) {
  console.error(`File not found: ${absSol}`);
  process.exit(1);
}

const source = fs.readFileSync(absSol, 'utf8');
const sourceKey = path.relative(cwd, absSol).replace(/\\/g, '/');

const input = {
  language: 'Solidity',
  sources: {
    [sourceKey]: { content: source }
  },
  settings: {
    optimizer: { enabled: false },
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object']
      }
    }
  }
};

const raw = solc.compileStandard(JSON.stringify(input));
const output = JSON.parse(raw);

if (output.errors) {
  const hasError = output.errors.some((e) => e.severity === 'error');
  for (const e of output.errors) {
    console.error(e.formattedMessage || e.message);
  }
  if (hasError) {
    process.exit(1);
  }
}

const contractsOut = output.contracts && output.contracts[sourceKey];
if (!contractsOut) {
  console.error('No contract output for', sourceKey);
  process.exit(1);
}

const buildDir = path.join(cwd, 'build');
fs.mkdirSync(buildDir, { recursive: true });

let wrote = 0;
for (const contractName of Object.keys(contractsOut)) {
  const art = contractsOut[contractName];
  const abi = art.abi;
  let bin = art.evm && art.evm.bytecode && art.evm.bytecode.object;
  if (bin == null || bin === '') {
    console.warn(`Skip ${contractName}: no bytecode (interface-only?)`);
    continue;
  }
  if (!bin.startsWith('0x')) {
    bin = `0x${bin}`;
  }
  const base = path.join(buildDir, contractName);
  fs.writeFileSync(`${base}.abi`, `${JSON.stringify(abi, null, 2)}\n`, 'utf8');
  fs.writeFileSync(`${base}.bin`, `${bin}\n`, 'utf8');
  console.log(`Wrote ${path.relative(cwd, `${base}.abi`)}`);
  console.log(`Wrote ${path.relative(cwd, `${base}.bin`)}`);
  wrote += 1;
}

if (wrote === 0) {
  process.exit(1);
}
