// Builds the home "Malaysia at a glance" cards and the first chart from the data files at build time.
// Every number on the page comes from data/raw through src/lib/figures.mjs. Nothing is typed by hand.
import fs from 'node:fs';
import path from 'node:path';
import { t, pathFor, type Lang, type Key } from '../i18n';
import { asAt, fillTemplate, fmtInt, fmtPct, joinList, latestCompleteDate, mixedBasis, nationalSeries } from './figures.mjs';

interface Dataset {
  id: string;
  title: string;
  source_url: string;
  rows: Record<string, any>[];
}

function readDataset(id: string): Dataset {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'raw', `${id}.json`), 'utf8'));
}

export interface CardRow {
  label: string;
  value: string;
}

export interface Card {
  id: string;
  title: string;
  asAt: string;
  rows: CardRow[];
  /** What is counted (the dataset's own definition). */
  counted: string;
  /** Short cautions, each one sentence. */
  keep: string[];
  sourceUrl: string;
  /** Link to the chart for this card, when the chart exists. */
  chartHref?: string;
}

interface CardSpec {
  id: string;
  dataset: string;
  valueKey: string;
  filters: Record<string, string>;
  groupKey: string;
  /** [value found in the data, i18n key of the label shown] for each row of the card */
  groups: [string, Key][];
  format: (n: number) => string;
  titleKey: Key;
  definitionKey: Key;
  /** Cautions that always apply to this card */
  keepKeys: Key[];
  /** Add the "dates are 1.5 years apart" caution when the dataset mixes 1 January and 30 June */
  datesCaution: boolean;
  chartPath?: string;
}

const SPECS: CardSpec[] = [
  {
    id: 'students',
    dataset: 'enrolment_school_district',
    valueKey: 'students',
    filters: { sex: 'both' },
    groupKey: 'stage',
    groups: [
      ['primary', 'stage.primary'],
      ['secondary', 'stage.secondary'],
      ['post_secondary', 'stage.postsecondary'],
    ],
    format: fmtInt,
    titleKey: 'card.students.title',
    definitionKey: 'def.students',
    keepKeys: ['scope.gov'],
    datesCaution: true,
    chartPath: 'charts/students/',
  },
  {
    id: 'teachers',
    dataset: 'teachers_district',
    valueKey: 'teachers',
    filters: { sex: 'both' },
    groupKey: 'stage',
    groups: [
      ['primary', 'stage.primary'],
      ['secondary', 'stage.secondary'],
    ],
    format: fmtInt,
    titleKey: 'card.teachers.title',
    definitionKey: 'def.teachers',
    keepKeys: ['scope.gov'],
    datesCaution: true,
  },
  {
    id: 'schools',
    dataset: 'schools_district',
    valueKey: 'schools',
    filters: {},
    groupKey: 'type',
    groups: [
      ['Sekolah Rendah Kerajaan', 'type.govprimary'],
      ['Sekolah Menengah Kerajaan', 'type.govsecondary'],
    ],
    format: fmtInt,
    titleKey: 'card.schools.title',
    definitionKey: 'def.schools',
    keepKeys: ['scope.gov'],
    datesCaution: true,
  },
  {
    id: 'completion',
    dataset: 'completion_school_state',
    valueKey: 'completion',
    filters: { sex: 'both' },
    groupKey: 'stage',
    groups: [
      ['primary', 'stage.primary'],
      ['secondary_lower', 'stage.lowersecondary'],
      ['secondary_upper', 'stage.uppersecondary'],
    ],
    format: fmtPct,
    titleKey: 'card.completion.title',
    definitionKey: 'def.completion',
    keepKeys: ['caveat.over100'],
    datesCaution: false,
  },
];

export function buildCards(lang: Lang): Card[] {
  return SPECS.map((spec) => {
    const ds = readDataset(spec.dataset);
    const series = nationalSeries(ds.rows, spec.valueKey, spec.filters, spec.groupKey);
    const wanted = spec.groups.map(([value]) => value);
    const date = latestCompleteDate(series, wanted);
    if (!date) throw new Error(`No complete national figures for the "${spec.id}" card in ${spec.dataset}`);
    const keep = spec.keepKeys.map((key) => t(lang, key));
    if (spec.datesCaution && mixedBasis(series.dates)) keep.push(t(lang, 'caveat.dates'));
    return {
      id: spec.id,
      title: t(lang, spec.titleKey),
      asAt: fillTemplate(t(lang, 'asat'), { date: asAt(date, lang) }),
      rows: spec.groups.map(([value, labelKey]) => ({
        label: t(lang, labelKey),
        value: spec.format(series.groups[value][date]),
      })),
      counted: t(lang, spec.definitionKey),
      keep,
      sourceUrl: ds.source_url,
      chartHref: spec.chartPath ? pathFor(lang, spec.chartPath) : undefined,
    };
  });
}

export interface ChartLine {
  name: string;
  /** [timestamp in milliseconds, value] */
  points: [number, number][];
}

export interface TableRow {
  label: string;
  cells: string[];
}

export interface Chart {
  lang: Lang;
  title: string;
  note: string;
  howto: string;
  counted: string;
  keep: string[];
  sourceUrl: string;
  lines: ChartLine[];
  /** timestamp -> "30 Jun 2025", for the pop-up */
  asAtByTime: Record<string, string>;
  tableHead: string[];
  tableRows: TableRow[];
}

export function buildStudentsChart(lang: Lang): Chart {
  const spec = SPECS.find((s) => s.id === 'students')!;
  const ds = readDataset(spec.dataset);
  const series = nationalSeries(ds.rows, spec.valueKey, spec.filters, spec.groupKey);
  const wanted = spec.groups.map(([value]) => value);
  const complete = series.dates.filter((d) => wanted.every((g) => typeof series.groups[g]?.[d] === 'number'));
  if (complete.length < 2) throw new Error('The students chart needs at least two dates with complete national figures');
  const first = complete[0];
  const last = complete[complete.length - 1];

  const lines: ChartLine[] = spec.groups.map(([value, labelKey]) => ({
    name: t(lang, labelKey),
    points: complete.map((d) => [Date.parse(`${d}T00:00:00Z`), series.groups[value][d]] as [number, number]),
  }));

  const itemWord = (labelKey: Key) => t(lang, labelKey).toLowerCase();
  const list = (date: string) =>
    joinList(
      spec.groups.map(([value, labelKey]) =>
        fillTemplate(t(lang, 'chart.students.item'), { n: fmtInt(series.groups[value][date]), stage: itemWord(labelKey) }),
      ),
      t(lang, 'list.and'),
    );
  const note = fillTemplate(t(lang, 'chart.students.note'), {
    d1: asAt(first, lang),
    l1: list(first),
    d2: asAt(last, lang),
    l2: list(last),
  });

  const keep = [t(lang, 'scope.gov')];
  if (mixedBasis(complete)) keep.push(t(lang, 'caveat.dates'));

  return {
    lang,
    title: t(lang, 'chart.students.title'),
    note,
    howto: t(lang, 'howto.line'),
    counted: t(lang, 'def.students'),
    keep,
    sourceUrl: ds.source_url,
    lines,
    asAtByTime: Object.fromEntries(complete.map((d) => [String(Date.parse(`${d}T00:00:00Z`)), asAt(d, lang)])),
    tableHead: [t(lang, 'asat.short'), ...spec.groups.map(([, labelKey]) => t(lang, labelKey))],
    tableRows: complete.map((d) => ({
      label: asAt(d, lang),
      cells: spec.groups.map(([value]) => fmtInt(series.groups[value][d])),
    })),
  };
}
