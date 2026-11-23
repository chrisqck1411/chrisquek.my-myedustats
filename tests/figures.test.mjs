import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtInt, fmtPct, asAt, fillTemplate, joinList, nationalSeries, latestCompleteDate, mixedBasis } from '../src/lib/figures.mjs';

test('numbers use commas and one decimal for percentages', () => {
  assert.equal(fmtInt(2753819), '2,753,819');
  assert.equal(fmtInt(7778), '7,778');
  assert.equal(fmtPct(99.2), '99.2%');
  assert.equal(fmtPct(98), '98.0%');
});

test('as-at dates use the right month names in each language', () => {
  assert.equal(asAt('2025-06-30', 'en'), '30 Jun 2025');
  assert.equal(asAt('2017-01-01', 'ms'), '1 Jan 2017');
  assert.equal(asAt('2024-03-05', 'ms'), '5 Mac 2024');
  assert.equal(asAt('2024-08-05', 'ms'), '5 Ogo 2024');
  assert.equal(asAt('2024-12-05', 'ms'), '5 Dis 2024');
  assert.equal(asAt('2024-08-05', 'en'), '5 Aug 2024');
});

test('templates fill known markers and leave unknown ones visible', () => {
  assert.equal(fillTemplate('As at {d}, {n}', { d: 'x', n: 3 }), 'As at x, 3');
  assert.equal(fillTemplate('{d} {missing}', { d: 'x' }), 'x {missing}');
});

test('lists join with the language word for "and"', () => {
  assert.equal(joinList(['a'], 'and'), 'a');
  assert.equal(joinList(['a', 'b'], 'and'), 'a and b');
  assert.equal(joinList(['a', 'b', 'c'], 'dan'), 'a, b dan c');
});

const rows = [
  { level: 'national', date: '2022-01-01', sex: 'both', stage: 'primary', students: 10 },
  { level: 'national', date: '2022-01-01', sex: 'female', stage: 'primary', students: 5 },
  { level: 'national', date: '2022-01-01', sex: 'both', stage: 'secondary', students: 8 },
  { level: 'national', date: '2023-06-30', sex: 'both', stage: 'primary', students: 11 },
  { level: 'state', date: '2023-06-30', sex: 'both', stage: 'primary', students: 99 },
  { level: 'national', date: '2023-06-30', sex: 'both', stage: 'secondary', students: null },
];

test('national series keeps only national rows that match the filter and have a number', () => {
  const s = nationalSeries(rows, 'students', { sex: 'both' }, 'stage');
  assert.deepEqual(s.dates, ['2022-01-01', '2023-06-30']);
  assert.deepEqual(s.groups.primary, { '2022-01-01': 10, '2023-06-30': 11 });
  assert.deepEqual(s.groups.secondary, { '2022-01-01': 8 });
});

test('the latest complete date skips a date where a group is missing', () => {
  const s = nationalSeries(rows, 'students', { sex: 'both' }, 'stage');
  assert.equal(latestCompleteDate(s, ['primary']), '2023-06-30');
  assert.equal(latestCompleteDate(s, ['primary', 'secondary']), '2022-01-01');
  assert.equal(latestCompleteDate(s, ['primary', 'nothing']), null);
});

test('a mixed basis is detected when dates fall on different days of the year', () => {
  assert.equal(mixedBasis(['2022-01-01', '2023-06-30']), true);
  assert.equal(mixedBasis(['2022-01-01', '2023-01-01']), false);
});
