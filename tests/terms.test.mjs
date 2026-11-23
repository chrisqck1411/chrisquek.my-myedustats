import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTerms, checkSource } from '../scripts/terms-rules.mjs';

const src = (o = {}) => ({ tier: 1, label: 'OpenDOSM', url: 'https://open.dosm.gov.my/ms-MY/data-catalogue/teachers_district', quote: 'Bilangan Guru', ...o });
const term = (o = {}) => ({ id: 'teacher', category: 'person', en: 'Teacher', ms: 'Guru', status: 'sourced', sources: [src()], ...o });
const run = (terms, extra = {}) => validateTerms({ register: { terms }, en: {}, ms: {}, ...extra });

test('a fully sourced term passes', () => {
  assert.deepEqual(run([term()]).errors, []);
});

test('a BM term with no source link fails the build', () => {
  const { errors } = run([term({ sources: [] })]);
  assert.match(errors.join('\n'), /has no source link/);
  assert.match(run([term({ sources: undefined })]).errors.join('\n'), /has no source link/);
});

test('the BM term must appear in a source quote (catches typos)', () => {
  const { errors } = run([term({ ms: 'Gurus' })]);
  assert.match(errors.join('\n'), /none of the source quotes contains/);
});

test('source links must be https and on a host allowed for their tier', () => {
  assert.match(checkSource(src({ url: 'http://open.dosm.gov.my/x' }), 'Guru').join(), /https/);
  assert.match(checkSource(src({ url: 'https://example.com/x' }), 'Guru').join(), /unexpected host/);
  assert.match(checkSource(src({ tier: 3, url: 'https://www.moe.gov.my/x' }), 'Guru').join(), /unexpected host/);
  assert.deepEqual(checkSource(src({ tier: 2, url: 'https://www.moe.gov.my/x' }), 'Guru'), []);
  assert.match(checkSource(src({ url: 'not a link' }), 'Guru').join(), /not a valid address/);
  assert.match(checkSource(src({ quote: '' }), 'Guru').join(), /no quote/);
});

test('duplicate ids and unknown statuses fail', () => {
  assert.match(run([term(), term()]).errors.join('\n'), /duplicate id/);
  assert.match(run([term({ status: 'maybe' })]).errors.join('\n'), /status must be/);
});

test('a flagged term is a warning, needs a note, and must not carry BM text', () => {
  const flagged = { id: 'x', category: 'role', en: 'Just browsing', ms: null, ms_draft: 'Sekadar melayari', status: 'flagged', note: 'No source.', sources: [] };
  const ok = run([flagged]);
  assert.deepEqual(ok.errors, []);
  assert.match(ok.warnings.join('\n'), /FLAGGED/);
  assert.match(run([{ ...flagged, note: '' }]).errors.join('\n'), /needs a note/);
  assert.match(run([{ ...flagged, ms: 'Sekadar melayari' }]).errors.join('\n'), /must have ms set to null/);
});

test('alternatives need a note, a source and a quote containing them', () => {
  const alt = { ms: 'Pelajar', note: 'Other wording', sources: [src({ quote: 'Bilangan Pelajar' })] };
  assert.deepEqual(run([term({ alternatives: [alt] })]).errors, []);
  assert.match(run([term({ alternatives: [{ ...alt, sources: [] }] })]).errors.join('\n'), /no source link/);
  assert.match(run([term({ alternatives: [{ ...alt, note: '' }] })]).errors.join('\n'), /needs a note/);
  assert.match(run([term({ alternatives: [{ ...alt, ms: 'Murid' }] })]).errors.join('\n'), /no source quote contains/);
});

