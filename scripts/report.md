# Validation report

Hold-out year: 2023; overlap years: 2018-2025

| model | annual error | monthly WAPE | r (region, monthly) | r (cell x month) | r (cell, annual) | naive error |
|---|---|---|---|---|---|---|
| global ratio (day/night), Terra+Aqua | -4.4% | 7.9% | 0.994 | 0.961 | 0.977 | -74.2% |
| monthly ratio (day/night), Terra+Aqua | -0.2% | 3.1% | 0.999 | 0.962 | 0.977 | -74.2% |
| monthly ratio (day/night), Aqua only | -0.1% | 4.5% | 0.999 | 0.937 | 0.966 | -82.2% |
| monthly ratio (day/night), Terra only - used before Aqua | +0.8% | 7.8% | 0.996 | 0.893 | 0.914 | -91.9% |

Chosen: monthly ratio (day/night), Terra+Aqua

Ratio VIIRS/MODIS by year: 2018: 3.44, 2019: 3.63, 2020: 4.14, 2021: 3.7, 2022: 3.82, 2023: 3.87, 2024: 3.85, 2025: 4.37

Sensitivity: factors fitted on 2018-2019 only (before MODIS orbit drift) change pre-2018 VIIRS-equivalent totals by -0.6%.

Aqua starts 2002-07; before that month Terra-only factors are used.

Final factors k[month, pass] (Terra+Aqua | Terra only):
- 01: day 3.04, night 3.68 | Terra only: day 16.44, night 4.99
- 02: day 2.27, night 3.51 | Terra only: day 8.42, night 4.81
- 03: day 2.73, night 3.49 | Terra only: day 7.52, night 4.93
- 04: day 3.13, night 5.09 | Terra only: day 10.41, night 7.47
- 05: day 4.08, night 9.38 | Terra only: day 16.21, night 13.75
- 06: day 3.57, night 7.56 | Terra only: day 15.17, night 10.19
- 07: day 3.08, night 5.68 | Terra only: day 15.99, night 8.12
- 08: day 3.24, night 5.43 | Terra only: day 13.76, night 7.87
- 09: day 3.16, night 6.28 | Terra only: day 14.95, night 8.76
- 10: day 4.11, night 5.99 | Terra only: day 19.67, night 7.62
- 11: day 3.68, night 7.70 | Terra only: day 17.68, night 9.78
- 12: day 3.33, night 4.93 | Terra only: day 21.00, night 6.15