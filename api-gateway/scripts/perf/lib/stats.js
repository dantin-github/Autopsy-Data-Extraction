'use strict';

/**
 * Welford / online merging for sample mean & variance without storing samples.
 * Use {@link quantiles} when you also need percentiles (requires all values).
 */
class OnlineMeanVar {
  constructor() {
    /** @private */
    this._n = 0;
    /** @private */
    this._mean = 0;
    /** @private */
    this._m2 = 0;
  }

  push(x) {
    const v = Number(x);
    if (!Number.isFinite(v)) {
      return this;
    }
    this._n += 1;
    const delta = v - this._mean;
    this._mean += delta / this._n;
    const delta2 = v - this._mean;
    this._m2 += delta * delta2;
    return this;
  }

  get n() {
    return this._n;
  }

  /** @returns {number} NaN if n===0 */
  get mean() {
    return this._n ? this._mean : NaN;
  }

  /** Bessel corrected; returns 0 when there are fewer than two samples. */
  sampleVariance() {
    if (this._n < 2) {
      return 0;
    }
    return this._m2 / (this._n - 1);
  }

  populationVariance() {
    if (this._n < 1) {
      return NaN;
    }
    return this._m2 / this._n;
  }

  sampleStd() {
    return Math.sqrt(this.sampleVariance());
  }

  populationStd() {
    return Math.sqrt(this.populationVariance());
  }

  /**
   * Combined statistics after aggregating shards (parallel workers).
   * @param {OnlineMeanVar} a
   * @param {OnlineMeanVar} b
   */
  static merge(a, b) {
    if (!a._n) {
      const o = new OnlineMeanVar();
      o._n = b._n;
      o._mean = b._mean;
      o._m2 = b._m2;
      return o;
    }
    if (!b._n) {
      const o = new OnlineMeanVar();
      o._n = a._n;
      o._mean = a._mean;
      o._m2 = a._m2;
      return o;
    }
    const n = a._n + b._n;
    const delta = b._mean - a._mean;
    const merged = new OnlineMeanVar();
    merged._n = n;
    merged._mean = a._mean + (delta * b._n) / n;
    merged._m2 = a._m2 + b._m2 + (delta * delta * a._n * b._n) / n;
    return merged;
  }

  snapshot() {
    return {
      n: this._n,
      mean: this.mean,
      varianceSample: this.sampleVariance(),
      stdSample: this.sampleStd(),
      variancePop: this.populationVariance(),
      stdPop: this.populationStd()
    };
  }
}

/** @param {number[]} sorted */
function pct(sorted, p) {
  if (!sorted.length) {
    return NaN;
  }
  const idx = (p / 100) * (sorted.length - 1);
  const low = Math.floor(idx);
  const high = Math.ceil(idx);
  if (low === high) {
    return sorted[low];
  }
  return sorted[low] + (sorted[high] - sorted[low]) * (idx - low);
}

function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    p99: pct(sorted, 99)
  };
}

/** Sample standard deviation */
function sampleStd(values) {
  if (values.length < 2) {
    return 0;
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

function cv(values) {
  const m =
    values.length === 0 ? NaN : values.reduce((a, b) => a + b, 0) / values.length;
  if (!m || Number.isNaN(m)) {
    return NaN;
  }
  return sampleStd(values) / m;
}

/** Simple linear Pearson r between xs and ys (same length). */
function pearsonR(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) {
    return NaN;
  }
  const sx = xs.slice(0, n);
  const sy = ys.slice(0, n);
  const mx = sx.reduce((a, b) => a + b, 0) / n;
  const my = sy.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = sx[i] - mx;
    const vy = sy[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? NaN : num / denom;
}

/**
 * `concurrency` workers each loops until wall clock exceeds `durationMs`.
 * @returns {{ results: *, wallMs: number, observedConcurrencyPeak: number }}
 */
async function runForDuration(workerFn, concurrency, durationMs) {
  const results = [];
  const started = Date.now();
  const c = Math.max(1, Math.floor(Number(concurrency) || 1));

  async function runner() {
    while (Date.now() - started < durationMs) {
      try {
        const r = await workerFn();
        results.push(r);
      } catch (e) {
        results.push({ ok: false, error: String((e && e.message) || e) });
      }
    }
  }

  await Promise.all(Array.from({ length: c }, () => runner()));
  const wallMs = Date.now() - started;
  return { results, wallMs, observedConcurrencyPeak: c };
}

module.exports = {
  OnlineMeanVar,
  pct,
  quantiles,
  sampleStd,
  cv,
  pearsonR,
  runForDuration
};
