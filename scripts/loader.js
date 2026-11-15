/*
 * In-browser loader used to build the dataset (run in the browser console on
 * https://firms.modaps.eosdis.nasa.gov/country/ so the requests are same-origin).
 * Streams NASA FIRMS country yearly CSVs for Brazil, keeps the Amazonas region box and
 * detections of type 0, and aggregates counts per 0.25-degree cell x month x sensor x day/night.
 * At the end, exportData() saves fogo_alerta_dados.json.gz, the input of build.py.
 * Team Fogo Alerta - NASA Space Apps 2026. Written with assistance from Claude (Anthropic).
 */
window.__G = {latMin: -10, latMax: 2.5, lonMin: -74, lonMax: -56, res: 0.25};
const G = window.__G;
const NJ = Math.round((G.lonMax - G.lonMin) / G.res);
window.__agg = new Map();
window.__daily = new Map();

const files = [];
for (let y = 2000; y <= 2025; y++) files.push({inst: 'modis', y, name: `modis_${y}_Brazil.csv`, kind: 'M'});
for (let y = 2018; y <= 2025; y++) files.push({inst: 'viirs-jpss1', y, name: `viirs-jpss1_${y}_Brazil.csv`, kind: 'V'});
window.__job = {status: 'running', files: files.map(f => ({name: f.name, state: 'queued', rows: 0, kept: 0, bytes: 0})), t0: Date.now(), errors: [], skippedType: 0};

async function proc(f, st) {
  st.state = 'downloading';
  const res = await fetch(`/data/country/${f.inst}/${f.y}/${f.name}`);
  if (res.status !== 200) { st.state = 'http ' + res.status; return; }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let first = true;
  const agg = window.__agg, daily = window.__daily;
  while (true) {
    const {done, value} = await reader.read(); if (done) break;
    st.bytes += value.length;
    buf += dec.decode(value, {stream: true});
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (first) { first = false; continue; }
      if (!line) continue;
      st.rows++;
      // latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type
      const c = line.split(',');
      const lat = +c[0], lon = +c[1];
      if (lat < G.latMin || lat >= G.latMax || lon < G.lonMin || lon >= G.lonMax) continue;
      const type = c[14] === undefined ? '0' : c[14].trim();
      if (type !== '0') { window.__job.skippedType++; continue; }
      const i = Math.floor((lat - G.latMin) / G.res), j = Math.floor((lon - G.lonMin) / G.res);
      const cell = i * NJ + j;
      const s = f.kind === 'M' ? (c[7] === 'Aqua' ? 'A' : 'T') : 'V';
      const dn = (c[13] || 'D').trim();
      const ym = c[5].slice(0, 7);
      const frp = +c[12] || 0;
      const k = s + dn + '|' + ym + '|' + cell;
      const a = agg.get(k); if (a) { a[0]++; a[1] += frp; } else agg.set(k, [1, frp]);
      const kd = s + dn + '|' + c[5];
      daily.set(kd, (daily.get(kd) || 0) + 1);
      st.kept++;
    }
  }
  st.state = 'done';
}

(async () => {
  const queue = files.map((f, i) => [f, window.__job.files[i]]);
  async function worker() { while (queue.length) { const [f, st] = queue.shift(); try { await proc(f, st); } catch (e) { st.state = 'error'; window.__job.errors.push(f.name + ': ' + e); } } }
  await Promise.all([worker(), worker(), worker(), worker()]);
  window.__job.status = 'finished'; window.__job.t1 = Date.now();
})();

async function exportData() {
  const agg = [];
  for (const [k, v] of window.__agg) { const [sd, ym, cell] = k.split('|'); agg.push([sd, ym, +cell, v[0], Math.round(v[1] * 10) / 10]); }
  const daily = [];
  for (const [k, n] of window.__daily) { const [sd, d] = k.split('|'); daily.push([sd, d, n]); }
  const json = JSON.stringify({grid: window.__G, agg, daily, files: window.__job.files.map(f => ({name: f.name, rows: f.rows, kept: f.kept, state: f.state}))});
  const blob = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fogo_alerta_dados.json.gz';
  document.body.appendChild(a); a.click();
  return {entries: agg.length, gzBytes: blob.size};
}
