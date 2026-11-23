// Builds the four "question" pages from the data files at build time.
// Every number comes from data/raw through src/lib/findings.mjs. Nothing is typed by hand.
import fs from 'node:fs';
import path from 'node:path';
import { t, type Lang, type Key } from '../i18n';
import { asAt, fillTemplate, fmtInt, fmtPct, joinList } from './figures.mjs';
import {
  barPercent, changeEntries, ends, fmtChange, fmtRatio, placeSeries, placeTotals, ratioEntries, rankEntries, seriesBreaks,
} from './findings.mjs';

export type QuestionId = 'students-per-teacher' | 'school-size' | 'student-numbers' | 'upper-secondary-completion';
export const QUESTION_IDS: QuestionId[] = ['students-per-teacher', 'school-size', 'student-numbers', 'upper-secondary-completion'];

interface Dataset {
  id: string;
  title: string;
  source_url: string;
  rows: Record<string, any>[];
}

const root = process.cwd();
const cache = new Map<string, Dataset>();
function readDataset(id: string): Dataset {
  if (!cache.has(id)) cache.set(id, JSON.parse(fs.readFileSync(path.join(root, 'data', 'raw', `${id}.json`), 'utf8')));
  return cache.get(id)!;
}
const places = JSON.parse(fs.readFileSync(path.join(root, 'data', 'places.json'), 'utf8')) as {
  states: Record<string, { name: string }>;
  districts: Record<string, { state: string; name: string }>;
};

export interface Row {
  rank: number;
  place: string;
  /** The state a district is in (districts only) */
  state?: string;
  /** The number as it is written on the page */
  value: string;
  /** Bar width in percent, for counts and ratios that start at zero */
  bar?: number;
}

export interface QuestionTable {
  id: 'districts' | 'states';
  title: string;
  /** Column headings: rank, place, value */
  head: string[];
  rows: Row[];
  /** For long lists: the two ends shown first, the whole list kept inside "Show all" */
  endsFirst?: { label: string; rows: Row[] };
  endsLast?: { label: string; rows: Row[] };
}

export interface Question {
  id: QuestionId;
  lang: Lang;
  title: string;
  measure: string;
  asAt: string;
  answer: string;
  /** "Malaysia as a whole: 12.3" */
  reference: string;
  tables: QuestionTable[];
  /** The two ends of the main list, for the home card */
  card: { scope: 'districts' | 'states'; firstLabel: string; lastLabel: string; first: Row[]; last: Row[] };
  counted: string;
  howto: string;
  keep: string[];
  sources: { name: string; url: string }[];
  /** Plain sentences about places that are not shown, and why */
  leftOut: string[];
  /** How many districts are ranked (0 when the question is about states) */
  districtCount: number;
}

const districtName = (key: string) => places.districts[key]?.name ?? key;
const districtState = (key: string) => places.states[places.districts[key]?.state ?? key.split('/')[0]]?.name ?? '';
const stateName = (key: string) => places.states[key]?.name ?? key;

type Ranked = { key: string; value: number; rank: number };

function makeRows(ranked: Ranked[], kind: 'district' | 'state', fmt: (n: number) => string, withBars: boolean): Row[] {
  const max = withBars ? Math.max(...ranked.map((e) => e.value)) : 0;
  return ranked.map((e) => ({
    rank: e.rank,
    place: kind === 'district' ? districtName(e.key) : stateName(e.key),
    state: kind === 'district' ? districtState(e.key) : undefined,
    value: fmt(e.value),
    bar: withBars ? barPercent(e.value, max) : undefined,
  }));
}

/** The newest date for which every dataset has a national figure in all wanted stages. */
function newestNationalDate(parts: { ds: Dataset; valueKey: string; stages: string[]; filters?: Record<string, string> }[], notBefore = ''): string {
  const dateSets = parts.map(({ ds }) => new Set(ds.rows.filter((r) => r.level === 'national').map((r) => r.date as string)));
  const shared = [...dateSets[0]].filter((d) => dateSets.every((s) => s.has(d)) && d >= notBefore).sort().reverse();
  for (const date of shared) {
    const ok = parts.every(({ ds, valueKey, stages, filters }) => placeTotals(ds.rows, { date, level: 'national', valueKey, stages, filters }).size === 1);
    if (ok) return date;
  }
  throw new Error('No date has national figures in every dataset this question needs');
}

