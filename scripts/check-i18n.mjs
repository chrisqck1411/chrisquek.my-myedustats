// Fails the build if English and Bahasa Melayu UI strings do not have exactly the same keys,
// or if any string is empty.
import { readFileSync } from 'node:fs';

const en = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8'));
const ms = JSON.parse(readFileSync(new URL('../src/i18n/ms.json', import.meta.url), 'utf8'));

const problems = [];
for (const key of Object.keys(en)) if (!(key in ms)) problems.push(`Missing in ms.json: ${key}`);
for (const key of Object.keys(ms)) if (!(key in en)) problems.push(`Missing in en.json: ${key}`);
for (const [name, dict] of [['en.json', en], ['ms.json', ms]]) {
  for (const [key, value] of Object.entries(dict)) {
    if (typeof value !== 'string' || value.trim() === '') problems.push(`Empty string in ${name}: ${key}`);
  }
}

if (problems.length > 0) {
  console.error('i18n check FAILED:\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log(`i18n check passed (${Object.keys(en).length} keys in both languages).`);
