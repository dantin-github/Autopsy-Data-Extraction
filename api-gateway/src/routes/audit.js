'use strict';

const express = require('express');
const config = require('../config');
const { readAuditLines } = require('../services/auditLog');
const { enrichAuditItems } = require('../services/auditEnrichment');
const requireJudgeSession = require('../middleware/requireJudgeSession');

const router = express.Router();

/**
 * GET /api/audit — judge session; read CaseRegistry audit JSONL (P8).
 * Query: limit (default 50, max 500), since (ISO date or unix ms)
 */
router.get('/api/audit', requireJudgeSession, async (req, res, next) => {
  try {
    const limitRaw = req.query.limit;
    const limit =
      limitRaw != null && String(limitRaw).trim() !== ''
        ? parseInt(String(limitRaw), 10)
        : 50;
    const since = req.query.since != null ? String(req.query.since) : null;

    const lim = Number.isFinite(limit) && limit > 0 ? limit : 50;
    const rawItems = readAuditLines({
      limit: lim,
      since,
      auditLogPath: config.auditLogPath
    });
    const items = await enrichAuditItems(rawItems);

    return res.status(200).json({
      items,
      limit: Math.min(Math.max(lim, 1), 500)
    });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