function tablesFor(
  lang: Lang,
  ranked: { districts?: Ranked[]; states: Ranked[] },
  fmt: (n: number) => string,
  withBars: boolean,
  labels: { first: Key; last: Key | null },
): { tables: QuestionTable[]; cardRows: { scope: 'districts' | 'states'; first: Row[]; last: Row[] } } {
  const tables: QuestionTable[] = [];
  let cardRows: { scope: 'districts' | 'states'; first: Row[]; last: Row[] };
  const stateRows = makeRows(ranked.states, 'state', fmt, withBars);
  if (ranked.districts) {
    const rows = makeRows(ranked.districts, 'district', fmt, withBars);
    const e = ends(rows, 5);
    tables.push({
      id: 'districts',
      title: t(lang, 'q.sec.districts'),
      head: [t(lang, 'col.rank'), t(lang, 'col.district')],
      rows,
      endsFirst: { label: t(lang, labels.first), rows: e.first },
      // Some questions show one end only (a "highest" list of completion rates is full of values above 100%).
      endsLast: labels.last ? { label: t(lang, labels.last), rows: e.last } : undefined,
    });
    const c = ends(rows, 3);
    cardRows = { scope: 'districts', first: c.first, last: labels.last ? c.last : [] };
  } else {
    const c = ends(stateRows, 3);
    cardRows = { scope: 'states', first: c.first, last: c.last };
  }
  tables.push({ id: 'states', title: t(lang, 'q.sec.states'), head: [t(lang, 'col.rank'), t(lang, 'col.state')], rows: stateRows });
  return { tables, cardRows };
}

const sourceOf = (...datasets: Dataset[]) => datasets.map((d) => ({ name: d.id, url: d.source_url }));

