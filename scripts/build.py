"""
Fogo Alerta - Burning Activity Calendar (NASA Space Apps 2026)
Harmonization of MODIS and VIIRS (NOAA-20) active-fire hotspots for the Amazonas region.

Input : aggregated hotspot counts exported from NASA FIRMS country yearly files
        (cell x month x sensor x day/night), produced by the in-browser loader.
Output: site/data.json (compact data for the web app) + work/report.md (validation).

Method (ratio-of-sums calibration, transparent and reproducible):
  - Reference sensor: VIIRS 375 m on NOAA-20 (continuity sensor; S-NPP stopped Nov/2026).
  - Predictor: MODIS 1 km (Terra + Aqua), split into day and night detections.
  - For each calendar month m and pass d (Day/Night), factor k[m,d] = sum(VIIRS) / sum(MODIS)
    over the overlap years (2018-2025). VIIRS-equivalent counts before 2018 are
    k[m,d] * MODIS[m,d]. From 2018 on, the observed VIIRS counts are used.
  - Validation: 2023 is held out, factors are fitted on the other overlap years and the
    prediction for 2023 is compared with the real VIIRS counts.
"""
import gzip, json, sys
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "work" / "fogo_alerta_dados.json.gz"
raw = json.loads(gzip.open(src, "rt", encoding="utf-8").read())
G = raw["grid"]
NJ = round((G["lonMax"] - G["lonMin"]) / G["res"])

df = pd.DataFrame(raw["agg"], columns=["sd", "ym", "cell", "n", "frp"])
df["s"] = df.sd.str[0]          # A=Aqua, T=Terra, V=VIIRS NOAA-20
df["d"] = df.sd.str[1]          # D/N
df["year"] = df.ym.str[:4].astype(int)
df["moy"] = df.ym.str[5:7].astype(int)
df["mod"] = df.s.isin(["A", "T"])
print("rows", len(df), "detections", int(df.n.sum()))

OVERLAP = list(range(2018, 2026))
HOLDOUT = 2023


def region_monthly(frame):
    g = frame.groupby(["year", "moy", "d", "mod"]).n.sum().unstack("mod", fill_value=0)
    g.columns = ["viirs" if not c else "modis" for c in g.columns]
    return g.reset_index()


reg = region_monthly(df)


def fit_factors(years, sensors=("A", "T")):
    sub = df[df.year.isin(years)]
    m = sub[sub.s.isin(sensors)].groupby(["moy", "d"]).n.sum()
    v = sub[sub.s == "V"].groupby(["moy", "d"]).n.sum()
    k = (v / m).replace([np.inf], np.nan)
    # fallback for sparse month/pass combos: pooled ratio for that pass
    pooled = sub[sub.s == "V"].groupby("d").n.sum() / sub[sub.s.isin(sensors)].groupby("d").n.sum()
    out = {}
    for mo in range(1, 13):
        for d in "DN":
            val = k.get((mo, d), np.nan)
            if not np.isfinite(val) or m.get((mo, d), 0) < 30:
                val = pooled[d]
            out[(mo, d)] = float(val)
    return out


def predict(frame_year, k, sensors=("A", "T")):
    sub = frame_year[frame_year.s.isin(sensors)].copy()
    sub["kk"] = [k[(mo, d)] for mo, d in zip(sub.moy, sub.d)]
    sub["pred"] = sub.n * sub.kk
    return sub


def evaluate(k, sensors, label):
    yr = df[df.year == HOLDOUT]
    pred = predict(yr, k, sensors)
    obs = yr[yr.s == "V"]
    # region monthly
    pm = pred.groupby("moy").pred.sum()
    om = obs.groupby("moy").n.sum()
    mm = pd.concat([om.rename("obs"), pm.rename("pred")], axis=1).fillna(0)
    annual_err = (mm.pred.sum() - mm.obs.sum()) / mm.obs.sum()
    wape = (mm.pred - mm.obs).abs().sum() / mm.obs.sum()
    r_month = np.corrcoef(mm.obs, mm.pred)[0, 1]
    # cell x month
    pc = pred.groupby(["cell", "moy"]).pred.sum()
    oc = obs.groupby(["cell", "moy"]).n.sum()
    cc = pd.concat([oc.rename("obs"), pc.rename("pred")], axis=1).fillna(0)
    r_cell = np.corrcoef(cc.obs, cc.pred)[0, 1]
    # cell annual totals (what a manager sees for an area)
    ca = cc.groupby(level=0).sum()
    r_cell_year = np.corrcoef(ca.obs, ca.pred)[0, 1]
    # naive (no harmonization): MODIS counts as if they were VIIRS
    naive = yr[yr.s.isin(sensors)].n.sum()
    naive_err = (naive - mm.obs.sum()) / mm.obs.sum()
    return dict(label=label, annual_error=annual_err, wape_monthly=wape, r_monthly=r_month,
                r_cell_month=r_cell, r_cell_year=r_cell_year, naive_error=naive_err,
                monthly=mm.reset_index().to_dict(orient="records"))


