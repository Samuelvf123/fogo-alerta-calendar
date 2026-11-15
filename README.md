# Fogo Alerta · Burning Activity Calendar

**NASA Space Apps Challenge 2026** · Challenge: *Harmonization of MODIS and VIIRS Hot Spots* · Team **Fogo Alerta** (Manaus local event)

Live app: https://samuelvf123.github.io/fogo-alerta-calendar/

## What it does
Satellites have recorded fire hotspots over the Amazon for more than 20 years, but the record is split between two sensors:
MODIS (1 km pixels, since 2000) and VIIRS (375 m pixels, which sees many more and smaller fires).
Stitching them naively creates a fake jump in fire activity when VIIRS starts.

This web app puts both records on the same scale (VIIRS-equivalent hotspots) for the Amazonas region (10°S–2.5°N, 74°W–56°W), 2000–2025, and lets anyone:

- choose an area (presets such as Autazes, Lábrea, Apuí, Humaitá, a point + radius, or a rectangle drawn on the map) and a period;
- see a **burning activity calendar** (years × months) with an accessible color ramp, in harmonized units or as anomaly versus the historical median of each month;
- compare raw MODIS, raw VIIRS, naive merge and harmonized yearly totals;
- see the typical fire season (median and middle 50%) and compare any year with it;
- check the **validation** (a hidden year predicted from MODIS and compared with real VIIRS);
- download a **CSV** with the monthly series of the selected area;
- preview the kind of community alert our Telegram assistant *Fogo Alerta* can send with this historical context.

## Method
1. Data: NASA FIRMS country yearly summaries (standard processing), Brazil files, filtered to the region and to detections of type 0 (presumed vegetation fire; static sources such as gas flares are excluded).
   - MODIS Collection 6.1 active fires, Terra + Aqua (Nov 2000 – Dec 2025)
   - VIIRS 375 m active fires, NOAA-20 (2018 – 2025). NOAA-20 is used as the reference because Suomi NPP data delivery ended in Nov 2026.
2. Aggregation: counts per 0.25° cell, month, sensor and day/night pass.
3. Harmonization: for each calendar month *m* and pass *d* (day/night), factor *k[m,d]* = Σ VIIRS / Σ MODIS over the overlap years 2018–2025. Before 2018, VIIRS-equivalent hotspots = *k* × MODIS; from 2018 on, observed VIIRS counts are used.
4. Validation: 2023 is held out, factors are fitted on the other overlap years, 2023 is predicted from MODIS and compared with real VIIRS (region monthly totals and cell-level correlations). Three variants are compared (single ratio, monthly ratio Terra+Aqua, monthly ratio Aqua only); the best is used.

Scripts: `scripts/loader.js` (in-browser loader that streams the FIRMS CSVs and aggregates them), `scripts/build.py` (harmonization, validation and `data.json`).

## Limits
Hotspots are fire pixels, not individual fires or burned area. Clouds and smoke hide fires. One region-wide factor per month and pass. MODIS orbit drift after 2020 is checked through the yearly ratio. 2026 standard-processing data were not yet available.

## Credits and references
- NASA FIRMS (Fire Information for Resource Management System), MODIS C6.1 and VIIRS 375 m (NOAA-20) active fire products.
- Leaflet (BSD-2-Clause), Chart.js (MIT), OpenStreetMap base map (© OpenStreetMap contributors, ODbL).

## Use of AI
Code and texts were written with assistance from Claude (Anthropic), an AI assistant. The team defined the idea (connecting a harmonized fire calendar to the Fogo Alerta community-alert assistant and converting MODIS to the VIIRS scale with a measured relationship), reviewed the method and checked the results.

## Team
Samuel Vieira Filgueiras · Elionay Ramalho Garcia · Aline de Castro Pereira · Bruno César de Souza Falcão · Victor Icaro Barbosa Uchoa

License: MIT
