// Pure functions for the data refresh: no network and no files, so they can be tested offline.
// Rules come from the approved Stage 3 design and from the API probe (data/probe-report.json).

export const NATIONAL = 'Malaysia';
export const ALL_DISTRICTS = 'All Districts';
export const LICENCE = 'CC BY 4.0';

const STATE_KEY_OVERRIDES = {
  'W.P. Kuala Lumpur': 'kuala-lumpur',
  'W.P. Labuan': 'labuan',
  'W.P. Putrajaya': 'putrajaya',
};

/** "Bangsar/Pudu" and "Bangsar Pudu" both become "bangsar-pudu". */
export function slug(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['‘’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function stateKey(name) {
  if (name === NATIONAL) return 'malaysia';
  return STATE_KEY_OVERRIDES[name] ?? slug(name);
}

/** One identifying string per published row (everything except the measure). */
export function rowKey(cfg, row) {
  return cfg.columns.filter((c) => c !== cfg.measure).map((c) => row[c]).join('|');
}

/**
 * Turn the rows exactly as published into our rows (adds level, state_key, district_key, flags).
 * Returns { rows, stops } where stops are problems that must stop the refresh.
 */
export function normaliseRows(id, cfg, apiRows) {
  const stops = [];
  const note = (message) => { if (stops.length < 40) stops.push(`${id}: ${message}`); };

  if (!Array.isArray(apiRows) || apiRows.length === 0) {
    return { rows: [], stops: [`${id}: the API returned no rows`] };
  }
  const expected = [...cfg.columns].sort().join(',');
  const rows = [];
  const seen = new Set();

  apiRows.forEach((raw, index) => {
    const got = Object.keys(raw).sort().join(',');
    if (got !== expected) {
      note(`row ${index} has columns [${got}] but [${expected}] were expected (missing or new column)`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) note(`row ${index} has a date that is not YYYY-MM-DD: ${raw.date}`);

    let level;
    let districtKey = null;
    if (raw.state === NATIONAL) {
      level = 'national';
      if (cfg.hasDistrict && raw.district !== ALL_DISTRICTS) note(`row ${index} is national but names a district: ${raw.district}`);
    } else if (!cfg.hasDistrict || raw.district === ALL_DISTRICTS) {
      level = 'state';
    } else {
      level = 'district';
      districtKey = `${stateKey(raw.state)}/${slug(raw.district)}`;
    }

    const value = raw[cfg.measure];
    const flags = [];
    if (value === null || value === undefined) {
      if (cfg.kind === 'percent') flags.push('blank');
      else note(`row ${index} has a blank ${cfg.measure}`);
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      note(`row ${index} has a non-numeric ${cfg.measure}: ${JSON.stringify(value)}`);
    } else {
      if (value < 0) note(`row ${index} has a negative ${cfg.measure}: ${value}`);
      if (cfg.kind === 'percent' && value > 100) flags.push('over_100');
    }

    const key = rowKey(cfg, raw);
    if (seen.has(key)) note(`duplicate row for ${key}`);
    seen.add(key);

    const out = {};
    for (const column of cfg.columns) out[column] = raw[column] ?? null;
    out.level = level;
    out.state_key = stateKey(raw.state);
    out.district_key = districtKey;
    out.flags = flags;
    rows.push(out);
  });

  rows.sort((a, b) => (rowKey(cfg, a) < rowKey(cfg, b) ? -1 : rowKey(cfg, a) > rowKey(cfg, b) ? 1 : 0));
  return { rows, stops };
}

/** Build the places register from scratch or add new places to an existing one. */
export function buildPlaces(datasets, existing = { states: {}, districts: {} }) {
  const places = JSON.parse(JSON.stringify(existing));
  const added = [];
  for (const [id, { rows }] of Object.entries(datasets)) {
    for (const r of rows) {
      if (!places.states[r.state_key]) {
        places.states[r.state_key] = { name: r.state };
        added.push(`state ${r.state_key}`);
      }
      if (r.district_key) {
        let place = places.districts[r.district_key];
        if (!place) {
          place = places.districts[r.district_key] = { state: r.state_key, name: r.district, names: {}, first_date: r.date, geo_id: null };
          added.push(`district ${r.district_key}`);
        }
        if (!place.names[id]) {
          place.names[id] = r.district;
          if (!added.includes(`district ${r.district_key}`)) added.push(`district ${r.district_key} (new name in ${id})`);
        }
        if (r.date < place.first_date) place.first_date = r.date;
      }
    }
  }
  const sortObject = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  places.states = sortObject(places.states);
  places.districts = sortObject(places.districts);
  return { places, added };
}

/** Every place name in the new data must already be in the register. Unknown names stop the refresh. */
export function unknownPlaces(id, rows, places) {
  const problems = new Set();
  for (const r of rows) {
    const s = places.states[r.state_key];
    if (!s) problems.add(`${id}: unknown state "${r.state}"`);
    else if (s.name !== r.state) problems.add(`${id}: state spelled "${r.state}" but the register has "${s.name}"`);
    if (r.district_key) {
      const d = places.districts[r.district_key];
      if (!d) problems.add(`${id}: unknown district "${r.district}" in ${r.state}`);
      else if (d.names[id] !== r.district) problems.add(`${id}: district "${r.district}" in ${r.state} is not in the register for this dataset`);
    }
  }
  return [...problems].slice(0, 40);
}

/** Compare the previous file's rows with the new rows. */
export function diffRows(cfg, oldRows, newRows) {
  const oldMap = new Map(oldRows.map((r) => [rowKey(cfg, r), r]));
  const newMap = new Map(newRows.map((r) => [rowKey(cfg, r), r]));
  const removed = [];
  const revised = [];
  let added = 0;
  for (const [key, row] of oldMap) {
    const next = newMap.get(key);
    if (!next) removed.push(key);
    else if (next[cfg.measure] !== row[cfg.measure]) revised.push({ key, was: row[cfg.measure], now: next[cfg.measure] });
  }
  for (const key of newMap.keys()) if (!oldMap.has(key)) added += 1;
  return { added, removed, revised };
}

/** Warnings: do the district rows add up to the state row, and the state rows to the national row? */
export function totalsMismatches(cfg, rows) {
  if (cfg.kind !== 'count') return [];
  const group = (r) => [r.date, ...cfg.dimensions.map((d) => r[d])].join('|');
  const stateRow = new Map();
  const districtSum = new Map();
  const nationalRow = new Map();
  const stateSum = new Map();
  for (const r of rows) {
    const v = r[cfg.measure];
    if (v === null) continue;
    const g = group(r);
    if (r.level === 'national') nationalRow.set(g, v);
    if (r.level === 'state') {
      stateRow.set(`${g}|${r.state_key}`, v);
      stateSum.set(g, (stateSum.get(g) ?? 0) + v);
    }
    if (r.level === 'district') districtSum.set(`${g}|${r.state_key}`, (districtSum.get(`${g}|${r.state_key}`) ?? 0) + v);
  }
  const out = [];
  for (const [k, sum] of districtSum) if (stateRow.has(k) && stateRow.get(k) !== sum) out.push({ kind: 'districts_vs_state', key: k, total: stateRow.get(k), sum });
  for (const [g, sum] of stateSum) if (nationalRow.has(g) && nationalRow.get(g) !== sum) out.push({ kind: 'states_vs_national', key: g, total: nationalRow.get(g), sum });
  return out;
}

/** Text of a data/raw file. Rows are one per line so git shows changes row by row. */
export function serialiseDataset(header, rows) {
  const head = Object.entries(header).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
  return `{\n${head}\n "rows": [\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n ]\n}\n`;
}
