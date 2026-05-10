# Performance drivers (Blockchain integration)

Runs from **api-gateway** root unless noted.

Shared env keys (prepend to commands or `.env`):

- `MAIL_DRY_RUN=1`
- `X_AUTH_TOKEN_SINGLE_USE=0`
- `OTP_TTL_MS>=3600000`
- `PERF_INJECT_POLICE_OTP=1` (optional): **`acquireToken` / `acquirePoliceToken` skip `/login` and the mailer**; a 16-hex OTP is written straight into the in-process `tokenStore` (same mechanism as unit tests). Use when you must not trigger police login / email logging at all.
- `RECORD_STORE_PATH`: each script overrides with temp store by default.

See **[../../docs/evidence/perf/README.md](../../docs/evidence/perf/README.md)** for layout (raw JSONL under **`results/EX/`** per experiment) and future methodology.

Quick links:

```bash
node scripts/perf/precheck.js
npm run perf:e1:smoke
npm run perf:e1:full
npm run perf:e1:csv-from-jsonl
npm run perf:e1:md-from-jsonl
npm run perf:e2:payload-sanity
npm run perf:e2
npm run perf:e2:smoke   # E2.3: 10K x3, temp JSONL, [E2 smoke] line
npm run perf:e2:full    # E2.4: 5 tiers x30, gates
npm run perf:e2:csv-from-jsonl
npm run perf:e2:md-from-jsonl
npm run perf:e3:smoke       # temp JSONL, level=2
npm run perf:e3:full        # canon path + gates
npm run perf:e3:csv-from-jsonl
npm run perf:e3:md-from-jsonl
npm run perf:e3:pair           # E3 dual-run: crud vs dual-tx contract JSONL under results/E3
npm run perf:e3:pair:smoke
npm run perf:e3b:single-arms  # E3b: crud vs CaseRegistry-only single-tx, outputs under results/E3b
npm run perf:e3b:single-arms:smoke
node scripts/perf/e3-concurrency.js --levels 2 --duration 5s --size 100KB --dry
npm run perf:e4:chain-mock-sanity
npm run perf:e4:mock-sanity
npm run perf:e4:smoke
npm run perf:e4:reuse
npm run perf:e4:full      # 100 live uploads + 100 mock
npm run perf:e5:smoke     # corpus seed + small read sweep
npm run perf:e5:full      # 200 queries + 200 case-exists, canonical paths
npm run perf:e5:aggregate-from-jsonl
npm run perf:e5:md-from-jsonl
node scripts/perf/e1-breakdown.js --iters 5 --size 50KB
npm run perf:e6
npm run perf:e6:smoke
npm run perf:e6:aggregate-from-jsonl
```
