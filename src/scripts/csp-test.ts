/* Temporary self-test for Slice 2. Shows on the page whether the strict content policy is active
   and whether ECharts works under it. Sample numbers only. */
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, TitleComponent } from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';

echarts.use([BarChart, GridComponent, TooltipComponent, TitleComponent, CanvasRenderer, SVGRenderer]);

const logEl = document.getElementById('csp-log') as HTMLUListElement;
const summaryEl = document.getElementById('csp-summary') as HTMLParagraphElement;

type Violation = { phase: string; directive: string; blocked: string };
const violations: Violation[] = [];
let phase = 'setup';

document.addEventListener('securitypolicyviolation', (event) => {
  violations.push({
    phase,
    directive: event.violatedDirective,
    blocked: event.blockedURI || '(inline)',
  });
});

function addLine(ok: boolean, text: string): void {
  const li = document.createElement('li');
  const mark = document.createElement('span');
  mark.className = ok ? 'ok' : 'bad';
  mark.textContent = ok ? 'PASS ' : 'FAIL ';
  li.append(mark, document.createTextNode(text));
  logEl.append(li);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function sampleOption(title: string): echarts.EChartsCoreOption {
  return {
    animation: false,
    title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 16, top: 48, bottom: 28 },
    xAxis: { type: 'category', data: ['A', 'B', 'C', 'D'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [12, 20, 15, 8] }],
  };
}

async function run(): Promise<void> {
  /* 1. Is the policy really being enforced? An inline <style> block and an inline <script> must both be blocked.
        (Style attributes are allowed on purpose: the chart library needs them.) */
  phase = 'deliberate';
  const probeStyle = document.createElement('style');
  probeStyle.textContent = 'body { outline: 0 }';
  document.head.append(probeStyle);
  const probeScript = document.createElement('script');
  probeScript.textContent = 'window.__mesInlineRan = true;';
  document.head.append(probeScript);
  await wait(400);
  probeStyle.remove();
  probeScript.remove();
  const styleBlocked = violations.some((v) => v.phase === 'deliberate' && v.directive.startsWith('style-src-elem'));
  const scriptBlocked =
    violations.some((v) => v.phase === 'deliberate' && v.directive.startsWith('script-src-elem')) &&
    !(window as unknown as { __mesInlineRan?: boolean }).__mesInlineRan;
  addLine(styleBlocked, 'The policy is active: an inline <style> block was blocked on purpose.');
  addLine(scriptBlocked, 'The policy is active: an inline <script> was blocked and did not run.');
  const blockedOnPurpose = styleBlocked && scriptBlocked;

  /* 2. Our own page markup has no inline scripts or styles. */
  const inlineScripts = document.querySelectorAll('script:not([src])').length;
  const inlineStyles = document.querySelectorAll('style').length;
  const styleAttrs = document.querySelectorAll('[style]').length;
  addLine(inlineScripts === 0, `No inline <script> tags in the page (found ${inlineScripts}).`);
  addLine(inlineStyles === 0, `No inline <style> tags in the page (found ${inlineStyles}).`);
  addLine(styleAttrs === 0, `No style="" attributes in our own page markup (found ${styleAttrs}).`);

  /* 3. ECharts, canvas drawing, tooltip and PNG export. */
  phase = 'charts';
  const canvasHost = document.getElementById('chart-canvas') as HTMLDivElement;
  const canvasChart = echarts.init(canvasHost, undefined, { renderer: 'canvas' });
  canvasChart.setOption(sampleOption('Sample (canvas)'));
  await wait(300);
  const canvasEl = canvasHost.querySelector('canvas');
  addLine(!!canvasEl && canvasEl.width > 0, 'Canvas chart drew.');

  canvasChart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 1 });
  await wait(500);
  addLine(true, 'Chart tooltip opened (see the policy result below for any block).');

  const png = canvasChart.getDataURL({ type: 'png', pixelRatio: 1 });
  addLine(png.startsWith('data:image/png;base64,') && png.length > 500, 'PNG export of the chart worked.');

  /* 4. The SVG drawing mode, in case the map needs it. */
  const svgHost = document.getElementById('chart-svg') as HTMLDivElement;
  const svgChart = echarts.init(svgHost, undefined, { renderer: 'svg' });
  svgChart.setOption(sampleOption('Sample (SVG)'));
  await wait(300);
  svgChart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 2 });
  await wait(500);
  addLine(!!svgHost.querySelector('svg'), 'SVG chart drew.');

  /* 5. Verdict: nothing may have been blocked while the charts ran. */
  await wait(500);
  const unexpected = violations.filter((v) => v.phase === 'charts');
  const pass = unexpected.length === 0 && blockedOnPurpose && inlineScripts === 0 && inlineStyles === 0 && styleAttrs === 0;
  summaryEl.textContent = pass
    ? 'RESULT: PASS. The strict policy is active and the charts ran without being blocked.'
    : `RESULT: FAIL. ${unexpected.length} thing(s) were blocked while the charts ran.`;
  summaryEl.className = pass ? 'ok' : 'bad';
  summaryEl.dataset.result = pass ? 'pass' : 'fail';

  for (const v of unexpected) {
    addLine(false, `Blocked: ${v.directive} (${v.blocked})`);
  }
}

run().catch((error: unknown) => {
  summaryEl.textContent = `RESULT: FAIL. The test crashed: ${String(error)}`;
  summaryEl.className = 'bad';
  summaryEl.dataset.result = 'fail';
});
