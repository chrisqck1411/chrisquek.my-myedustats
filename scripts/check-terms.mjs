// Fails the build if the terminology register (src/content/terms.json) breaks the rules in
// scripts/terms-rules.mjs: every BM term needs a source link, UI wording must match the register,
// and every category value in the data must have a term. Flagged terms are listed as warnings.
import { readFileSync, readdirSync } from 'node:fs';
import { validateTerms } from './terms-rules.mjs';

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

const register = read('../src/content/terms.json');
const en = read('../src/i18n/en.json');
const ms = read('../src/i18n/ms.json');

// Category columns whose values appear on the site as words. (Place names are shown as published.)
const FIELDS = ['stage', 'sex', 'citizenship', 'type'];
const dataValues = Object.fromEntries(FIELDS.map((f) => [f, new Set()]));
const rawDir = new URL('../data/raw/', import.meta.url);
for (const file of readdirSync(rawDir).filter((f) => f.endsWith('.json'))) {
  const dataset = JSON.parse(readFileSync(new URL(file, rawDir), 'utf8'));
  for (const row of dataset.rows) for (const f of FIELDS) if (f in row) dataValues[f].add(row[f]);
}

const { errors, warnings } = validateTerms({
  register,
  en,
  ms,
  dataValues: Object.fromEntries(Object.entries(dataValues).map(([k, v]) => [k, [...v].sort()])),
});

for (const w of warnings) console.warn(`terms check: ${w}`);
if (errors.length > 0) {
  console.error('terms check FAILED:\n' + errors.map((e) => ' - ' + e).join('\n'));
  process.exit(1);
}
const sourced = register.terms.filter((t) => t.status === 'sourced').length;
console.log(`terms check passed (${sourced} sourced, ${warnings.length} flagged).`);