test('UI strings must match the register in both languages', () => {
  const t = term({ ui_key: 'role.teacher' });
  assert.deepEqual(run([t], { en: { 'role.teacher': 'Teacher' }, ms: { 'role.teacher': 'Guru' } }).errors, []);
  assert.match(run([t], { en: { 'role.teacher': 'Teacher' }, ms: { 'role.teacher': 'Cikgu' } }).errors.join('\n'), /ms\.json/);
  assert.match(run([t], { en: { 'role.teacher': 'Tutor' }, ms: { 'role.teacher': 'Guru' } }).errors.join('\n'), /en\.json/);
  assert.match(run([t]).errors.join('\n'), /missing from en\.json or ms\.json/);
});

test('every category value in the data needs a term', () => {
  const t = term({ data_values: [{ field: 'stage', value: 'primary' }] });
  assert.deepEqual(run([t], { dataValues: { stage: ['primary'] } }).errors, []);
  assert.match(run([t], { dataValues: { stage: ['primary', 'preschool'] } }).errors.join('\n'), /stage="preschool"/);
});

test('the real register and real data pass', () => {
  const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
  const result = validateTerms({
    register: read('../src/content/terms.json'),
    en: read('../src/i18n/en.json'),
    ms: read('../src/i18n/ms.json'),
    dataValues: {
      stage: ['primary', 'secondary', 'tertiary', 'post_secondary', 'secondary_lower', 'secondary_upper'],
      sex: ['both', 'female', 'male'],
      citizenship: ['all', 'citizen', 'non_citizen'],
      type: ['IPTA', 'Institut Pendidikan Guru', 'Kolej Komuniti', 'Politeknik', 'Sekolah Menengah Kerajaan', 'Sekolah Rendah Kerajaan'],
    },
  });
  assert.deepEqual(result.errors, []);
});

test('owner-approved terms need who and when, and no source', () => {
  const t = { id: 'x', category: 'role', en: 'Just browsing', ms: 'Sekadar melayari', status: 'owner-approved', approved_by: 'Chris', approved_on: '2026-11-23', note: 'Approved.' };
  assert.deepEqual(run([t]).errors, []);
  assert.match(run([{ ...t, approved_by: undefined }]).errors.join('\n'), /approved_by and approved_on/);
  assert.match(run([{ ...t, ms: '' }]).errors.join('\n'), /no BM text/);
});

test('tier 4 (amanz.my) is only allowed for IT terms', () => {
  const amanz = src({ tier: 4, url: 'https://amanz.my/2019216403/', quote: 'mod gelap' });
  assert.deepEqual(run([term({ category: 'it', ms: 'Mod gelap', sources: [amanz] })]).errors, []);
  assert.match(run([term({ category: 'person', ms: 'Mod gelap', sources: [amanz] })]).errors.join('\n'), /only allowed for category "it"/);
  assert.match(checkSource(src({ tier: 4, url: 'https://example.com/x' }), null).join(), /unexpected host/);
});

test('a decision must match the term and name a listed wording', () => {
  const alt = { ms: 'Murid', note: 'Ministry wording', sources: [src({ quote: 'murid' })] };
  const d = (choice) => ({ by: 'Chris', on: '2026-11-23', choice });
  assert.deepEqual(run([term({ ms: 'Guru', alternatives: [alt], decision: d('Guru') })]).errors, []);
  assert.match(run([term({ alternatives: [alt], decision: d('Cikgu') })]).errors.join('\n'), /not one of the wordings/);
  assert.match(run([term({ alternatives: [alt], decision: d('Murid') })]).errors.join('\n'), /swap them/);
});

test('ui_contains checks a term inside a longer UI phrase', () => {
  const t = term({ ms: 'Mod gelap', en: 'Dark mode', sources: [src({ quote: 'mod gelap' })], ui_contains: ['theme.toDark'] });
  const ok = { en: { 'theme.toDark': 'Switch to dark mode' }, ms: { 'theme.toDark': 'Tukar ke mod gelap' } };
  assert.deepEqual(run([t], ok).errors, []);
  assert.match(run([t], { ...ok, ms: { 'theme.toDark': 'Tukar ke tema' } }).errors.join('\n'), /does not contain/);
});
