/* Fogo Alerta - Burning Activity Calendar
   Harmonized MODIS + VIIRS (NOAA-20) hotspots, Amazonas region.
   NASA Space Apps Challenge 2026. Code written by team Fogo Alerta with assistance from Claude (Anthropic). */
'use strict';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PRESETS = {
  autazes: {name:'Autazes', lat:-3.58, lon:-59.13, r:50},
  manaus: {name:'Manaus surroundings', lat:-3.12, lon:-60.02, r:60},
  labrea: {name:'Lábrea', lat:-7.26, lon:-64.80, r:80},
  apui: {name:'Apuí', lat:-7.20, lon:-59.90, r:80},
  humaita: {name:'Humaitá', lat:-7.51, lon:-63.02, r:70},
  bocadoacre: {name:'Boca do Acre', lat:-8.75, lon:-67.40, r:70},
  novoaripuana: {name:'Novo Aripuanã', lat:-5.12, lon:-60.38, r:70},
};
const INFERNO = ['#000004','#160b39','#420a68','#6a176e','#932667','#bc3754','#dd513a','#f37819','#fca50a','#f6d746','#fcffa4'];
const PUOR = ['#2d004b','#542788','#8073ac','#b2abd2','#d8daeb','#f2f2f2','#fee0b6','#fdb863','#e08214','#b35806','#7f3b08'];

let D, NJ, G, NM, VS, AS, START_Y, START_M;
let cellIds = [], cellData = {};
let selection = new Set(), areaName = '', selLayer = null, cellLayers = {};
let series = null, map, mode = 'harm';
let charts = {};

const $ = id => document.getElementById(id);
const fmt = v => (v == null || isNaN(v)) ? '–' : Math.round(v).toLocaleString('en-US');
const pct = v => { const p = v * 100, a = Math.abs(p); return (p >= 0 ? '+' : '−') + (a < 10 ? a.toFixed(1) : Math.round(a)) + '%'; };

function lerpColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const x = t * (stops.length - 1), i = Math.floor(x), f = x - i;
  const a = hex(stops[i]), b = hex(stops[Math.min(i + 1, stops.length - 1)]);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}
