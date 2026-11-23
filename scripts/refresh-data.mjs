// Weekly data refresh: fetch the open data from data.gov.my, check it, and write data/ files.
// Exit code 0 = fine (with or without changes), 1 = a check stopped the refresh (nothing is written).
// Usage: node scripts/refresh-data.mjs [--summary path.md] [--update-places] [--only id,id]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LICENCE, normaliseRows, buildPlaces, unknownPlaces, diffRows, totalsMismatches, serialiseDataset,
} from './lib/pipeline.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.REFRESH_API ?? 'https://api.data.gov.my/data-catalogue';
const STORAGE = process.env.REFRESH_STORAGE ?? 'https://storage.data.gov.my';
const GAP_MS = Number(process.env.REFRESH_GAP_MS ?? 16_000); // published limit: 4 requests a minute
const DATA_DIR = process.env.REFRESH_DATA_DIR ?? join(root, 'data');

const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const summaryPath = argValue('--summary');
const updatePlaces = args.includes('--update-places');
const only = argValue('--only')?.split(',');

const config = JSON.parse(readFileSync(join(root, 'scripts/lib/datasets.json'), 'utf8'));
const ids = Object.keys(config).filter((id) => !only || only.includes(id));

const stops = [];
const warnings = [];
const info = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastApiCall = 0;

async function apiGet(url, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const wait = lastApiCall + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastApiCall = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000), headers: { 'user-agent': 'chrisquek.my-myedustats data refresh' } });
      if (res.status === 429) { console.log(`${label}: rate limited, waiting 70 s`); await sleep(70_000); continue; }
      if (!res.ok) { stops.push(`${label}: the API answered HTTP ${res.status}`); return null; }
      return await res.json();
    } catch (error) {
      console.log(`${label}: ${error} (attempt ${attempt})`);
      await sleep(20_000);
    }
  }
  stops.push(`${label}: no usable answer from the API after 4 tries`);
  return null;
}

