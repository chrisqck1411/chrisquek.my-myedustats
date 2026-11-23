// public/lang-init.js picks the language before the page is drawn. These tests run the real file
// against a fake browser and check the rules: only "/" ever moves, and the 404 page gets one view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/lang-init.js', import.meta.url), 'utf8');

function run({ path = '/', saved = null, languages = ['en-US'], notFound = false, storageBroken = false }) {
  const attrs = new Map();
  if (notFound) attrs.set('data-notfound', '');
  const calls = { replaced: null };
  const root = {
    hasAttribute: (n) => attrs.has(n),
    setAttribute: (n, v) => attrs.set(n, v),
  };
  const sandbox = {
    document: { documentElement: root },
    location: { pathname: path, search: '', hash: '', replace: (u) => (calls.replaced = u) },
    navigator: { languages, language: languages[0] },
    localStorage: {
      getItem: () => {
        if (storageBroken) throw new Error('blocked');
        return saved;
      },
    },
  };
  vm.runInNewContext(source, sandbox);
  return { replaced: calls.replaced, nf: attrs.get('data-nf'), lang: attrs.get('lang') };
}

test('home "/": a Malay browser goes to /ms/', () => {
  assert.equal(run({ languages: ['ms-MY', 'en'] }).replaced, '/ms/');
});

test('home "/": English, other and empty browser languages stay put', () => {
  assert.equal(run({ languages: ['en-GB'] }).replaced, null);
  assert.equal(run({ languages: ['zh-CN'] }).replaced, null);
  assert.equal(run({ languages: [] }).replaced, null);
});

test('the first English or Malay entry in the list wins', () => {
  assert.equal(run({ languages: ['en-US', 'ms'] }).replaced, null);
  assert.equal(run({ languages: ['zh-CN', 'ms'] }).replaced, '/ms/');
});

test('a saved choice beats the browser', () => {
  assert.equal(run({ saved: 'en', languages: ['ms-MY'] }).replaced, null);
  assert.equal(run({ saved: 'ms', languages: ['en-US'] }).replaced, '/ms/');
});

test('an unknown saved value is ignored', () => {
  assert.equal(run({ saved: 'fr', languages: ['ms'] }).replaced, '/ms/');
});

test('"/ms/" and other pages are never redirected', () => {
  assert.equal(run({ path: '/ms/', saved: 'en', languages: ['en'] }).replaced, null);
  assert.equal(run({ path: '/terms/', saved: 'ms', languages: ['ms'] }).replaced, null);
});

test('blocked storage falls back to the browser language', () => {
  assert.equal(run({ storageBroken: true, languages: ['ms'] }).replaced, '/ms/');
});

test('404 page: the address prefix decides first', () => {
  const r = run({ path: '/ms/nope/', notFound: true, saved: 'en', languages: ['en'] });
  assert.deepEqual([r.nf, r.lang, r.replaced], ['ms', 'ms', null]);
});

test('404 page: otherwise the saved choice, then the browser', () => {
  assert.equal(run({ path: '/nope/', notFound: true, saved: 'ms', languages: ['en'] }).nf, 'ms');
  assert.equal(run({ path: '/nope/', notFound: true, languages: ['ms-MY'] }).nf, 'ms');
  const en = run({ path: '/nope/', notFound: true, languages: ['en-US'] });
  assert.deepEqual([en.nf, en.lang, en.replaced], ['en', 'en', null]);
});

test('404 page is never redirected, even at "/"-like Malay browsers', () => {
  assert.equal(run({ path: '/', notFound: true, languages: ['ms'] }).replaced, null);
});