function hex(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
function textOn(rgb) {
  const m = rgb.match(/\d+/g).map(Number);
  return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) > 140 ? '#111' : '#f4f4f4';
}
function miToYM(mi) { const t = START_Y * 12 + (START_M - 1) + mi; return [Math.floor(t / 12), t % 12 + 1]; }
function ymToMi(y, m) { return y * 12 + (m - 1) - (START_Y * 12 + START_M - 1); }
function cellCenter(c) { const i = Math.floor(c / NJ), j = c % NJ; return [G.latMin + (i + 0.5) * G.res, G.lonMin + (j + 0.5) * G.res]; }
function k(m, dn, mi) { return ((mi != null && mi < AS) ? D.factors_terra : D.factors)[String(m).padStart(2, '0') + dn]; }
function haversine(a, b, c, d) {
  const R = 6371, toR = Math.PI / 180, dLat = (c - a) * toR, dLon = (d - b) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a * toR) * Math.cos(c * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function quantile(arr, q) {
  const a = arr.filter(v => v != null && !isNaN(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return a[lo] + (a[hi] - a[lo]) * (p - lo);
}

async function init() {
  D = await (await fetch('data.json')).json();
  G = D.grid; NJ = D.nj; NM = D.n_months;
  [START_Y, START_M] = D.months_start.split('-').map(Number);
  const [vy, vm] = D.viirs_start.split('-').map(Number);
  VS = ymToMi(vy, vm);
  const [ay, am] = D.aqua_start.split('-').map(Number);
  AS = ymToMi(ay, am);
  for (const [c, flat] of Object.entries(D.cells)) {
    const id = +c; cellIds.push(id);
    const rec = new Map();
    let tot = 0;
    for (let i = 0; i < flat.length; i += 5) { rec.set(flat[i], [flat[i + 1], flat[i + 2], flat[i + 3], flat[i + 4]]); }
    cellData[id] = rec;
  }
  const lastY = miToYM(NM - 1)[0];
  for (let y = START_Y; y <= lastY; y++) {
    $('y0').add(new Option(y, y)); $('y1').add(new Option(y, y)); $('cmpYear').add(new Option(y, y));
  }
  $('y0').value = START_Y + 1; $('y1').value = lastY; $('cmpYear').value = lastY;
  initMap();
  wire();
  selectPreset('autazes');
  $('preset').value = 'autazes';
  renderValidation();
}

/* ---------- harmonized value of one cell-month ---------- */
function cellMonth(rec, mi) {
  const v = rec.get(mi);
  if (!v) return [0, 0, 0, 0];
  return v;
}
function harmOf(mi, md, mn, vd, vn) {
  if (mi >= VS) return vd + vn;
  const m = miToYM(mi)[1];
  return k(m, 'D', mi) * md + k(m, 'N', mi) * mn;
}

function computeSeries() {
  const md = new Float64Array(NM), mn = new Float64Array(NM), vd = new Float64Array(NM), vn = new Float64Array(NM);
  for (const c of selection) {
    const rec = cellData[c]; if (!rec) continue;
    for (const [mi, v] of rec) { md[mi] += v[0]; mn[mi] += v[1]; vd[mi] += v[2]; vn[mi] += v[3]; }
  }
  const harm = [], modis = [], viirs = [], naive = [];
  for (let mi = 0; mi < NM; mi++) {
    harm.push(harmOf(mi, md[mi], mn[mi], vd[mi], vn[mi]));
    modis.push(md[mi] + mn[mi]);
    viirs.push(mi >= VS ? vd[mi] + vn[mi] : null);
    naive.push(mi >= VS ? vd[mi] + vn[mi] : md[mi] + mn[mi]);
  }
  // median per calendar month over all complete years
  const med = [], p25 = [], p75 = [], mean = [];
  for (let m = 1; m <= 12; m++) {
    const vals = [];
    for (let mi = 0; mi < NM; mi++) if (miToYM(mi)[1] === m && miToYM(mi)[0] > START_Y) vals.push(harm[mi]);
    med.push(quantile(vals, .5)); p25.push(quantile(vals, .25)); p75.push(quantile(vals, .75));
    mean.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  }
  series = {md, mn, vd, vn, harm, modis, viirs, naive, med, p25, p75, mean};
}

/* ---------- map ---------- */
function initMap() {
  map = L.map('map', {preferCanvas: true, zoomSnap: .5}).fitBounds([[G.latMin, G.lonMin], [G.latMax, G.lonMax]]);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 12, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  const rend = L.canvas({padding: .3});
  for (const c of cellIds) {
    const [la, lo] = cellCenter(c), h = G.res / 2;
    const r = L.rectangle([[la - h, lo - h], [la + h, lo + h]], {renderer: rend, weight: 0, fillOpacity: .6, interactive: false});
    r.addTo(map); cellLayers[c] = r;
  }
  L.rectangle([[G.latMin, G.lonMin], [G.latMax, G.lonMax]], {color: '#9fb0c0', weight: 1, fill: false, dashArray: '4 4', interactive: false}).addTo(map);
  map.on('click', e => {
    if (drawing) return;
    $('lat').value = e.latlng.lat.toFixed(2); $('lon').value = e.latlng.lng.toFixed(2);
  });
  setupDraw();
}
function colorMap() {
  const y0 = +$('y0').value, y1 = +$('y1').value;
  const a = ymToMi(y0, 1), b = ymToMi(y1, 12);
  const tot = {}; let max = 0;
  for (const c of cellIds) {
    let s = 0;
    for (const [mi, v] of cellData[c]) if (mi >= a && mi <= b) s += harmOf(mi, v[0], v[1], v[2], v[3]);
    tot[c] = s; if (s > max) max = s;
  }
  const lmax = Math.log10(max + 1);
  for (const c of cellIds) {
    const s = tot[c];
    if (s < 0.5) { cellLayers[c].setStyle({fillOpacity: 0}); continue; }
    cellLayers[c].setStyle({fillColor: lerpColor(INFERNO, .15 + .83 * Math.log10(s + 1) / lmax), fillOpacity: .6});
  }
  $('mapLegend').innerHTML = `<div>Hotspots per 0.25° cell, ${y0}–${y1} (harmonized)</div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:4px">1
    <span style="display:inline-block;width:140px;height:10px;border-radius:2px;background:linear-gradient(90deg,${[...Array(9)].map((_, i) => lerpColor(INFERNO, .15 + .83 * i / 8)).join(',')})"></span>${fmt(max)}</div>`;
}

let drawing = false;
function setupDraw() {
  let start = null, rect = null;
  $('drawBtn').onclick = () => {
    drawing = !drawing;
    $('drawBtn').setAttribute('aria-pressed', drawing);
    document.body.classList.toggle('drawing', drawing);
    drawing ? map.dragging.disable() : map.dragging.enable();
  };
  map.on('mousedown', e => {
    if (!drawing) return;
    start = e.latlng;
    rect = L.rectangle([start, start], {color: '#ffd166', weight: 2, fill: false}).addTo(map);
  });
  map.on('mousemove', e => { if (drawing && start && rect) rect.setBounds([start, e.latlng]); });
  map.on('mouseup', e => {
    if (!drawing || !start) return;
    const b = L.latLngBounds(start, e.latlng); map.removeLayer(rect); start = null; rect = null;
    drawing = false; $('drawBtn').setAttribute('aria-pressed', false); document.body.classList.remove('drawing'); map.dragging.enable();
    if (b.getNorth() - b.getSouth() < G.res * .6 || b.getEast() - b.getWest() < G.res * .6) {
      const c = b.getCenter(); b.extend([c.lat - G.res, c.lng - G.res]); b.extend([c.lat + G.res, c.lng + G.res]);
    }
    selectBounds(b, `Custom rectangle (${b.getSouth().toFixed(2)}, ${b.getWest().toFixed(2)}) to (${b.getNorth().toFixed(2)}, ${b.getEast().toFixed(2)})`);
    $('preset').value = '';
  });
}

/* ---------- selection ---------- */
function setSelLayer(layer) { if (selLayer) map.removeLayer(selLayer); selLayer = layer.addTo(map); }
function selectCircle(lat, lon, r, name) {
  selection = new Set();
  for (let i = 0; i < Math.round((G.latMax - G.latMin) / G.res); i++)
    for (let j = 0; j < NJ; j++) {
      const c = i * NJ + j, [la, lo] = cellCenter(c);
      if (haversine(lat, lon, la, lo) <= r) selection.add(c);
    }
  if (!selection.size) { // nearest cell at least
    const i = Math.floor((lat - G.latMin) / G.res), j = Math.floor((lon - G.lonMin) / G.res);
    selection.add(i * NJ + j);
  }
  areaName = name;
  setSelLayer(L.circle([lat, lon], {radius: r * 1000, color: '#ffd166', weight: 2, fill: false}));
  map.fitBounds(selLayer.getBounds(), {maxZoom: 9, padding: [30, 30]});
  refresh();
}
function selectBounds(b, name) {
  selection = new Set();
  const NI = Math.round((G.latMax - G.latMin) / G.res);
  for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) {
    const c = i * NJ + j, [la, lo] = cellCenter(c);
    if (b.contains([la, lo])) selection.add(c);
  }
  areaName = name;
  setSelLayer(L.rectangle(b, {color: '#ffd166', weight: 2, fill: false}));
  if (name !== 'Whole region') map.fitBounds(b, {padding: [30, 30]});
  refresh();
}
function selectPreset(key) {
  if (key === 'all') {
    selectBounds(L.latLngBounds([G.latMin, G.lonMin], [G.latMax, G.lonMax]), 'Whole region');
    map.fitBounds([[G.latMin, G.lonMin], [G.latMax, G.lonMax]]);
    return;
  }
  const p = PRESETS[key]; if (!p) return;
  $('lat').value = p.lat; $('lon').value = p.lon; $('rad').value = p.r;
  selectCircle(p.lat, p.lon, p.r, `${p.name} (${p.r} km radius)`);
}

function wire() {
  $('preset').onchange = e => selectPreset(e.target.value);
  $('applyCircle').onclick = () => {
    const lat = +$('lat').value, lon = +$('lon').value, r = Math.max(15, +$('rad').value);
    if (lat < G.latMin || lat > G.latMax || lon < G.lonMin || lon > G.lonMax) { alertBox('Point is outside the covered region (10°S–2.5°N, 74°W–56°W).'); return; }
    $('preset').value = '';
    selectCircle(lat, lon, r, `Point ${lat.toFixed(2)}, ${lon.toFixed(2)} (${r} km radius)`);
  };
  $('y0').onchange = $('y1').onchange = () => {
    if (+$('y0').value > +$('y1').value) $('y1').value = $('y0').value;
    refresh();
  };
  $('cmpYear').onchange = renderSeason;
  document.querySelectorAll('input[name=mode]').forEach(r => r.onchange = e => { mode = e.target.value; renderCalendar(); });
  $('csvBtn').onclick = downloadCSV;
}
function alertBox(msg) { $('areaInfo').textContent = msg; }

function refresh() {
  computeSeries();
  colorMap();
  renderKPIs();
  renderCalendar();
  renderAnnual();
  renderSeason();
  renderAlert();
}

/* ---------- KPIs ---------- */
function criticalMonths() {
  // uses the mean month (robust when medians are zero in areas with few fires)
  const med = series.mean.map(v => v || 0);
  const total = med.reduce((a, b) => a + b, 0);
  if (total < 1) return null;
  // smallest window of consecutive months holding >= 60% of the typical activity (max 4 months)
  let best = null;
  for (let len = 1; len <= 4; len++) {
    let cand = null;
    for (let s = 0; s < 12; s++) {
      let sum = 0; for (let t = 0; t < len; t++) sum += med[(s + t) % 12];
      if (!cand || sum > cand.sum) cand = {s, len, sum};
    }
    best = cand;
    if (cand.sum / total >= .6) break;
  }
  const a = MONTHS[best.s], b = MONTHS[(best.s + best.len - 1) % 12];
  return {label: best.len === 1 ? a : `${a}–${b}`, share: best.sum / total, start: best.s, len: best.len};
}
function annualTotals(arr) {
  const out = {};
  for (let mi = 0; mi < NM; mi++) { const [y] = miToYM(mi); if (arr[mi] != null) out[y] = (out[y] || 0) + arr[mi]; }
  return out;
}
function renderKPIs() {
  const y0 = +$('y0').value, y1 = +$('y1').value;
  const at = annualTotals(series.harm);
  let tot = 0, peakY = null, peakV = -1;
  for (let y = y0; y <= y1; y++) { const v = at[y] || 0; tot += v; if (v > peakV) { peakV = v; peakY = y; } }
  const full = Object.entries(at).filter(([y]) => +y > START_Y).map(([, v]) => v);
  const medA = quantile(full, .5);
  const last = at[y1] || 0;
  const cm = criticalMonths();
  $('areaInfo').innerHTML = `<b>${areaName}</b> · ${selection.size} grid cells`;
  $('kpis').innerHTML = `
    <div class="kpi"><div class="v">${fmt(tot)}</div><div class="l">hotspots ${y0}–${y1} (VIIRS-equivalent)</div></div>
    <div class="kpi"><div class="v">${cm ? cm.label : '–'}</div><div class="l">critical period${cm ? ` (${Math.round(cm.share * 100)}% of typical yearly activity)` : ''}</div></div>
    <div class="kpi"><div class="v">${peakY ?? '–'}</div><div class="l">most active year in period (${fmt(peakV)})</div></div>
    <div class="kpi"><div class="v">${medA ? pct(last / medA - 1) : '–'}</div><div class="l">${y1} vs. median year (${fmt(medA)})</div></div>`;
}

/* ---------- calendar ---------- */
function valueFor(mi) {
  switch (mode) {
    case 'modis': return series.modis[mi];
    case 'viirs': return series.viirs[mi];
    case 'naive': return series.naive[mi];
    default: return series.harm[mi];
  }
}
function renderCalendar() {
  const y0 = +$('y0').value, y1 = +$('y1').value;
  const tbl = $('cal');
  let max = 0;
  for (let y = y0; y <= y1; y++) for (let m = 1; m <= 12; m++) {
    const mi = ymToMi(y, m); if (mi < 0 || mi >= NM) continue;
    const v = valueFor(mi); if (v != null && v > max) max = v;
  }
  const lmax = Math.log10(max + 1) || 1;
  let h = '<thead><tr><th></th>' + MONTHS.map(m => `<th scope="col">${m}</th>`).join('') + '<th scope="col">Year</th></tr></thead><tbody>';
  for (let y = y1; y >= y0; y--) {
    h += `<tr><td class="yr">${y}</td>`;
    let ysum = 0, yn = 0;
    for (let m = 1; m <= 12; m++) {
      const mi = ymToMi(y, m);
      if (mi < 0 || mi >= NM) { h += '<td class="na" title="no data">·</td>'; continue; }
      const v = valueFor(mi);
      if (v == null) { h += '<td class="na" title="sensor not available">·</td>'; continue; }
      ysum += v; yn++;
      let bg, label;
      if (mode === 'anom') {
        const med = series.med[m - 1] || 0;
        const r = Math.log2((v + 1) / (med + 1));
        bg = lerpColor(PUOR, .5 + Math.max(-2, Math.min(2, r)) / 4);
        label = med > 0 ? pct(v / med - 1) : fmt(v);
        if (v < 0.5 && med < 0.5) label = '0';
      } else {
        bg = v < 0.5 ? '#1b2733' : lerpColor(INFERNO, .15 + .83 * Math.log10(v + 1) / lmax);
        label = v < 0.5 ? '0' : fmt(v);
      }
      h += `<td tabindex="0" data-mi="${mi}" style="background:${bg};color:${v < 0.5 && mode !== 'anom' ? '#5d7184' : textOn(bg)}">${label}</td>`;
    }
    h += `<td class="tot">${yn ? fmt(ysum) : ''}</td></tr>`;
  }
  tbl.innerHTML = h + '</tbody>';
  tbl.querySelectorAll('td[data-mi]').forEach(td => {
    td.onmouseenter = td.onfocus = e => showTip(e, +td.dataset.mi);
    td.onmouseleave = td.onblur = hideTip;
  });
  const ex = {
    harm: 'Number of satellite fire hotspots per month, in VIIRS-equivalent units: observed VIIRS from 2018, converted MODIS before. One consistent scale for 2000–2025.',
    anom: 'Each month compared with the median of the same month across 2001–2025 (harmonized). Orange = more fire than usual, purple = less.',
    naive: 'What you get by simply stitching MODIS (until 2017) and VIIRS (from 2018): the jump in 2018 is an artifact of the sensor change, not more fire.',
    modis: 'Raw MODIS (1 km) hotspots, Terra + Aqua, day and night.',
    viirs: 'Raw VIIRS 375 m hotspots (NOAA-20), available from 2018.'
  };
  $('calExplain').textContent = ex[mode];
  if (mode === 'anom') {
    $('calLegend').innerHTML = `less than usual <span class="bar" style="background:linear-gradient(90deg,${PUOR.join(',')})"></span> more than usual (×4)`;
  } else {
    $('calLegend').innerHTML = `0 <span class="bar" style="background:linear-gradient(90deg,${[...Array(9)].map((_, i) => lerpColor(INFERNO, .15 + .83 * i / 8)).join(',')})"></span> ${fmt(max)} hotspots/month (log scale)`;
  }
}
function showTip(e, mi) {
  const [y, m] = miToYM(mi);
  const med = series.med[m - 1];
  const kd = k(m, 'D', mi), kn = k(m, 'N', mi);
  const t = $('tip');
  let conv = mi >= VS ? `Observed VIIRS: ${fmt(series.vd[mi])} day + ${fmt(series.vn[mi])} night`
    : `MODIS${mi < AS ? ' (Terra only)' : ''} ${fmt(series.md[mi])} day × ${kd.toFixed(2)} + ${fmt(series.mn[mi])} night × ${kn.toFixed(2)}`;
  t.innerHTML = `<b>${MONTHS[m - 1]} ${y}</b><br>Harmonized: <b>${fmt(series.harm[mi])}</b><br>${conv}<br>
    Raw MODIS: ${fmt(series.modis[mi])}${series.viirs[mi] != null ? ` · Raw VIIRS: ${fmt(series.viirs[mi])}` : ''}<br>
    Median ${MONTHS[m - 1]}: ${fmt(med)}${med > 0 ? ` (${pct(series.harm[mi] / med - 1)})` : ''}`;
  t.hidden = false;
  const r = e.target.getBoundingClientRect();
  t.style.left = Math.min(window.innerWidth - 290, r.left) + 'px';
  t.style.top = (r.bottom + 6) + 'px';
}
function hideTip() { $('tip').hidden = true; }

/* ---------- charts ---------- */
Chart.defaults.color = '#9fb0c0';
Chart.defaults.borderColor = '#26384a';
Chart.defaults.font.family = 'system-ui,Segoe UI,Roboto,Arial,sans-serif';
function mkChart(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($(id), cfg); }
function renderAnnual() {
  const y0 = Math.max(START_Y + 1, +$('y0').value), y1 = +$('y1').value;
  const years = []; for (let y = y0; y <= y1; y++) years.push(y);
  const A = s => { const t = annualTotals(series[s]); return years.map(y => t[y] ?? null); };
  const viirs = annualTotals(series.viirs);
  mkChart('annualChart', {
    type: 'line',
    data: {labels: years, datasets: [
      {label: 'Harmonized (VIIRS-equivalent)', data: A('harm'), borderColor: '#ffd166', backgroundColor: '#ffd166', borderWidth: 3, tension: .2},
      {label: 'Naive merge', data: A('naive'), borderColor: '#ff5d73', borderDash: [6, 4], borderWidth: 2, tension: .2, pointRadius: 2},
      {label: 'MODIS raw', data: A('modis'), borderColor: '#4cc9f0', borderWidth: 2, tension: .2, pointRadius: 2},
      {label: 'VIIRS raw', data: years.map(y => y >= +D.viirs_start.slice(0, 4) ? viirs[y] ?? null : null), borderColor: '#b388ff', borderWidth: 2, tension: .2, pointRadius: 2},
    ]},
    options: {responsive: true, maintainAspectRatio: false, interaction: {mode: 'index', intersect: false},
      plugins: {tooltip: {callbacks: {label: c => `${c.dataset.label}: ${fmt(c.parsed.y)}`}}},
      scales: {y: {beginAtZero: true, title: {display: true, text: 'hotspots per year'}}}}
  });
}
function renderSeason() {
  const y = +$('cmpYear').value;
  const yr = MONTHS.map((_, i) => { const mi = ymToMi(y, i + 1); return mi >= 0 && mi < NM ? series.harm[mi] : null; });
  mkChart('seasonChart', {
    type: 'line',
    data: {labels: MONTHS, datasets: [
      {label: '75th percentile', data: series.p75, borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(255,138,61,.18)', fill: '+1'},
      {label: '25th percentile', data: series.p25, borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(255,138,61,.18)', fill: false},
      {label: 'Median 2001–2025', data: series.med, borderColor: '#ff8a3d', borderWidth: 3, tension: .25},
      {label: String(y), data: yr, borderColor: '#4cc9a6', borderWidth: 2, borderDash: [5, 3], tension: .25},
    ]},
    options: {responsive: true, maintainAspectRatio: false, interaction: {mode: 'index', intersect: false},
      plugins: {legend: {labels: {filter: i => !i.text.includes('percentile')}},
        tooltip: {callbacks: {label: c => `${c.dataset.label}: ${fmt(c.parsed.y)}`}}},
      scales: {y: {beginAtZero: true, title: {display: true, text: 'hotspots per month (harmonized)'}}}}
  });
}
function renderValidation() {
  const v = D.validation;
  const mm = v.monthly;
  const chosen = v.models.find(m => m.label === v.chosen);
  $('valExplain').innerHTML = `Based on ${fmt(v.detections)} hotspot detections. We fitted the conversion factors without <b>${v.holdout_year}</b>, converted that year's MODIS hotspots and compared them with the real VIIRS counts for the whole region. Yearly total error: <b>${pct(chosen.annual_error)}</b> (without harmonization: <b>${pct(chosen.naive_error)}</b>). Monthly correlation r = <b>${chosen.r_monthly.toFixed(3)}</b>.`;
  mkChart('valChart', {
    type: 'bar',
    data: {labels: mm.map(x => MONTHS[x.moy - 1]), datasets: [
      {label: `Real VIIRS ${v.holdout_year}`, data: mm.map(x => x.obs), backgroundColor: '#b388ff'},
      {label: 'Predicted from MODIS', data: mm.map(x => x.pred), backgroundColor: '#ffd166'},
    ]},
    options: {responsive: true, maintainAspectRatio: false, plugins: {tooltip: {callbacks: {label: c => `${c.dataset.label}: ${fmt(c.parsed.y)}`}}},
      scales: {y: {beginAtZero: true, title: {display: true, text: 'hotspots per month, whole region'}}}}
  });
  let t = '<table class="t"><tr><th>Model (validated on ' + v.holdout_year + ')</th><th>yearly error</th><th>monthly error (WAPE)</th><th>r cell×month</th><th>r cell, yearly</th></tr>';
  for (const m of v.models) t += `<tr class="${m.label === v.chosen ? 'best' : ''}${m.label.includes('Terra only') ? ' terra' : ''}"><td>${m.label}${m.label === v.chosen ? ' ✓' : ''}</td><td>${pct(m.annual_error)}</td><td>${(m.wape_monthly * 100).toFixed(1)}%</td><td>${m.r_cell_month.toFixed(2)}</td><td>${m.r_cell_year.toFixed(2)}</td></tr>`;
  t += '</table><p class="small">Ratio VIIRS ÷ MODIS by year: ' + v.ratio_by_year.map(r => `${r.year}: ${r.ratio}`).join(' · ') +
    `. It varies with the fire regime and with MODIS orbit drift. Sensitivity check: using only 2018–2019 (before the drift) to fit the factors changes the pre-2018 totals by only ${(v.sensitivity_early * 100).toFixed(1)}%.</p>`;
  $('valTable').innerHTML = t;
  let f = '<table class="t"><tr><th>Month</th>' + MONTHS.map(m => `<th>${m}</th>`).join('') + '</tr>';
  for (const dn of ['D', 'N']) f += `<tr><td>${dn === 'D' ? 'Day' : 'Night'}</td>` + MONTHS.map((_, i) => `<td>${k(i + 1, dn).toFixed(1)}</td>`).join('') + '</tr>';
  for (const dn of ['D', 'N']) f += `<tr><td>${dn === 'D' ? 'Day' : 'Night'}, Terra only</td>` + MONTHS.map((_, i) => `<td>${k(i + 1, dn, -1).toFixed(1)}</td>`).join('') + '</tr>';
  $('factorTable').innerHTML = f + '</table><p class="small">1 MODIS hotspot ≈ k VIIRS hotspots. Terra + Aqua factors are used from ' + D.aqua_start + '; before that only Terra was in orbit, so Terra-only factors are used.</p>';
}

/* ---------- alert preview ---------- */
function renderAlert() {
  const cm = criticalMonths();
  const y1 = +$('y1').value;
  if (!cm) { $('alertPreview').textContent = 'Not enough fire activity recorded in this area to build an alert.'; return; }
  let peakM = 0; series.mean.forEach((v, i) => { if ((v || 0) > (series.mean[peakM] || 0)) peakM = i; });
  const mi = ymToMi(y1, peakM + 1);
  const v = mi < NM ? series.harm[mi] : null, med = series.med[peakM];
  const now = new Date(); const curM = now.getMonth();
  let until = (cm.start - curM + 12) % 12;
  const inSeason = until === 0 || ((curM - cm.start + 12) % 12) < cm.len;
  const lines = [
    `🔥 Fogo Alerta · ${areaName.split(' (')[0]}`,
    `In this area, most fires happen in ${cm.label} (${Math.round(cm.share * 100)}% of a typical year). ${MONTHS[peakM]} is usually the worst month (median ${fmt(med)} hotspots).`,
  ];
  if (v != null && med > 0) lines.push(`In ${MONTHS[peakM]} ${y1} there were ${fmt(v)} hotspots, ${pct(v / med - 1)} compared with a typical ${MONTHS[peakM]}.`);
  lines.push(inSeason ? 'We are in the critical period now. Do not burn; report fires and smoke to the fire brigade (Bombeiros 193).'
    : `The critical period starts in about ${until} month${until === 1 ? '' : 's'}: plan firebreaks and talk with the community brigade now. In an emergency call Bombeiros 193.`);
  $('alertPreview').textContent = lines.join('\n');
}

/* ---------- CSV ---------- */
function downloadCSV() {
  const y0 = +$('y0').value, y1 = +$('y1').value;
  const rows = [['year', 'month', 'modis_day', 'modis_night', 'viirs_day', 'viirs_night', 'hotspots_harmonized_viirs_equivalent', 'median_same_month_2001_2025', 'pct_vs_median', 'source']];
  for (let y = y0; y <= y1; y++) for (let m = 1; m <= 12; m++) {
    const mi = ymToMi(y, m); if (mi < 0 || mi >= NM) continue;
    const med = series.med[m - 1];
    rows.push([y, m, series.md[mi], series.mn[mi], mi >= VS ? series.vd[mi] : '', mi >= VS ? series.vn[mi] : '',
      series.harm[mi].toFixed(1), med != null ? med.toFixed(1) : '', med > 0 ? ((series.harm[mi] / med - 1) * 100).toFixed(1) : '',
      mi >= VS ? 'VIIRS NOAA-20 observed' : 'MODIS converted']);
  }
  const meta = `# Fogo Alerta burning activity calendar | area: ${areaName} | cells: ${selection.size} (0.25 deg) | data: NASA FIRMS MODIS C6.1 + VIIRS 375m NOAA-20 | NASA Space Apps 2026\n`;
  const blob = new Blob([meta + rows.map(r => r.join(',')).join('\n')], {type: 'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fogo_alerta_${areaName.split(' (')[0].toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${y0}_${y1}.csv`;
  a.click();
}

init();
