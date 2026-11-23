// Pure helpers for the home cards and the charts. No files, no network, so they can be tested offline.
// Numbers are never typed by hand anywhere on the site: they come from data/raw through these functions.

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ms: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'],
};

const INT = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 });
const PCT = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 2753819 -> "2,753,819" (Malaysia writes thousands with commas in both languages). */
export function fmtInt(n) {
  return INT.format(n);
}

/** 99.2 -> "99.2%" */
export function fmtPct(n) {
  return `${PCT.format(n)}%`;
}

/** "2025-06-30" -> "30 Jun 2025" (English) or "30 Jun 2025" (BM month names: Mac, Mei, Ogo, Okt, Dis). */
export function asAt(date, lang) {
  const [y, m, d] = String(date).split('-').map(Number);
  return `${d} ${MONTHS[lang][m - 1]} ${y}`;
}

/** Replace {name} markers. A marker with no value is left as it is, so a typo is visible, not silent. */
export function fillTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (marker, key) => (key in vars ? String(vars[key]) : marker));
}

/** ["a"] -> "a"; ["a","b"] -> "a and b"; ["a","b","c"] -> "a, b and c". */
export function joinList(items, and) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

/**
 * National rows of one dataset, grouped.
 * @param {object[]} rows       rows from data/raw/<id>.json
 * @param {string} valueKey     the column holding the number (students, teachers, schools, completion)
 * @param {Record<string,string>} filters  columns that must match (for example { sex: 'both' })
 * @param {string} groupKey     the column that makes one line (stage, type)
 * @returns {{ dates: string[], groups: Record<string, Record<string, number>> }}
 */
export function nationalSeries(rows, valueKey, filters, groupKey) {
  const dates = new Set();
  const groups = {};
  for (const row of rows) {
    if (row.level !== 'national') continue;
    if (!Object.entries(filters).every(([key, value]) => row[key] === value)) continue;
    if (typeof row[valueKey] !== 'number') continue;
    dates.add(row.date);
    (groups[row[groupKey]] ??= {})[row.date] = row[valueKey];
  }
  return { dates: [...dates].sort(), groups };
}

/** The newest date on which every wanted group has a value (never a half-filled date). */
export function latestCompleteDate(series, wantedGroups) {
  for (const date of [...series.dates].reverse()) {
    if (wantedGroups.every((g) => typeof series.groups[g]?.[date] === 'number')) return date;
  }
  return null;
}

/** True when the dates are not all the same day of the year (for example 1 Jan in early years, 30 Jun later). */
export function mixedBasis(dates) {
  return new Set(dates.map((d) => d.slice(5))).size > 1;
}
