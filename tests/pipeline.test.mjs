import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slug, stateKey, normaliseRows, buildPlaces, unknownPlaces, diffRows, totalsMismatches,
} from '../scripts/lib/pipeline.mjs';
import config from '../scripts/lib/datasets.json' with { type: 'json' };

const schools = config.schools_district;
const completion = config.completion_school_district;
const row = (o) => ({ date: '2024-01-01', state: 'Kelantan', district: 'Tanah Merah', stage: 'primary', type: 'Sekolah Rendah Kerajaan', schools: 10, ...o });

test('slug joins spelling variants of the same name', () => {
  assert.equal(slug('Bangsar/Pudu'), slug('Bangsar Pudu'));
  assert.equal(slug("Kuala Nerang's"), 'kuala-nerangs');
  assert.equal(stateKey('W.P. Kuala Lumpur'), 'kuala-lumpur');
  assert.equal(stateKey('Malaysia'), 'malaysia');
  assert.equal(stateKey('Pulau Pinang'), 'pulau-pinang');
});

test('levels: national, state, district', () => {
  const { rows, stops } = normaliseRows('schools_district', schools, [
    row({ state: 'Malaysia', district: 'All Districts' }),
    row({ district: 'All Districts' }),
    row({}),
  ]);
  assert.deepEqual(stops, []);
  assert.deepEqual(rows.map((r) => r.level).sort(), ['district', 'national', 'state']);
  assert.equal(rows.find((r) => r.level === 'district').district_key, 'kelantan/tanah-merah');
  assert.equal(rows.find((r) => r.level === 'state').district_key, null);
});

test('stops: missing column, negative, blank count, duplicate, national with a district, empty answer', () => {
  const bad = (rows) => normaliseRows('schools_district', schools, rows).stops;
  const noColumn = row({}); delete noColumn.type;
  assert.match(bad([noColumn])[0], /columns/);
  assert.match(bad([row({ schools: -1 })])[0], /negative/);
  assert.match(bad([row({ schools: null })])[0], /blank/);
  assert.match(bad([row({}), row({})])[0], /duplicate/);
  assert.match(bad([row({ state: 'Malaysia', district: 'Tanah Merah' })])[0], /national but names a district/);
  assert.match(bad([])[0], /no rows/);
  assert.match(bad([row({ date: '2024' })])[0], /YYYY-MM-DD/);
  assert.match(bad([row({ schools: '10' })])[0], /non-numeric/);
});

test('percent rows: blank and over 100 are kept and flagged, not stopped', () => {
  const c = (o) => ({ date: '2024-01-01', state: 'Kelantan', district: 'Tanah Merah', stage: 'primary', completion: 98, ...o });
  const { rows, stops } = normaliseRows('completion_school_district', completion, [c({}), c({ stage: 'secondary_lower', completion: 120.5 }), c({ stage: 'secondary_upper', completion: null })]);
  assert.deepEqual(stops, []);
  assert.deepEqual(rows.map((r) => r.flags.join()).sort(), ['', 'blank', 'over_100']);
});

test('places: built once, unknown and renamed places are caught', () => {
  const first = normaliseRows('schools_district', schools, [row({}), row({ state: 'Malaysia', district: 'All Districts' })]).rows;
  const { places } = buildPlaces({ schools_district: { rows: first } });
  assert.deepEqual(unknownPlaces('schools_district', first, places), []);
  const renamed = normaliseRows('schools_district', schools, [row({ district: 'Tanah  Merah' })]).rows;
  assert.equal(unknownPlaces('schools_district', renamed, places).length, 1);
  const elsewhere = normaliseRows('schools_district', schools, [row({ district: 'Jeli' })]).rows;
  assert.match(unknownPlaces('schools_district', elsewhere, places)[0], /unknown district/);
  assert.equal(buildPlaces({ schools_district: { rows: elsewhere } }, places).added.length, 1);
});

test('diff: added, revised and removed rows', () => {
  const a = normaliseRows('schools_district', schools, [row({ stage: 'primary' }), row({ stage: 'secondary' })]).rows;
  const b = normaliseRows('schools_district', schools, [row({ stage: 'primary', schools: 11 }), row({ stage: 'tertiary' })]).rows;
  const d = diffRows(schools, a, b);
  assert.equal(d.added, 1);
  assert.equal(d.removed.length, 1);
  assert.deepEqual(d.revised.map((r) => [r.was, r.now]), [[10, 11]]);
});

test('totals: districts must add up to the state, states to the national figure', () => {
  const make = (state, district, v) => row({ state, district, schools: v });
  const ok = normaliseRows('schools_district', schools, [
    make('Malaysia', 'All Districts', 30), make('Kelantan', 'All Districts', 30), make('Kelantan', 'A', 10), make('Kelantan', 'B', 20),
  ]).rows;
  assert.equal(totalsMismatches(schools, ok).length, 0);
  const off = normaliseRows('schools_district', schools, [
    make('Malaysia', 'All Districts', 31), make('Kelantan', 'All Districts', 30), make('Kelantan', 'A', 10), make('Kelantan', 'B', 19),
  ]).rows;
  assert.deepEqual(totalsMismatches(schools, off).map((m) => m.kind).sort(), ['districts_vs_state', 'states_vs_national']);
});
