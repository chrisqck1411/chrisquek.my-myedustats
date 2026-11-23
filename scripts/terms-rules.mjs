// Pure checks for the terminology register (src/content/terms.json). No files, no network, so the
// rules can be tested offline. scripts/check-terms.mjs reads the files and calls these.
//
// Rule from the project: no education term goes on the site in Bahasa Melayu until it is checked
// against an official source and logged here with a link. A term without a source link fails the build.
// Sources, in order of preference:
//   tier 1  the dataset's own page in each language (OpenDOSM, Malay version)
//   tier 2  Ministry of Education or DOSM publications and pages
//   tier 3  DBP's PRPM dictionary
// When no source is found the term is "flagged" for the site owner. It is never guessed.

export const STATUSES = ['sourced', 'flagged'];
export const TIER_HOSTS = {
  1: (host) => host === 'open.dosm.gov.my' || host === 'data.gov.my',
  2: (host) => host === 'gov.my' || host.endsWith('.gov.my'),
  3: (host) => host === 'prpm.dbp.gov.my',
};

const norm = (s) => String(s).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Problems with one source link. Returns a list of messages (empty when fine). */
export function checkSource(source, ms) {
  const problems = [];
  if (!source || typeof source !== 'object') return ['source is not an object'];
  if (![1, 2, 3].includes(source.tier)) problems.push('source tier must be 1, 2 or 3');
  if (typeof source.label !== 'string' || source.label.trim() === '') problems.push('source has no label');
  let url = null;
  try {
    url = new URL(source.url);
  } catch {
    problems.push(`source link is not a valid address: ${source.url}`);
  }
  if (url) {
    if (url.protocol !== 'https:') problems.push(`source link must be https: ${source.url}`);
    else if (TIER_HOSTS[source.tier] && !TIER_HOSTS[source.tier](url.hostname)) {
      problems.push(`tier ${source.tier} source has an unexpected host (${url.hostname})`);
    }
  }
  if (typeof source.quote !== 'string' || source.quote.trim() === '') {
    problems.push('source has no quote');
  } else if (ms && !norm(source.quote).includes(norm(ms))) {
    problems.push(`source quote does not contain the BM term "${ms}"`);
  }
  return problems;
}

/**
 * Validate the register.
 * @param {object} input
 * @param {{terms: object[]}} input.register  parsed terms.json
 * @param {Record<string,string>} input.en     parsed src/i18n/en.json
 * @param {Record<string,string>} input.ms     parsed src/i18n/ms.json
 * @param {Record<string,string[]>} input.dataValues  distinct values found in the data, by field
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateTerms({ register, en, ms, dataValues = {} }) {
  const errors = [];
  const warnings = [];
  const terms = register?.terms;
  if (!Array.isArray(terms) || terms.length === 0) return { errors: ['terms.json has no terms'], warnings };

  const ids = new Set();
  const covered = new Map(); // "field=value" -> term id

  for (const term of terms) {
    const where = `term "${term?.id ?? '(no id)'}"`;
    if (!term?.id || typeof term.id !== 'string') { errors.push('a term has no id'); continue; }
    if (ids.has(term.id)) errors.push(`${where}: duplicate id`);
    ids.add(term.id);
    if (!term.category) errors.push(`${where}: no category`);
    if (typeof term.en !== 'string' || term.en.trim() === '') errors.push(`${where}: no English text`);
    if (!STATUSES.includes(term.status)) { errors.push(`${where}: status must be one of ${STATUSES.join(', ')}`); continue; }

    if (term.status === 'sourced') {
      if (typeof term.ms !== 'string' || term.ms.trim() === '') {
        errors.push(`${where}: sourced term has no BM text`);
      } else if (!Array.isArray(term.sources) || term.sources.length === 0) {
        errors.push(`${where}: BM term "${term.ms}" has no source link`);
      } else {
        for (const s of term.sources) for (const p of checkSource(s, null)) errors.push(`${where}: ${p}`);
        const quoted = term.sources.some((s) => typeof s?.quote === 'string' && norm(s.quote).includes(norm(term.ms)));
        if (!quoted) errors.push(`${where}: none of the source quotes contains the BM term "${term.ms}"`);
      }
    } else {
      if (term.ms !== null && term.ms !== undefined) errors.push(`${where}: a flagged term must have ms set to null (put the draft wording in ms_draft)`);
      if (typeof term.note !== 'string' || term.note.trim() === '') errors.push(`${where}: a flagged term needs a note saying what is missing`);
      warnings.push(`FLAGGED, needs the site owner: "${term.en}"${term.ms_draft ? ` (draft BM wording: "${term.ms_draft}")` : ''} [${term.id}]`);
    }

    for (const alt of term.alternatives ?? []) {
      if (typeof alt.ms !== 'string' || alt.ms.trim() === '') { errors.push(`${where}: an alternative has no BM text`); continue; }
      if (typeof alt.note !== 'string' || alt.note.trim() === '') errors.push(`${where}: alternative "${alt.ms}" needs a note`);
      if (!Array.isArray(alt.sources) || alt.sources.length === 0) {
        errors.push(`${where}: alternative "${alt.ms}" has no source link`);
        continue;
      }
      let quoted = false;
      for (const s of alt.sources) {
        for (const p of checkSource(s, null)) errors.push(`${where}: alternative "${alt.ms}": ${p}`);
        if (typeof s?.quote === 'string' && norm(s.quote).includes(norm(alt.ms))) quoted = true;
      }
      if (!quoted) errors.push(`${where}: no source quote contains the alternative "${alt.ms}"`);
    }

    // A term tied to a UI string must match what the site really shows, in both languages.
    if (term.ui_key) {
      const bm = term.ms ?? term.ms_draft;
      if (!(term.ui_key in en) || !(term.ui_key in ms)) {
        errors.push(`${where}: ui_key "${term.ui_key}" is missing from en.json or ms.json`);
      } else {
        if (norm(en[term.ui_key]) !== norm(term.en)) errors.push(`${where}: en.json "${term.ui_key}" says "${en[term.ui_key]}" but the register says "${term.en}"`);
        if (bm && norm(ms[term.ui_key]) !== norm(bm)) errors.push(`${where}: ms.json "${term.ui_key}" says "${ms[term.ui_key]}" but the register says "${bm}"`);
      }
    }

    for (const dv of term.data_values ?? []) covered.set(`${dv.field}=${dv.value}`, term.id);
  }

  // Every category value that appears in the data must have a term, so a new value cannot reach the site unregistered.
  for (const [field, values] of Object.entries(dataValues)) {
    for (const value of values) {
      if (!covered.has(`${field}=${value}`)) errors.push(`data value ${field}="${value}" has no term in the register (add it with a source, or flag it)`);
    }
  }

  return { errors, warnings };
}