train = [y for y in OVERLAP if y != HOLDOUT]
models = {
    "global ratio (day/night)": None,
    "monthly ratio, Terra+Aqua": ("A", "T"),
    "monthly ratio, Aqua only": ("A",),
}
results = []
# global ratio model
sub = df[df.year.isin(train)]
kg = {}
for d in "DN":
    r_ = sub[(sub.s == "V") & (sub.d == d)].n.sum() / sub[(sub.s.isin(["A", "T"])) & (sub.d == d)].n.sum()
    for mo in range(1, 13):
        kg[(mo, d)] = float(r_)
results.append(evaluate(kg, ("A", "T"), "global ratio (day/night), Terra+Aqua"))
kTA = fit_factors(train, ("A", "T"))
results.append(evaluate(kTA, ("A", "T"), "monthly ratio (day/night), Terra+Aqua"))
kA = fit_factors(train, ("A",))
results.append(evaluate(kA, ("A",), "monthly ratio (day/night), Aqua only"))

for r in results:
    print(f"{r['label']:45s} annual_err={r['annual_error']:+.1%} WAPE={r['wape_monthly']:.1%} "
          f"r_month={r['r_monthly']:.3f} r_cell_month={r['r_cell_month']:.3f} r_cell_year={r['r_cell_year']:.3f} naive_err={r['naive_error']:+.1%}")

best = min(results, key=lambda r: r["wape_monthly"])
print("best:", best["label"])
best_sensors = ("A",) if "Aqua only" in best["label"] else ("A", "T")

# ratio stability per year (orbit drift check)
stab = []
for y in OVERLAP:
    s_ = df[df.year == y]
    v = s_[s_.s == "V"].n.sum()
    m = s_[s_.s.isin(best_sensors)].n.sum()
    stab.append({"year": y, "viirs": int(v), "modis": int(m), "ratio": round(v / m, 2) if m else None})
print("ratio by year:", [(x["year"], x["ratio"]) for x in stab])

# final factors on all overlap years
if "global" in best["label"]:
    sub = df[df.year.isin(OVERLAP)]
    kf = {}
    for d in "DN":
        r_ = sub[(sub.s == "V") & (sub.d == d)].n.sum() / sub[(sub.s.isin(best_sensors)) & (sub.d == d)].n.sum()
        for mo in range(1, 13):
            kf[(mo, d)] = float(r_)
else:
    kf = fit_factors(OVERLAP, best_sensors)

# ---------- site data ----------
months = pd.period_range("2000-11", "2025-12", freq="M")
mi_of = {str(p): i for i, p in enumerate(months)}
df["mi"] = df.ym.map(mi_of)
use = df[(df.s == "V") | (df.s.isin(best_sensors))].copy()
use["col"] = np.where(use.s == "V", np.where(use.d == "D", "vd", "vn"), np.where(use.d == "D", "md", "mn"))
piv = use.groupby(["cell", "mi", "col"]).n.sum().unstack("col", fill_value=0)
for c in ["md", "mn", "vd", "vn"]:
    if c not in piv:
        piv[c] = 0
piv = piv[["md", "mn", "vd", "vn"]].astype(int).reset_index()
cells = {}
for cell, grp in piv.groupby("cell"):
    flat = grp[["mi", "md", "mn", "vd", "vn"]].to_numpy().ravel().tolist()
    cells[int(cell)] = flat

validation_monthly = best["monthly"]
out = {
    "grid": G,
    "nj": NJ,
    "months_start": "2000-11",
    "n_months": len(months),
    "viirs_start": "2018-01",
    "modis_sensors": "Terra+Aqua" if len(best_sensors) == 2 else "Aqua",
    "factors": {f"{mo:02d}{d}": round(kf[(mo, d)], 4) for mo in range(1, 13) for d in "DN"},
    "validation": {
        "holdout_year": HOLDOUT,
        "models": [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items() if k != "monthly"} for r in results],
        "chosen": best["label"],
        "monthly": [{"moy": int(x["moy"]), "obs": int(x["obs"]), "pred": round(float(x["pred"]), 1)} for x in validation_monthly],
        "ratio_by_year": stab,
    },
    "cells": cells,
}
(ROOT / "site").mkdir(exist_ok=True)
js = json.dumps(out, separators=(",", ":"))
(ROOT / "site" / "data.json").write_text(js)
print("data.json", round(len(js) / 1e6, 2), "MB; cells", len(cells))

# report
lines = ["# Validation report", "", f"Hold-out year: {HOLDOUT}; overlap years: {OVERLAP[0]}-{OVERLAP[-1]}", ""]
lines.append("| model | annual error | monthly WAPE | r (region, monthly) | r (cell x month) | r (cell, annual) | naive error |")
lines.append("|---|---|---|---|---|---|---|")
for r in results:
    lines.append(f"| {r['label']} | {r['annual_error']:+.1%} | {r['wape_monthly']:.1%} | {r['r_monthly']:.3f} | {r['r_cell_month']:.3f} | {r['r_cell_year']:.3f} | {r['naive_error']:+.1%} |")
lines += ["", f"Chosen: {best['label']}", "", "Ratio VIIRS/MODIS by year: " + ", ".join(f"{x['year']}: {x['ratio']}" for x in stab)]
lines += ["", "Final factors k[month, pass]:"]
for mo in range(1, 13):
    lines.append(f"- {mo:02d}: day {kf[(mo,'D')]:.2f}, night {kf[(mo,'N')]:.2f}")
(ROOT / "work" / "report.md").write_text("\n".join(lines))
print("\n".join(lines))