async function csvRowCount(id, cfg) {
  try {
    const res = await fetch(`${STORAGE}/${cfg.storage}/${id}.csv`, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.split('\n').filter((l) => l.trim() !== '').length - 1;
  } catch {
    return null;
  }
}

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const rawPath = (id) => join(DATA_DIR, 'raw', `${id}.json`);

// 1. Fetch and normalise
const fresh = {};
for (const id of ids) {
  const cfg = config[id];
  console.log(`== ${id}`);
  const apiRows = await apiGet(`${API}?id=${id}`, `${id} data`);
  const metaAnswer = await apiGet(`${API}?id=${id}&meta=true&limit=1`, `${id} meta`);
  if (!apiRows || !metaAnswer) continue;
  if (!Array.isArray(apiRows)) { stops.push(`${id}: the API did not return a list of rows`); continue; }
  const meta = metaAnswer.meta;
  if (!meta || !meta.last_updated) { stops.push(`${id}: the API gave no meta information`); continue; }

  const csvCount = await csvRowCount(id, cfg);
  if (csvCount === null) warnings.push(`${id}: could not read the published CSV, so the row count was not cross-checked`);
  else if (csvCount !== apiRows.length) stops.push(`${id}: the API gave ${apiRows.length} rows but the published CSV has ${csvCount} (partial or out-of-step data)`);

  const { rows, stops: rowStops } = normaliseRows(id, cfg, apiRows);
  stops.push(...rowStops);
  fresh[id] = { cfg, rows, meta, apiCount: apiRows.length };
  console.log(`   ${rows.length} rows, data as of ${meta.data_as_of}, last updated ${meta.last_updated}`);
}

// 2. Places register
const placesFile = join(DATA_DIR, 'places.json');
const existingPlaces = readJson(placesFile);
let places = existingPlaces;
let placesChanged = false;
if (stops.length === 0) {
  if (!existingPlaces) {
    ({ places } = buildPlaces(fresh));
    placesChanged = true;
    info.push(`places.json did not exist: created with ${Object.keys(places.states).length} states and ${Object.keys(places.districts).length} districts.`);
  } else {
    const unknown = Object.entries(fresh).flatMap(([id, d]) => unknownPlaces(id, d.rows, existingPlaces));
    if (unknown.length > 0 && !updatePlaces) {
      stops.push(...unknown.map((u) => `${u} (new or renamed place: review it, then run the refresh with --update-places)`));
    } else if (unknown.length > 0) {
      const built = buildPlaces(fresh, existingPlaces);
      places = built.places;
      placesChanged = true;
      info.push(`places.json updated: ${built.added.join('; ')}`);
    }
  }
}

// 3. Compare with the previous files
const changes = {};
if (stops.length === 0) {
  for (const [id, d] of Object.entries(fresh)) {
    const old = readJson(rawPath(id));
    const diff = old ? diffRows(d.cfg, old.rows, d.rows) : { added: d.rows.length, removed: [], revised: [] };
    if (diff.removed.length) stops.push(`${id}: ${diff.removed.length} published rows disappeared, e.g. ${diff.removed.slice(0, 3).join(' ; ')}`);
    if (diff.revised.length) warnings.push(`${id}: ${diff.revised.length} earlier values were revised, e.g. ${diff.revised.slice(0, 3).map((r) => `${r.key}: ${r.was} -> ${r.now}`).join(' ; ')}`);
    const mismatches = totalsMismatches(d.cfg, d.rows);
    if (mismatches.length) warnings.push(`${id}: ${mismatches.length} totals do not add up (district rows vs state row, or state rows vs national row), e.g. ${mismatches.slice(0, 2).map((m) => `${m.kind} ${m.key}: total ${m.total}, parts ${m.sum}`).join(' ; ')}`);
    const flagged = {};
    for (const r of d.rows) for (const f of r.flags) flagged[f] = (flagged[f] ?? 0) + 1;
    changes[id] = { old, diff, flagged, mismatches: mismatches.length };
  }
}

// 4. Write (only when everything passed)
const written = [];
if (stops.length === 0) {
  mkdirSync(join(DATA_DIR, 'raw'), { recursive: true });
  for (const [id, d] of Object.entries(fresh)) {
    const header = {
      id,
      title: d.cfg.title,
      licence: LICENCE,
      source_url: `https://data.gov.my/data-catalogue/${id}`,
      api_url: `${API}?id=${id}`,
      data_source: d.meta.data_source ?? null,
      data_as_of: d.meta.data_as_of ?? null,
      last_updated: d.meta.last_updated,
      next_update: d.meta.next_update ?? null,
      update_frequency: d.meta.update_frequency ?? null,
      row_count: d.rows.length,
      fetched_at: new Date().toISOString(),
      columns: d.cfg.columns,
    };
    const old = changes[id].old;
    const oldText = existsSync(rawPath(id)) ? readFileSync(rawPath(id), 'utf8') : null;
    const sameAsOld = oldText !== null && serialiseDataset({ ...header, fetched_at: old.fetched_at }, d.rows) === oldText;
    if (!sameAsOld) {
      writeFileSync(rawPath(id), serialiseDataset(header, d.rows));
      written.push(id);
    }
  }
  if (placesChanged) writeFileSync(placesFile, JSON.stringify(places, null, 1) + '\n');
  if (written.length > 0 || placesChanged) {
    const report = {
      generated_at: new Date().toISOString(),
      changed_datasets: written,
      datasets: Object.fromEntries(Object.entries(fresh).map(([id, d]) => [id, {
        rows: d.rows.length,
        added_rows: changes[id].diff.added,
        revised_values: changes[id].diff.revised.length,
        data_as_of: d.meta.data_as_of,
        last_updated: d.meta.last_updated,
        flags: changes[id].flagged,
        totals_that_do_not_add_up: changes[id].mismatches,
      }])),
      notes: info,
      warnings,
    };
    writeFileSync(join(DATA_DIR, 'refresh-report.json'), JSON.stringify(report, null, 1) + '\n');
  }
}

// 5. Summary
const lines = [];
if (stops.length) {
  lines.push('## Data refresh STOPPED: nothing was changed', '', ...stops.map((s) => `- ${s}`));
} else if (written.length === 0 && !placesChanged) {
  lines.push('## Data refresh: no changes', '', 'The published numbers are the same as last time.');
} else {
  lines.push('## Data refresh: new or changed data', '');
  for (const id of written) {
    const c = changes[id];
    lines.push(`- **${id}**: ${fresh[id].rows.length} rows, ${c.diff.added} new, ${c.diff.revised.length} revised (data as of ${fresh[id].meta.data_as_of}, last updated ${fresh[id].meta.last_updated})`);
  }
  if (info.length) lines.push('', ...info.map((s) => `- ${s}`));
}
if (!stops.length && warnings.length) lines.push('', '### Warnings (nothing stopped, but worth a look)', ...warnings.map((w) => `- ${w}`));
lines.push('');
const summary = lines.join('\n');
console.log('\n' + summary);
if (summaryPath) writeFileSync(summaryPath, summary);
process.exit(stops.length ? 1 : 0);
