import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateQuotes, MAX_WORDS } from '../scripts/quotes-rules.mjs';

const real = JSON.parse(readFileSync(new URL('../src/content/quotes.json', import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

test('the real quotes register passes', () => {
  const { errors } = validateQuotes(real);
  assert.deepEqual(errors, []);
});

test('a quote without a source link fails', () => {
  const r = clone(real);
  delete r.quotes[0].sourceUrl;
  assert.ok(validateQuotes(r).errors.some((e) => e.includes('sourceUrl')));
});

test('a source link that is not https fails', () => {
  const r = clone(real);
  r.quotes[0].sourceUrl = 'http://example.org/page';
  assert.ok(validateQuotes(r).errors.some((e) => e.includes('sourceUrl')));
});

test('a missing or unknown fallback fails', () => {
  const r = clone(real);
  r.fallback = 'nobody';
  assert.ok(validateQuotes(r).errors.some((e) => e.includes('fallback')));
  delete r.fallback;
  assert.ok(validateQuotes(r).errors.some((e) => e.includes('fallback')));
});

test('duplicate ids fail', () => {
  const r = clone(real);
  r.quotes[1].id = r.quotes[0].id;
  assert.ok(validateQuotes(r).errors.some((e) => e.includes('duplicate')));
});

test('a long quote fails', () => {
  const r = clone(real);
  r.quotes[0].text = Array(MAX_WORDS + 1).fill('word').join(' ');
  assert.ok(validateQuotes(r).errors.some((e) => e.includes('words')));
});

test('a sitting politician fails', () => {
  const r = clone(real);
  r.quotes[0].sittingPolitician = true;
  assert.ok(validateQuotes(r).errors.some((e) => e.includes('sittingPolitician')));
});

test('an original without a sourced translation fails', () => {
  const r = clone(real);
  const q = r.quotes.find((x) => x.original);
  delete q.translation;
  assert.ok(validateQuotes(r).errors.some((e) => e.includes('sourced translation')));
});

test('a translation without an original fails', () => {
  const r = clone(real);
  r.quotes[0].translation = { translator: 'Someone', year: 2000, sourceUrl: 'https://example.org/' };
  assert.ok(validateQuotes(r).errors.some((e) => e.includes('without an "original"')));
});

test('an open check shows as a warning, not an error', () => {
  const { errors, warnings } = validateQuotes(real);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('confucius')));
});
