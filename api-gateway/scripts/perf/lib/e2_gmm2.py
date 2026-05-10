#!/usr/bin/env python3
"""1D 2-component Gaussian mixture (EM) — E2 chainMs / caseRegistryMs phase decomposition.

No sklearn dependency; uses NumPy only.

Usage (from repo root or api-gateway):
  python scripts/perf/lib/e2_gmm2.py path/to/e2-sizes.jsonl
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

TIER_ORDER = ["10K", "100K", "1M", "5M", "10M"]


def em_gmm1d_2(x: np.ndarray, max_iter: int = 200, eps: float = 1e-6) -> tuple:
    """Fit 2-component 1D Gaussian mixture. Returns (weights, means, stds, log_lik_last)."""
    x = np.asarray(x, dtype=float).ravel()
    n = x.size
    if n < 4:
        raise ValueError("need at least 4 samples for 2-component GMM")

    # init: split by median
    med = float(np.median(x))
    lo = x[x <= med]
    hi = x[x > med]
    if lo.size == 0 or hi.size == 0:
        q1, q3 = np.percentile(x, [25, 75])
        lo = x[x <= q1]
        hi = x[x >= q3]
        if lo.size == 0:
            lo = x[: n // 2]
        if hi.size == 0:
            hi = x[n // 2 :]

    m1 = float(np.mean(lo))
    m2 = float(np.mean(hi))
    if m1 > m2:
        m1, m2 = m2, m1
    v1 = max(float(np.var(lo)), 1.0)
    v2 = max(float(np.var(hi)), 1.0)

    w = np.array([0.5, 0.5], dtype=float)
    mu = np.array([m1, m2], dtype=float)
    var = np.array([v1, v2], dtype=float)

    ll_old = -math.inf

    for _ in range(max_iter):
        # E-step responsibilities (log space for stability)
        # log N(x|mu,sigma) = -0.5 log(2pi*var) - (x-mu)^2/(2var)
        def log_norm(xx: np.ndarray, m: float, v: float) -> np.ndarray:
            v = max(v, 1e-6)
            return -0.5 * (math.log(2 * math.pi * v)) - (xx - m) ** 2 / (2 * v)

        log_r1 = math.log(max(w[0], 1e-12)) + log_norm(x, mu[0], var[0])
        log_r2 = math.log(max(w[1], 1e-12)) + log_norm(x, mu[1], var[1])
        m_lr = np.maximum(log_r1, log_r2)
        resp1_num = np.exp(log_r1 - m_lr)
        resp2_num = np.exp(log_r2 - m_lr)
        denom = resp1_num + resp2_num + 1e-300
        r1 = resp1_num / denom
        r2 = resp2_num / denom

        # log-likelihood
        ll = float(np.sum(np.log(denom) + m_lr))

        # M-step
        nk1 = float(np.sum(r1)) + 1e-12
        nk2 = float(np.sum(r2)) + 1e-12
        w_new = np.array([nk1 / n, nk2 / n])
        mu1 = float(np.sum(r1 * x) / nk1)
        mu2 = float(np.sum(r2 * x) / nk2)
        var1 = float(np.sum(r1 * (x - mu1) ** 2) / nk1)
        var2 = float(np.sum(r2 * (x - mu2) ** 2) / nk2)

        mu_new = np.array([mu1, mu2])
        var_new = np.array([max(var1, 1e-6), max(var2, 1e-6)])

        if ll - ll_old < eps and np.all(np.abs(mu_new - mu) < eps) and np.all(np.abs(w_new - w) < eps):
            w, mu, var = w_new, mu_new, var_new
            ll_old = ll
            break
        w, mu, var = w_new, mu_new, var_new
        ll_old = ll

    std = np.sqrt(var)
    return w, mu, std, ll_old


def pooled_mean(weights: np.ndarray, means: np.ndarray) -> float:
    return float(np.dot(weights, means))


def reorder_fast_slow(weights: np.ndarray, means: np.ndarray, stds: np.ndarray):
    """Component 0 = fast (smaller mean), component 1 = slow."""
    order = np.argsort(means)
    w = weights[order]
    m = means[order]
    s = stds[order]
    return w, m, s


def main():
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        sys.exit(2)
    path = Path(argv[0])

    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))

    by_tier = {t: [] for t in TIER_ORDER}
    for r in rows:
        t = r.get("sizeTier")
        if t in by_tier and r.get("ok") is True:
            by_tier[t].append(r)

    print("| sizeTier | metric | naive_mean | pooled_GMM_mean | pi_fast | mu_fast_ms | sigma_fast | pi_slow | mu_slow_ms | sigma_slow |")
    print("|:---:|:---|---:|---:|---:|---:|---:|---:|---:|---:|")

    for t in TIER_ORDER:
        lst = by_tier[t]
        if len(lst) < 4:
            continue
        for key, label in [("chainMs", "chainMs"), ("caseRegistryMs", "caseRegistryMs")]:
            x = np.array([float(r[key]) for r in lst])
            naive = float(np.mean(x))
            w, mu, std, ll = em_gmm1d_2(x)
            w, mu, std = reorder_fast_slow(w, mu, std)
            pooled = pooled_mean(w, mu)
            print(
                f"| {t} | {label} | {naive:.2f} | {pooled:.2f} | "
                f"{w[0]:.3f} | {mu[0]:.2f} | {std[0]:.2f} | "
                f"{w[1]:.3f} | {mu[1]:.2f} | {std[1]:.2f} |"
            )

    print()
    print("Notes: pooled_GMM_mean = pi_fast * mu_fast + pi_slow * mu_slow (equals naive mean only if labeling is stable).")
    print("Components sorted by ascending mean (fast then slow). Log-likelihood omitted for brevity.")


if __name__ == "__main__":
    main()
