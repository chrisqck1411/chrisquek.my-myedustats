/* Draws the line charts with Apache ECharts. Loaded only on pages that have a chart.
   The numbers, the note and the data table are already in the page's HTML; this script only draws the picture. */
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface Line {
  name: string;
  points: [number, number][];
}
interface ChartData {
  lang: 'en' | 'ms';
  lines: Line[];
  asAtByTime: Record<string, string>;
}

const SYMBOLS = ['circle', 'rect', 'triangle'];
const DASHES: ('solid' | 'dashed' | 'dotted')[] = ['solid', 'dashed', 'dotted'];

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function buildOption(data: ChartData) {
  const text = cssVar('--text');
  const muted = cssVar('--muted');
  const border = cssVar('--border');
  const surface = cssVar('--surface');
  const colours = [cssVar('--s1'), cssVar('--s2'), cssVar('--s3')];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const number = new Intl.NumberFormat('en-MY');

  return {
    animation: !reduceMotion,
    textStyle: { fontFamily: cssVar('--font') },
    color: colours,
    grid: { left: 8, right: 20, top: 56, bottom: 8, containLabel: true },
    legend: {
      top: 0,
      itemWidth: 28,
      itemHeight: 12,
      textStyle: { color: text, fontSize: 14 },
    },
    tooltip: {
      trigger: 'axis',
      triggerOn: 'mousemove|click',
      confine: true,
      backgroundColor: surface,
      borderColor: border,
      textStyle: { color: text, fontSize: 14 },
      axisPointer: { type: 'line', lineStyle: { color: muted } },
      formatter(params: any) {
        const list = Array.isArray(params) ? params : [params];
        const when = data.asAtByTime[String(list[0].value[0])] ?? '';
        const rows = list
          .map((p: any) => `${p.marker} ${escapeHtml(String(p.seriesName))}: <strong>${number.format(p.value[1])}</strong>`)
          .join('<br/>');
        return `<div>${escapeHtml(when)}</div>${rows}`;
      },
    },
    xAxis: {
      type: 'time',
      axisLabel: { color: muted, fontSize: 13, formatter: '{yyyy}', hideOverlap: true, showMinLabel: true },
      axisLine: { lineStyle: { color: border } },
      axisTick: { lineStyle: { color: border } },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: { color: muted, fontSize: 13, formatter: (v: number) => number.format(v) },
      splitLine: { lineStyle: { color: border } },
    },
    series: data.lines.map((line, i) => ({
      name: line.name,
      type: 'line',
      data: line.points,
      symbol: SYMBOLS[i % SYMBOLS.length],
      symbolSize: 8,
      showSymbol: true,
      lineStyle: { width: 3, type: DASHES[i % DASHES.length] },
      itemStyle: { color: colours[i % colours.length] },
    })),
  };
}

for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-chart]'))) {
  const holder = el.parentElement?.querySelector('script[data-chart-data]');
  if (!holder?.textContent) continue;
  let data: ChartData;
  try {
    data = JSON.parse(holder.textContent);
  } catch {
    continue;
  }
  const chart = echarts.init(el, undefined, { renderer: 'canvas' });
  const draw = () => chart.setOption(buildOption(data), true);
  draw();
  el.dataset.ready = '';

  new ResizeObserver(() => chart.resize()).observe(el);
  /* Redraw in the matching colours when the visitor switches light and dark. */
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
