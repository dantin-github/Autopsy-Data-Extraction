'use strict';

/**
 * E4 stub: instant chain + registry reads — install/restore function patches only.
 */

const chain = require('../../../src/services/chain');
const caseRegistryTx = require('../../../src/services/caseRegistryTx');

const STUB_INSERT_TX = `0x${'aa'.repeat(32)}`;
const STUB_UPDATE_TX = `0x${'cc'.repeat(32)}`;
const STUB_REG_TX = `0x${'bb'.repeat(32)}`;
const MOCK_BLOCK_INSERT = 42;
const MOCK_BLOCK_REG = 43;
const MOCK_TS = '1970-01-01T00:00:00.000Z';

let installed = false;
let origInsert;
let origUpdateRecord;
let origCreateReg;
let origMirrored;
let origBlockTsIso;
let origGetRh;

const MOCK_BLOCK_UPDATE = 44;

/** @deprecated Do NOT install during E3 concurrency tests (observe real chain). */
module.exports.isInstalled = () => installed;

module.exports.install = function installPerfChainMock(registryRecordReturn = null) {
  if (installed) {
    throw new Error('chainMock already installed');
  }
  origInsert = chain.insertRecord;
  origUpdateRecord = chain.updateRecord;
  origCreateReg = chain.createCaseRegistryRecordFromKeystore;
  origMirrored = chain.getMirroredRecordHash;
  origBlockTsIso = chain.getBlockTimestampUtcIso;
  origGetRh = caseRegistryTx.getRecordHashOnRegistry;

  chain.insertRecord = async (_row) => ({
    txHash: STUB_INSERT_TX,
    blockNumber: MOCK_BLOCK_INSERT,
    affected: 1
  });

  chain.updateRecord = async (_row) => ({
    txHash: STUB_UPDATE_TX,
    blockNumber: MOCK_BLOCK_UPDATE,
    affected: 1
  });

  chain.createCaseRegistryRecordFromKeystore = async () => ({
    txHash: STUB_REG_TX,
    blockNumber: MOCK_BLOCK_REG
  });

  chain.getMirroredRecordHash = async (_index, canonicalHintHex) =>
    canonicalHintHex == null ? null : canonicalHintHex;

  chain.getBlockTimestampUtcIso = async () => MOCK_TS;

  caseRegistryTx.getRecordHashOnRegistry = async (_indexHashRaw) => registryRecordReturn;

  installed = true;
};

module.exports.restore = function restorePerfChainMock() {
  if (!installed) {
    return;
  }
  chain.insertRecord = origInsert;
  chain.updateRecord = origUpdateRecord;
  chain.createCaseRegistryRecordFromKeystore = origCreateReg;
  chain.getMirroredRecordHash = origMirrored;
  chain.getBlockTimestampUtcIso = origBlockTsIso;
  caseRegistryTx.getRecordHashOnRegistry = origGetRh;
  origInsert =
    origUpdateRecord =
    origCreateReg =
    origMirrored =
    origBlockTsIso =
    origGetRh =
      undefined;
  installed = false;
};
