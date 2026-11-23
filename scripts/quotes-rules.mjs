// Rules for the 404-page quotes register (src/content/quotes.json), approved by Chris on 23 Nov 2026.
// Kept separate from the build script so the tests can call it. Returns { errors, warnings }.

export const MAX_WORDS = 30;

const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

const wordCount = (s) => s.trim().split(/\s+/).length;

export function validateQuotes(register) {
  const errors = [];
  const warnings = [];
  const quotes = Array.isArray(register?.quotes) ? register.quotes : [];

  if (quotes.length === 0) errors.push('the register has no quotes');

  const ids = new Set();
  for (const q of quotes) {
    const name = q?.id ?? '(no id)';
    const need = (field) => {
      if (typeof q[field] !== 'string' || q[field].trim() === '') {
        errors.push(`${name}: missing "${field}"`);
        return false;
      }
      return true;
    };

    if (need('id')) {
      if (ids.has(q.id)) errors.push(`${name}: duplicate id`);
      ids.add(q.id);
    }
    for (const f of ['text', 'language', 'author', 'work', 'date', 'sourceLabel']) need(f);

    // Every quote needs a working-looking source link (the main rule).
    if (!isHttps(q.sourceUrl)) errors.push(`${name}: "sourceUrl" must be an https link to the source`);

    // Short quotes only.
    if (typeof q.text === 'string' && wordCount(q.text) > MAX_WORDS) {
      errors.push(`${name}: the quote is ${wordCount(q.text)} words; the limit is ${MAX_WORDS}`);
    }

    // No sitting politicians: the register must say so explicitly for every quote.
    if (q.sittingPolitician !== false) {
      errors.push(`${name}: "sittingPolitician" must be false (no sitting politicians are quoted)`);
    }

    // Original language shown; a translation only if a sourced one exists, never our own.
    if (q.original) {
      if (typeof q.original.text !== 'string' || !q.original.text.trim() || !q.original.language) {
        errors.push(`${name}: "original" needs "text" and "language"`);
      }
      if (!isHttps(q.originalSourceUrl)) errors.push(`${name}: "originalSourceUrl" must be an https link`);
      const tr = q.translation;
      if (!tr || !tr.translator || !tr.year || !isHttps(tr.sourceUrl)) {
        errors.push(`${name}: a quote with an original needs a sourced translation (translator, year, https sourceUrl)`);
      }
    } else if (q.translation) {
      errors.push(`${name}: "translation" given without an "original"`);
    }

    // Open checks are listed as warnings, like flagged terms.
    if (q.check) warnings.push(`${name}: ${q.check}`);
  }

  if (!register?.fallback) errors.push('"fallback" is missing (the quote shown if the script does not run)');
  else if (!ids.has(register.fallback)) errors.push(`"fallback" (${register.fallback}) is not a quote in the register`);

  return { errors, warnings };
}
