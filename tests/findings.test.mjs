import test from 'node:test';
import assert from 'node:assert/strict';
import {
  placeTotals, latestSharedDate, ratioEntries, rankEntries, ends, placeSeries, seriesBreaks, changeEntries,
  fmtChange, fmtRatio, barPercent,
} from '../src/lib/findings.mjs';

const row = (date, level, key, stage, students) => ({ date, level, state_key: level === 'state' ? key : null, district_key: level === 'district' ? key : null, stage, sex: 'both', students });

test('a place total adds the stages and skips a place with a missing stage', () => {
  const rows = [
    row('2025-06-30', 'district', 'a/x', 'primary', 100),
    row('2025-06-30', 'district', 'a/x', 'secondary', 50),
    row('2025-06-30', 'district', 'a/y', 'primary', 70), // no secondary: left out, not counted as 70
    row('2025-06-30', 'national', null, 'primary', 999),
    row('2024-01-01', 'district', 'a/x', 'primary', 1),
  ];
  const t = placeTotals(rows, { date: '2025-06-30', level: 'district', valueKey: 'students', stages: ['primary', 'secondary'], filters: { sex: 'both' } });
  assert.deepEqual([...t], [['a/x', 150]]);
  const nat = placeTotals(rows, { date: '2025-06-30', level: 'national', valueKey: 'students', stages: ['primary'] });
  assert.deepEqual([...nat], [['malaysia', 999]]);
});

test('blank numbers are not counted as zero', () => {
  const rows = [row('2025-06-30', 'state', 's', 'primary', null), row('2025-06-30', 'state', 's', 'secondary', 5)];
  const t = placeTotals(rows, { date: '2025-06-30', level: 'state', valueKey: 'students', stages: ['primary', 'secondary'] });
  assert.equal(t.size, 0);
});

test('the shared date is the newest one every list has', () => {
  assert.equal(latestSharedDate(['2024-01-01', '2025-06-30'], ['2025-06-30', '2023-01-01']), '2025-06-30');
  assert.equal(latestSharedDate(['2024-01-01'], ['2025-06-30']), null);
  assert.equal(latestSharedDate(), null);
});

test('ratios leave out unmatched and small places and say how many', () => {
  const top = new Map([['a', 1000], ['b', 50], ['c', 400], ['d', 10]]);
  const bottom = new Map([['a', 100], ['b', 10], ['c', 0], ['e', 7]]);
  const r = ratioEntries(top, bottom, { minTop: 100 });
  assert.deepEqual(r.entries.map((e) => [e.key, e.value]), [['a', 10]]);
  assert.deepEqual(r.small, ['b']);
  assert.deepEqual(r.unmatched.sort(), ['c', 'd', 'e']);
});

test('ranking is stable and numbered from 1', () => {
  const ranked = rankEntries([{ key: 'b', value: 2 }, { key: 'a', value: 2 }, { key: 'c', value: 9 }], 'desc');
  assert.deepEqual(ranked.map((e) => [e.key, e.rank]), [['c', 1], ['a', 2], ['b', 3]]);
  assert.deepEqual(rankEntries([{ key: 'x', value: 3 }, { key: 'y', value: 1 }], 'asc').map((e) => e.key), ['y', 'x']);
});

test('the two ends of a list never share a place', () => {
  const list = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ key: String(i), rank: i }));
  const e = ends(list, 3);
  assert.deepEqual(e.first.map((x) => x.rank), [1, 2, 3]);
  assert.deepEqual(e.last.map((x) => x.rank), [6, 7, 8]);
  const short = ends(list.slice(0, 4), 3);
  assert.equal(short.first.length + short.last.length, 4);
  assert.ok(short.first.every((f) => !short.last.includes(f)));
});

test('a sudden jump is a break, a normal yearly change is not', () => {
  const rows = [];
  const add = (date, key, v) => rows.push(row(date, 'state', key, 'primary', v));
  for (const [d, v] of [['2018-01-01', 1000], ['2019-01-01', 1030], ['2020-01-01', 1020]]) add(d, 'steady', v);
  for (const [d, v] of [['2018-01-01', 1000], ['2019-01-01', 1030], ['2020-01-01', 1600]]) add(d, 'jumpy', v);
  const dates = ['2018-01-01', '2019-01-01', '2020-01-01'];
  const series = placeSeries(rows, dates, { level: 'state', valueKey: 'students', stages: ['primary'] });
  const breaks = seriesBreaks(series, 0.15);
  assert.deepEqual([...breaks.keys()], ['jumpy']);
  assert.equal(breaks.get('jumpy').to, '2020-01-01');
  const c = changeEntries(series, '2018-01-01', '2020-01-01', breaks);
  assert.deepEqual(c.entries.map((e) => e.key), ['steady']);
  assert.deepEqual(c.broken, ['jumpy']);
  assert.ok(Math.abs(c.entries[0].value - 2) < 1e-9);
});

test('a place missing an end date is listed as missing, not ranked', () => {
  const series = new Map([['a', [['2019-01-01', 10], ['2020-01-01', 12]]]]);
  const c = changeEntries(series, '2018-01-01', '2020-01-01');
  assert.deepEqual(c.missing, ['a']);
  assert.equal(c.entries.length, 0);
});

test('numbers are written with a real minus sign and one decimal', () => {
  assert.equal(fmtChange(54.66), '+54.7%');
  assert.equal(fmtChange(-11.04), '−11.0%');
  assert.equal(fmtChange(0.01), '0.0%');
  assert.equal(fmtChange(-0.04), '0.0%');
  assert.equal(fmtRatio(16.07), '16.1');
  assert.equal(barPercent(8, 16), 50);
  assert.equal(barPercent(5, 0), 0);
});
