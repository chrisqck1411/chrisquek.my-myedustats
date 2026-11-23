// Fails the build if the 404-page quotes register (src/content/quotes.json) breaks the rules in
// scripts/quotes-rules.mjs: for example a quote without a source link. Open checks print as warnings.
import { readFileSync } from 'node:fs';
import { validateQuotes } from './quotes-rules.mjs';

const register = JSON.parse(readFileSync(new URL('../src/content/quotes.json', import.meta.url), 'utf8'));
const { errors, warnings } = validateQuotes(register);

for (const w of warnings) console.warn(`quotes check: ${w}`);
if (errors.length > 0) {
  console.error('quotes check FAILED:\n' + errors.map((e) => ' - ' + e).join('\n'));
  process.exit(1);
}
console.log(`quotes check passed (${register.quotes.length} quotes, ${warnings.length} flagged).`);