export function buildQuestion(id: QuestionId, lang: Lang): Question {
  const gov = t(lang, 'scope.gov');

  // ---------- 1 and 2: a ratio of two counts, place by place ----------
  if (id === 'students-per-teacher' || id === 'school-size') {
    const E = readDataset('enrolment_school_district');
    const other = readDataset(id === 'students-per-teacher' ? 'teachers_district' : 'schools_district');
    const isTeacher = id === 'students-per-teacher';
    const stages = isTeacher ? ['primary', 'secondary'] : ['primary'];
    const numOpts = { valueKey: 'students', stages, filters: { sex: 'both' } };
    const denOpts = isTeacher
      ? { valueKey: 'teachers', stages, filters: { sex: 'both' } }
      : { valueKey: 'schools', stages, filters: { type: 'Sekolah Rendah Kerajaan' } };
    const date = newestNationalDate([{ ds: E, ...numOpts }, { ds: other, ...denOpts }]);
    const limits = isTeacher ? { minTop: 1000 } : { minBottom: 5 };
    const fmt = isTeacher ? fmtRatio : fmtInt;

    const at = (level: 'district' | 'state' | 'national') => ({
      num: placeTotals(E.rows, { ...numOpts, date, level }),
      den: placeTotals(other.rows, { ...denOpts, date, level }),
    });
    const d = at('district');
    const s = at('state');
    const n = at('national');
    const districts = ratioEntries(d.num, d.den, limits);
    const states = ratioEntries(s.num, s.den, {});
    const malaysia = n.num.get('malaysia')! / n.den.get('malaysia')!;

    const rankedDistricts = rankEntries(districts.entries, 'desc');
    const rankedStates = rankEntries(states.entries, 'desc');
    const { tables, cardRows } = tablesFor(lang, { districts: rankedDistricts, states: rankedStates }, fmt, true, { first: 'q.highest', last: 'q.lowest' });

    const top = tables[0].rows[0];
    const bottom = tables[0].rows[tables[0].rows.length - 1];
    const prefix = isTeacher ? 'q.ratio' : 'q.size';
    const nameOf = (r: Row) => r.place;
    const keep = [gov];
    if (isTeacher) keep.push(t(lang, 'q.ratio.keep'));
    else keep.push(t(lang, 'q.size.keep'));
    const leftOut: string[] = [];
    if (districts.unmatched.length) leftOut.push(fillTemplate(t(lang, 'q.leftout.unmatched'), { n: districts.unmatched.length }));
    if (districts.small.length) leftOut.push(fillTemplate(t(lang, 'q.leftout.small'), { n: districts.small.length }));

    return {
      id,
      lang,
      title: t(lang, `${prefix}.title` as Key),
      measure: t(lang, `${prefix}.measure` as Key),
      asAt: fillTemplate(t(lang, 'asat'), { date: asAt(date, lang) }),
      answer: fillTemplate(t(lang, `${prefix}.answer` as Key), {
        date: asAt(date, lang),
        n: rankedDistricts.length,
        a: nameOf(top),
        av: top.value,
        b: nameOf(bottom),
        bv: bottom.value,
        m: fmt(malaysia),
      }),
      reference: fillTemplate(t(lang, 'q.ref'), { v: fmt(malaysia) }),
      tables: withValueHead(tables, t(lang, `${prefix}.measure` as Key)),
      card: { ...cardRows, firstLabel: t(lang, 'q.highest'), lastLabel: t(lang, 'q.lowest') },
      counted: t(lang, `${prefix}.counted` as Key),
      howto: t(lang, `${prefix}.howto` as Key),
      keep: mixedDates(keep, [date], lang),
      sources: sourceOf(E, other),
      leftOut,
      districtCount: rankedDistricts.length,
    };
  }

  // ---------- 3: change in primary students, by state ----------
  if (id === 'student-numbers') {
    const E = readDataset('enrolment_school_district');
    const START = '2018-01-01';
    const opts = { valueKey: 'students', stages: ['primary'], filters: { sex: 'both' } };
    const end = newestNationalDate([{ ds: E, ...opts }], START);
    const dates = [...new Set(E.rows.filter((r) => r.level === 'state' && r.date >= START && r.date <= end).map((r) => r.date as string))].sort();
    const series = placeSeries(E.rows, dates, { ...opts, level: 'state' });
    const breaks = seriesBreaks(series, 0.15);
    const change = changeEntries(series, START, end, breaks);
    const nat = {
      start: placeTotals(E.rows, { ...opts, date: START, level: 'national' }).get('malaysia')!,
      end: placeTotals(E.rows, { ...opts, date: end, level: 'national' }).get('malaysia')!,
    };
    const malaysia = (nat.end / nat.start - 1) * 100;
    const ranked = rankEntries(change.entries, 'asc');
    const { tables, cardRows } = tablesFor(lang, { states: ranked }, fmtChange, false, { first: 'q.falls', last: 'q.rises' });
    const first = tables[0].rows[0];
    const last = tables[0].rows[tables[0].rows.length - 1];
    const falling = ranked[0].value < 0 && ranked[ranked.length - 1].value > 0;
    const leftOut = change.broken.length
      ? [fillTemplate(t(lang, 'q.leftout.broken'), { names: joinList(change.broken.map(stateName), t(lang, 'list.and')) })]
      : [];
    return {
      id,
      lang,
      title: t(lang, 'q.trend.title'),
      measure: t(lang, 'q.trend.measure'),
      asAt: `${asAt(START, lang)} – ${asAt(end, lang)}`,
      answer: fillTemplate(t(lang, falling ? 'q.trend.answer' : 'q.trend.answer.range'), {
        d1: asAt(START, lang),
        d2: asAt(end, lang),
        a: first.place,
        av: first.value,
        b: last.place,
        bv: last.value,
        m: fmtChange(malaysia),
      }),
      reference: fillTemplate(t(lang, 'q.ref'), { v: fmtChange(malaysia) }),
      tables: withValueHead(tables, t(lang, 'q.trend.measure')),
      card: { ...cardRows, firstLabel: t(lang, 'q.falls'), lastLabel: t(lang, 'q.rises') },
      counted: t(lang, 'q.trend.counted'),
      howto: t(lang, 'q.trend.howto'),
      keep: mixedDates([gov, t(lang, 'q.trend.keep.districts'), t(lang, 'q.trend.keep.start')], [START, end], lang),
      sources: sourceOf(E),
      leftOut,
      districtCount: 0,
    };
  }

  // ---------- 4: upper secondary completion rate ----------
  const CS = readDataset('completion_school_state');
  const CD = readDataset('completion_school_district');
  const stage = ['secondary_upper'];
  const sOpts = { valueKey: 'completion', stages: stage, filters: { sex: 'both' } };
  const dOpts = { valueKey: 'completion', stages: stage };
  const date = newestNationalDate([{ ds: CS, ...sOpts }]);
  const dDate = [...new Set(CD.rows.filter((r) => r.level === 'district').map((r) => r.date as string))].sort().reverse().find((d) => d <= date) ?? date;
  const districtMap = placeTotals(CD.rows, { ...dOpts, date: dDate, level: 'district' });
  const blank = CD.rows.filter((r) => r.date === dDate && r.level === 'district' && r.stage === 'secondary_upper' && typeof r.completion !== 'number').length;
  const stateMap = placeTotals(CS.rows, { ...sOpts, date, level: 'state' });
  const nationalValue = placeTotals(CS.rows, { ...sOpts, date, level: 'national' }).get('malaysia')!;
  const asEntries = (m: Map<string, number>) => [...m].map(([key, value]) => ({ key, value }));
  const rankedDistricts = rankEntries(asEntries(districtMap), 'asc');
  const rankedStates = rankEntries(asEntries(stateMap), 'asc');
  const { tables, cardRows } = tablesFor(lang, { districts: rankedDistricts, states: rankedStates }, fmtPct, false, { first: 'q.lowest', last: null });
  const nameOf = (r: Row) => r.place;
  const leftOut = blank ? [fillTemplate(t(lang, 'q.leftout.blank'), { n: blank })] : [];
  return {
    id,
    lang,
    title: t(lang, 'q.completion.title'),
    measure: t(lang, 'q.completion.measure'),
    asAt: fillTemplate(t(lang, 'asat'), { date: asAt(date, lang) }),
    answer: fillTemplate(t(lang, 'q.completion.answer'), {
      date: asAt(date, lang),
      n: rankedDistricts.length,
      a: nameOf(tables[0].rows[0]),
      av: tables[0].rows[0].value,
      s: tables[1].rows[0].place,
      sv: tables[1].rows[0].value,
      m: fmtPct(nationalValue),
    }),
    reference: fillTemplate(t(lang, 'q.ref'), { v: fmtPct(nationalValue) }),
    tables: withValueHead(tables, t(lang, 'q.completion.measure')),
    card: { ...cardRows, firstLabel: t(lang, 'q.lowest'), lastLabel: '' },
    counted: t(lang, 'def.completion'),
    howto: t(lang, 'q.completion.howto'),
    keep: [gov, t(lang, 'caveat.over100'), t(lang, 'q.completion.keep.small'), t(lang, 'q.completion.keep.offices')],
    sources: sourceOf(CS, CD),
    leftOut,
    districtCount: rankedDistricts.length,
  };
}

/** Add the measure's name as the last column heading of every table. */
function withValueHead(tables: QuestionTable[], measure: string): QuestionTable[] {
  return tables.map((tb) => ({ ...tb, head: [...tb.head, measure] }));
}

/** Add the "1 January and 30 June" caution when the dates used do not share one day of the year. */
function mixedDates(keep: string[], dates: string[], lang: Lang): string[] {
  const days = new Set(dates.map((d) => d.slice(5)));
  return days.size > 1 ? [...keep, t(lang, 'caveat.dates')] : keep;
}
