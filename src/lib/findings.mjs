// Pure helpers for the four "question" pages (students per teacher, school size, student numbers over time,
// upper secondary completion). No files, no network, so every rule can be tested offline.
// Numbers are never typed by hand: they come from data/raw through these functions.
//
// Honesty rules built in here (each one has a test):
//  - A place is never half-counted: if one stage is blank for a place, the place is left out.
//  - Places that two datasets name or define differently are left out of a ratio, and counted so the page can say so.
//  - A place whose figures jump suddenly between two dates is left out of a trend, and counted so the page can say so.

/** One number per place: the sum over the wanted stages on one date. Places missing a stage are skipped. */
export function placeTotals(rows, { date, level, valueKey, stages, filters = {}, stageKey = 'stage' }) {
  const keyField = level === 'district' ? 'district_key' : level === 'state' ? 'state_key' : null;
  const acc = new Map();
  for (const row of rows) {
    if (row.date !== date || row.level !== level) continue;
    if (!Object.entries(filters).every(([k, v]) => row[k] === v)) continue;
    if (!stages.includes(row[stageKey])) continue;
    if (typeof row[valueKey] !== 'number') continue;
    const key = keyField ? row[keyField] : 'malaysia';
    const entry = acc.get(key) ?? { total: 0, seen: new Set() };
    entry.total += row[valueKey];
    entry.seen.add(row[stageKey]);
    acc.set(key, entry);
  }
  const out = new Map();
  for (const [key, entry] of acc) if (stages.every((s) => entry.seen.has(s))) out.set(key, entry.total);
  return out;
}

/** The newest date that appears in every list of dates, or null. */
export function latestSharedDate(...dateLists) {
  if (dateLists.length === 0) return null;
  const shared = dateLists.map((l) => new Set(l)).reduce((a, b) => new Set([...a].filter((d) => b.has(d))));
  return [...shared].sort().pop() ?? null;
}

/**
 * Divide one total by another, place by place.
 * Places found in only one of the two maps, or with a zero divisor, are left out ("unmatched").
 * Places below the size limits are left out ("small"), so one tiny area cannot top a ranking by chance.
 */
export function ratioEntries(top, bottom, { minTop = 0, minBottom = 0 } = {}) {
  const entries = [];
  const unmatched = [];
  const small = [];
  for (const [key, num] of top) {
    const den = bottom.get(key);
    if (typeof den !== 'number' || den <= 0) {
      unmatched.push(key);
    } else if (num < minTop || den < minBottom) {
      small.push(key);
    } else {
      entries.push({ key, num, den, value: num / den });
    }
  }
  for (const key of bottom.keys()) if (!top.has(key)) unmatched.push(key);
  return { entries, unmatched, small };
}

/** Sort entries by value, "desc" (largest first) or "asc". Ties are ordered by place key so the order never changes between builds. */
export function rankEntries(entries, direction) {
  const sign = direction === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => sign * (a.value - b.value) || (a.key < b.key ? -1 : 1)).map((e, i) => ({ ...e, rank: i + 1 }));
}

/** The first n and the last n of a ranked list (no place appears in both). */
export function ends(ranked, n) {
  if (ranked.length <= 2 * n) return { first: ranked.slice(0, Math.ceil(ranked.length / 2)), last: ranked.slice(Math.ceil(ranked.length / 2)) };
  return { first: ranked.slice(0, n), last: ranked.slice(-n) };
}

/** Per-place series of totals on several dates: Map(place key -> [[date, total], ...]) sorted by date. */
export function placeSeries(rows, dates, options) {
  const series = new Map();
  for (const date of dates) {
    for (const [key, total] of placeTotals(rows, { ...options, date })) {
      if (!series.has(key)) series.set(key, []);
      series.get(key).push([date, total]);
    }
  }
  return series;
}

/**
 * Places whose figure changes by more than maxStep (for example 0.15 = 15%) between two neighbouring dates.
 * Normal yearly movement is a few percent; a jump of this size is a break in the data, not a real change.
 * @returns {Map<string, {from: string, to: string, step: number}>}  the first such jump for each place
 */
export function seriesBreaks(series, maxStep) {
  const breaks = new Map();
  for (const [key, points] of series) {
    for (let i = 1; i < points.length; i++) {
      const [d0, a] = points[i - 1];
      const [d1, b] = points[i];
      if (a > 0 && Math.abs(b / a - 1) > maxStep) {
        breaks.set(key, { from: d0, to: d1, step: b / a - 1 });
        break;
      }
    }
  }
  return breaks;
}

/**
 * Percentage change from the first to the last date of each series. Places in `breaks`, or without both end dates,
 * are listed apart, never ranked.
 */
export function changeEntries(series, startDate, endDate, breaks = new Map()) {
  const entries = [];
  const broken = [];
  const missing = [];
  for (const [key, points] of series) {
    const first = points.find(([d]) => d === startDate);
    const last = points.find(([d]) => d === endDate);
    if (!first || !last || first[1] <= 0) missing.push(key);
    else if (breaks.has(key)) broken.push(key);
    else entries.push({ key, start: first[1], end: last[1], value: (last[1] / first[1] - 1) * 100 });
  }
  return { entries, broken, missing };
}

/** 54.66 -> "+54.7%", -11.0 -> "−11.0%" (a real minus sign, so screen readers say "minus"), 0 -> "0.0%". */
export function fmtChange(n) {
  const text = `${Math.abs(n).toFixed(1)}%`;
  if (Math.round(Math.abs(n) * 10) === 0) return `${(0).toFixed(1)}%`;
  return `${n > 0 ? '+' : '−'}${text}`;
}

/** 16.07 -> "16.1" (one decimal, for ratios). */
export function fmtRatio(n) {
  return n.toFixed(1);
}

/** Width of a bar as a whole percentage of the largest value (bars for counts and ratios start at zero). */
export function barPercent(value, max) {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}
