'use strict';

/**
 * P8: Poll new blocks for CaseRegistry contract logs and append JSON lines to audit.jsonl.
 */

const fs = require('fs');
const path = require('path');
const ethers = require('ethers');
const config = require('../config');
const chain = require('./chain');
const { logger } = require('../logger');
const { parseReceiptBlockNumber } = require('./receiptBlockNumber');
const { serializeEventArgs } = require('./auditEventArgs');

const apiRoot = path.join(__dirname, '..', '..');
const abiPath = path.join(apiRoot, 'build', 'CaseRegistry.abi');

const TARGET_EVENTS = new Set([
  'RecordCreated',
  'ProposalCreated',
  'ProposalApproved',
  'ProposalRejected',
  'ProposalExecuted'
]);

const MAX_BLOCKS_PER_TICK = 64;

let _timer = null;
let _running = false;

function loadAbi() {
  if (!fs.existsSync(abiPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(abiPath, 'utf8'));
}

function loadState() {
  try {
    const raw = fs.readFileSync(config.auditStatePath, 'utf8');
    const s = JSON.parse(raw);
    const n = s.lastBlockSeen;
    if (n == null || n === '') {
      return { lastBlockSeen: null };
    }
    const num = Number(n);
    return { lastBlockSeen: Number.isFinite(num) ? num : null };
  } catch {
    return { lastBlockSeen: null };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(config.auditStatePath), { recursive: true });
  fs.writeFileSync(config.auditStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function appendAuditLine(obj) {
  fs.mkdirSync(path.dirname(config.auditLogPath), { recursive: true });
  fs.appendFileSync(config.auditLogPath, `${JSON.stringify(obj)}\n`, 'utf8');
}

function blockNumHex(n) {
  if (n === 0) {
    return '0x0';
  }
  return `0x${Number(n).toString(16)}`;
}

function txHashFromBlockTx(tx) {
  if (typeof tx === 'string') {
    return tx;
  }
  if (tx && typeof tx === 'object') {
    return tx.hash || tx.transactionHash || null;
  }
  return null;
}

async function processBlock(web3j, iface, contractAddrLower, blockNum) {
  const resp = await web3j.getBlockByNumber(blockNumHex(blockNum), true);
  const block = resp && resp.result;
  if (!block) {
    return 0;
  }
  const txs = block.transactions;
  if (!Array.isArray(txs) || txs.length === 0) {
    return 0;
  }
  let written = 0;
  for (const tx of txs) {
    const txHash = txHashFromBlockTx(tx);
    if (!txHash) {
      continue;
    }
    const r = await web3j.getTransactionReceipt(txHash);
    const receipt = r && r.result;
    if (!receipt || !Array.isArray(receipt.logs)) {
      continue;
    }
    const to = receipt.to ? String(receipt.to).toLowerCase() : '';
    if (to !== contractAddrLower) {
      continue;
    }
    const blockNumber = parseReceiptBlockNumber(receipt.blockNumber);
    for (const log of receipt.logs) {
      try {
        const ev = iface.parseLog(log);
        if (!ev || !TARGET_EVENTS.has(ev.name)) {
          continue;
        }
        const logIndex =
          log.logIndex != null
            ? typeof log.logIndex === 'string'
              ? parseInt(log.logIndex, 16)
              : Number(log.logIndex)
            : 0;
        appendAuditLine({
          ts: new Date().toISOString(),
          blockNumber,
          txHash,
          logIndex,
          event: ev.name,
          args: serializeEventArgs(iface, ev)
        });
        written += 1;
      } catch (_) {
        /* non-matching log */
      }
    }
  }
  return written;
}

async function tick() {
  if (_running) {
    return;
  }
  if (!config.eventListenerEnabled) {
    return;
  }
  if (!chain.isChainConfigured()) {
    return;
  }
  const addr = String(config.caseRegistryAddr || '').trim().toLowerCase();
  if (!addr || !/^0x[0-9a-f]{40}$/.test(addr)) {
    return;
  }
  const abi = loadAbi();
  if (!abi) {
    return;
  }

  const iface = new ethers.utils.Interface(abi);
  const web3j = chain.getWeb3jService();

  _running = true;
  try {
    const height = await chain.getBlockNumber();
    let state = loadState();
    let from = state.lastBlockSeen;

    if (from == null || from < 0) {
      saveState({ lastBlockSeen: height });
      logger.info({ height }, 'eventListener: initialized lastBlockSeen (no backlog)');
      return;
    }

    if (from >= height) {
      return;
    }

    const to = Math.min(from + MAX_BLOCKS_PER_TICK, height);
    let total = 0;
    for (let b = from + 1; b <= to; b++) {
      const n = await processBlock(web3j, iface, addr, b);
      total += n;
    }
    saveState({ lastBlockSeen: to });
    if (total > 0) {
      logger.info({ from: from + 1, to, written: total }, 'eventListener: appended audit lines');
    }
  } catch (e) {
    logger.warn(
      { err: e && e.message ? String(e.message) : e },
      'eventListener: tick failed'
    );
  } finally {
    _running = false;
  }
}

function start() {
  if (_timer != null) {
    return;
  }
  if (!config.eventListenerEnabled) {
    logger.info('eventListener: disabled (ENABLE_EVENT_LISTENER=0)');
    return;
  }
  if (!chain.isChainConfigured() || !String(config.caseRegistryAddr || '').trim()) {
    logger.info('eventListener: skipped (chain not configured or CASE_REGISTRY_ADDR unset)');
    return;
  }
  if (!loadAbi()) {
    logger.warn('eventListener: skipped (build/CaseRegistry.abi missing — run npm run compile)');
    return;
  }

  void tick();
  _timer = setInterval(() => {
    void tick();
  }, config.eventListenerPollMs);
  if (typeof _timer.unref === 'function') {
    _timer.unref();
  }
  logger.info({ ms: config.eventListenerPollMs }, 'eventListener: started');
}

function stop() {
  if (_timer != null) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { start, stop, tick };
