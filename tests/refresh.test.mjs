// Runs the whole refresh script against a fake local API, in a temporary folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import config from '../scripts/lib/datasets.json' with { type: 'json' };

function makeRows(id, cfg, extra = {}) {
  const dimValues = Object.fromEntries(cfg.dimensions.map((d) => [d, d === 'stage' ? 'primary' : 'x']));
  const mk = (state, district, v, date) => {
    const r = { date, state, ...(cfg.hasDistrict ? { district } : {}), ...dimValues, [cfg.measure]: v };
    return Object.fromEntries(cfg.columns.map((c) => [c, r[c]]));
  };
  const out = [];
  for (const date of ['2024-01-01', '2025-01-01']) {
    out.push(mk('Malaysia', 'All Districts', 30, date), mk('Kelantan', 'All Districts', 30, date));
    if (cfg.hasDistrict) out.push(mk('Kelantan', 'Tanah Merah', 10, date), mk('Kelantan', 'Kota Bharu', 20, date));
  }
  return out;
}

let state;
function startServer() {
  state = { rows: {}, csvCount: {} };
  for (const [id, cfg] of Object.entries(config)) state.rows[id] = makeRows(id, cfg);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/api') {
        const id = u.searchParams.get('id');
        const meta = { catalogue_id: id, data_as_of: '2025', last_updated: '2026-10-11 12:00', next_update: '2027-12-31 18:00', data_source: ['MOE'], update_frequency: 'YEARLY', total: 1, limit: 1 };
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(u.searchParams.get('meta') ? { meta, data: state.rows[id].slice(0, 1) } : state.rows[id]));
      }
      const m = u.pathname.match(/\/education\/(.+)\.csv$/);
      if (m) {
        const n = state.csvCount[m[1]] ?? state.rows[m[1]].length;
        res.writeHead(200); return res.end('header\n' + 'row\n'.repeat(n));
      }
      res.writeHead(404); res.end();
    }).listen(0, () => resolve(server));
  });
}

function run(server, dataDir, extraArgs = []) {
  return new Promise((resolve) => {
    const port = server.address().port;
    const child = spawn('node', ['scripts/refresh-data.mjs', ...extraArgs], {
      env: { ...process.env, REFRESH_API: `http://localhost:${port}/api`, REFRESH_STORAGE: `http://localhost:${port}`, REFRESH_GAP_MS: '0', REFRESH_DATA_DIR: dataDir },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('refresh scenarios', async () => {
  const server = await startServer();
  const dir = mkdtempSync(join(tmpdir(), 'mes-data-'));
  const file = (name) => join(dir, name);
  const read = (name) => readFileSync(file(name), 'utf8');
  try {
    // 1. First run writes everything
    let r = await run(server, dir);
    assert.equal(r.code, 0, r.output);
    assert.match(r.output, /new or changed data/);
    for (const id of Object.keys(config)) assert.ok(existsSync(file(`raw/${id}.json`)), id);
    assert.ok(existsSync(file('places.json')));
    assert.ok(existsSync(file('refresh-report.json')));
    const sample = JSON.parse(read('raw/schools_district.json'));
    assert.equal(sample.licence, 'CC BY 4.0');
    assert.equal(sample.row_count, sample.rows.length);
    assert.equal(sample.rows.find((x) => x.district === 'Tanah Merah').district_key, 'kelantan/tanah-merah');

    // 2. Nothing changed: no file is rewritten (fetched_at stays), summary says so
    const before = read('raw/schools_district.json');
    const reportBefore = read('refresh-report.json');
    await new Promise((x) => setTimeout(x, 20));
    r = await run(server, dir);
    assert.equal(r.code, 0, r.output);
    assert.match(r.output, /no changes/);
    assert.equal(read('raw/schools_district.json'), before);
    assert.equal(read('refresh-report.json'), reportBefore);

    // 3. A revised past value is a warning, and the file is updated
    state.rows.schools_district[2] = { ...state.rows.schools_district[2], schools: 11 };
    r = await run(server, dir);
    assert.equal(r.code, 0, r.output);
    assert.match(r.output, /revised/);
    assert.notEqual(read('raw/schools_district.json'), before);

    // 4. A removed row stops everything and writes nothing
    const kept = read('raw/schools_district.json');
    state.rows.schools_district = state.rows.schools_district.slice(1);
    r = await run(server, dir);
    assert.equal(r.code, 1, r.output);
    assert.match(r.output, /disappeared/);
    assert.equal(read('raw/schools_district.json'), kept);
    state.rows.schools_district = makeRows('schools_district', config.schools_district);

    // 5. A new place name stops, unless --update-places is given
    state.rows.teachers_district.push({ ...state.rows.teachers_district[2], district: 'Jeli' });
    r = await run(server, dir);
    assert.equal(r.code, 1, r.output);
    assert.match(r.output, /unknown district "Jeli"/);
    r = await run(server, dir, ['--update-places']);
    assert.equal(r.code, 0, r.output);
    assert.ok(JSON.parse(read('places.json')).districts['kelantan/jeli']);
    state.rows.teachers_district.pop();

    // 6. API and CSV disagree: stop
    state.csvCount.lecturers_uni = 3;
    r = await run(server, dir);
    assert.equal(r.code, 1, r.output);
    assert.match(r.output, /published CSV/);
    delete state.csvCount.lecturers_uni;

    // 7. A new column stops
    state.rows.completion_school_state = state.rows.completion_school_state.map((x) => ({ ...x, extra: 1 }));
    r = await run(server, dir);
    assert.equal(r.code, 1, r.output);
    assert.match(r.output, /missing or new column/);
  } finally {
    server.close();
  }
});
