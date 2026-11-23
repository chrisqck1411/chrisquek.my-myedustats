// One-off probe of the data.gov.my API (Slice 3). It makes NO assumptions: it records what the API
// really returns so the real pipeline can be built on facts. Runs on GitHub's servers (this
// workspace cannot reach the API). Writes data/probe-report.json.
import { writeFileSync, mkdirSync } from 'node:fs';

const API = process.env.PROBE_API ?? 'https://api.data.gov.my/data-catalogue';
const STORAGE = process.env.PROBE_STORAGE ?? 'https://storage.data.gov.my/education';
const DATASETS = [
  'schools_district',
  'enrolment_school_district',
  'teachers_district',
  'completion_school_state',
  'completion_school_district',
  'lecturers_uni',
];
const GAP_MS = Number(process.env.PROBE_GAP_MS ?? 16_000); // 4 requests a minute is the published limit, so one request per 16 s
const SUSPICIOUS = [100, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastApiCall = 0;

async function paced(url, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const wait = lastApiCall + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastApiCall = Date.now();
    const started = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000), headers: { 'user-agent': 'chrisquek.my-myedustats data probe' } });
      if (res.status === 429) {
        console.log(`${label}: 429, waiting 70 s (attempt ${attempt})`);
        await sleep(70_000);
        continue;
      }
      const text = await res.text();
      return { res, text, ms: Date.now() - started };
    } catch (error) {
      console.log(`${label}: ${error} (attempt ${attempt})`);
      await sleep(20_000);
    }
  }
  return null;
}

function pickHeaders(res) {
  const wanted = ['content-type', 'content-length', 'content-encoding', 'cache-control', 'last-modified', 'etag', 'retry-after', 'date'];
  const out = {};
  for (const [k, v] of res.headers) {
    if (wanted.includes(k) || k.startsWith('x-ratelimit') || k.startsWith('ratelimit')) out[k] = v;
  }
  return out;
}

function summarise(rows) {
  const keys = Object.keys(rows[0] ?? {});
  const columns = {};
  for (const key of keys) {
    const values = rows.map((r) => r[key]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '');
    const types = [...new Set(values.map((v) => (v === null ? 'null' : typeof v)))];
    const info = { types, blanks: values.length - nonNull.length };
    if (types.every((t) => t === 'number' || t === 'null')) {
      const nums = nonNull.filter((v) => typeof v === 'number');
      info.min = Math.min(...nums);
      info.max = Math.max(...nums);
      info.negative = nums.filter((n) => n < 0).length;
      info.nonInteger = nums.filter((n) => !Number.isInteger(n)).length;
    } else {
      const distinct = [...new Set(nonNull.map(String))].sort();
      info.distinctCount = distinct.length;
      info.values = distinct.length <= 60 ? distinct : distinct.slice(0, 8).concat(['...']);
      if (key === 'date') {
        info.first = distinct[0];
        info.last = distinct[distinct.length - 1];
      }
    }
    columns[key] = info;
  }
  const textKeys = keys.filter((k) => columns[k].types.includes('string'));
  const seen = new Map();
  for (const r of rows) {
    const id = textKeys.map((k) => r[k]).join('|');
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const duplicates = [...seen.values()].filter((n) => n > 1).length;
  const levels = {};
  for (const r of rows) {
    const level = `${r.state === 'Malaysia' ? 'state=Malaysia' : 'state=other'}|${r.district === 'All Districts' ? 'district=All Districts' : r.district === undefined ? 'no district column' : 'district=other'}`;
    levels[level] = (levels[level] ?? 0) + 1;
  }
  return { keys, columns, rowsWithSameTextKeys: duplicates, levelCounts: levels };
}

function countCsvRows(text) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return lines.length - 1;
}

const report = {
  generated_at: new Date().toISOString(),
  node: process.version,
  note: 'Probe of api.data.gov.my from a GitHub Actions runner. See scripts/probe-api.mjs.',
  datasets: {},
};

for (const id of DATASETS) {
  const entry = { id };
  report.datasets[id] = entry;
  console.log(`== ${id}`);

  // 1. Small request with meta=true: shows the response shape and what "meta" holds.
  const small = await paced(`${API}?id=${id}&meta=true&limit=3`, `${id} meta`);
  if (small) {
    entry.metaRequest = { status: small.res.status, ms: small.ms, headers: pickHeaders(small.res) };
    try {
      const json = JSON.parse(small.text);
      entry.metaRequest.topLevel = Array.isArray(json) ? 'array' : typeof json;
      entry.metaRequest.keys = Array.isArray(json) ? undefined : Object.keys(json);
      entry.metaRequest.meta = json.meta;
      entry.metaRequest.sample = Array.isArray(json) ? json.slice(0, 3) : json.data?.slice(0, 3);
    } catch {
      entry.metaRequest.rawStart = small.text.slice(0, 400);
    }
  }

  // 2. Full request with no limit: how many rows come back, and what is in them.
  const full = await paced(`${API}?id=${id}`, `${id} full`);
  if (full) {
    entry.fullRequest = { status: full.res.status, ms: full.ms, bytes: Buffer.byteLength(full.text), headers: pickHeaders(full.res) };
    try {
      const json = JSON.parse(full.text);
      const rows = Array.isArray(json) ? json : json.data;
      entry.fullRequest.topLevel = Array.isArray(json) ? 'array' : typeof json;
      entry.fullRequest.rowCount = rows.length;
      entry.fullRequest.countLooksLikeACap = SUSPICIOUS.includes(rows.length);
      entry.summary = summarise(rows);
    } catch (error) {
      entry.fullRequest.parseError = String(error);
      entry.fullRequest.rawStart = full.text.slice(0, 400);
    }
  }

  // 3. The published CSV and Parquet files (a different server, so not counted in the API limit).
  entry.downloads = {};
  for (const ext of ['csv', 'parquet']) {
    try {
      const head = await fetch(`${STORAGE}/${id}.${ext}`, { method: 'HEAD', signal: AbortSignal.timeout(60_000) });
      entry.downloads[ext] = { status: head.status, headers: pickHeaders(head) };
    } catch (error) {
      entry.downloads[ext] = { error: String(error) };
    }
  }
  try {
    const csv = await fetch(`${STORAGE}/${id}.csv`, { signal: AbortSignal.timeout(180_000) });
    const text = await csv.text();
    entry.csvRowCount = csv.ok ? countCsvRows(text) : null;
    entry.csvHeader = csv.ok ? text.split('\n')[0] : null;
    entry.apiMatchesCsv = entry.csvRowCount !== null && entry.csvRowCount === entry.fullRequest?.rowCount;
  } catch (error) {
    entry.csvError = String(error);
  }
  console.log(JSON.stringify({ rows: entry.fullRequest?.rowCount, csvRows: entry.csvRowCount, match: entry.apiMatchesCsv }));
}

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/probe-report.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
console.log('Wrote data/probe-report.json');
