'use strict';

/**
 * Runs scripts/perf/precheck.js with PERF_PRECHECK_UPLOAD_CRUD_ONLY=1 (chain + keystores only).
 * Convenience for Windows shells without inline env assignments.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const apiRoot = path.join(__dirname, '..', '..');

const precheck = path.join(__dirname, 'precheck.js');

const env = {
  ...process.env,
  PERF_PRECHECK_UPLOAD_CRUD_ONLY: '1'
};

const sub = spawnSync(process.execPath, [precheck], {
  cwd: apiRoot,
  env,
  stdio: 'inherit'
});

process.exit(typeof sub.status === 'number' ? sub.status : 1);
